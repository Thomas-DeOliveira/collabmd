import { watch } from 'fs';

import { createWorkspaceChange } from '../../../domain/workspace-change.js';

function entrySignature(entry = {}) {
  return `${entry.type}:${entry.inode}:${entry.size}:${entry.mtimeMs}`;
}

function sortByPath(values = []) {
  return [...values].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

function buildPrefixRenameEntries(previousState, nextState, oldPrefix, newPrefix) {
  const renames = [];
  previousState.metadata.forEach((entry, pathValue) => {
    if (entry.type !== 'file' || !pathValue.startsWith(`${oldPrefix}/`)) {
      return;
    }

    const suffix = pathValue.slice(oldPrefix.length + 1);
    const nextPath = `${newPrefix}/${suffix}`;
    if (nextState.metadata.get(nextPath)?.type === 'file') {
      renames.push({ oldPath: pathValue, newPath: nextPath });
    }
  });
  return renames;
}

function detectWorkspaceChange(previousState, nextState) {
  const previousMetadata = previousState?.metadata ?? new Map();
  const nextMetadata = nextState?.metadata ?? new Map();
  const changedPaths = new Set();
  const deletedPaths = new Set();
  const addedPaths = new Set();
  const renamedPaths = [];

  previousMetadata.forEach((previousEntry, pathValue) => {
    const nextEntry = nextMetadata.get(pathValue);
    if (!nextEntry) {
      if (previousEntry.type === 'file') {
        deletedPaths.add(pathValue);
      }
      return;
    }

    if (entrySignature(previousEntry) !== entrySignature(nextEntry) && nextEntry.type === 'file') {
      changedPaths.add(pathValue);
    }
  });

  nextMetadata.forEach((nextEntry, pathValue) => {
    if (!previousMetadata.has(pathValue) && nextEntry.type === 'file') {
      addedPaths.add(pathValue);
    }
  });

  const deletedBySignature = new Map();
  deletedPaths.forEach((pathValue) => {
    const metadata = previousMetadata.get(pathValue);
    const signature = entrySignature(metadata);
    const bucket = deletedBySignature.get(signature) ?? [];
    bucket.push(pathValue);
    deletedBySignature.set(signature, bucket);
  });

  const addedBySignature = new Map();
  addedPaths.forEach((pathValue) => {
    const metadata = nextMetadata.get(pathValue);
    const signature = entrySignature(metadata);
    const bucket = addedBySignature.get(signature) ?? [];
    bucket.push(pathValue);
    addedBySignature.set(signature, bucket);
  });

  Array.from(deletedBySignature.keys()).forEach((signature) => {
    const removed = deletedBySignature.get(signature) ?? [];
    const added = addedBySignature.get(signature) ?? [];
    if (removed.length === 1 && added.length === 1) {
      renamedPaths.push({ oldPath: removed[0], newPath: added[0] });
      deletedPaths.delete(removed[0]);
      addedPaths.delete(added[0]);
    }
  });

  const previousDirectories = Array.from(previousMetadata.entries())
    .filter(([, entry]) => entry.type === 'directory' && !nextMetadata.has(entry.path));
  const nextDirectories = Array.from(nextMetadata.entries())
    .filter(([, entry]) => entry.type === 'directory' && !previousMetadata.has(entry.path));

  previousDirectories.forEach(([oldPath, oldEntry]) => {
    const match = nextDirectories.find(([, nextEntry]) => entrySignature(oldEntry) === entrySignature(nextEntry));
    if (!match) {
      return;
    }

    const [newPath] = match;
    buildPrefixRenameEntries(previousState, nextState, oldPath, newPath).forEach((entry) => {
      renamedPaths.push(entry);
      deletedPaths.delete(entry.oldPath);
      addedPaths.delete(entry.newPath);
    });
  });

  addedPaths.forEach((pathValue) => {
    changedPaths.add(pathValue);
  });

  return createWorkspaceChange({
    changedPaths: sortByPath(Array.from(changedPaths)),
    deletedPaths: sortByPath(Array.from(deletedPaths)),
    renamedPaths,
    refreshExplorer: true,
  });
}

export class FileSystemSyncService {
  constructor({
    debounceMs = 180,
    mutationCoordinator,
    vaultFileStore,
  }) {
    this.debounceMs = debounceMs;
    this.mutationCoordinator = mutationCoordinator;
    this.vaultFileStore = vaultFileStore;
    this.watcher = null;
    this.debounceTimer = null;
    this.runningFlush = null;
    this.lastState = null;
  }

  async start() {
    this.lastState = this.mutationCoordinator.workspaceState ?? await this.vaultFileStore.scanWorkspaceState();
    this.watcher = watch(this.vaultFileStore.vaultDir, { recursive: true }, () => {
      this.scheduleFlush();
    });
  }

  scheduleFlush() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.runningFlush = this.flush().finally(() => {
        this.runningFlush = null;
      });
    }, this.debounceMs);
    this.debounceTimer.unref?.();
  }

  async flush() {
    const nextState = await this.vaultFileStore.scanWorkspaceState();
    const workspaceChange = detectWorkspaceChange(this.lastState, nextState);
    this.lastState = nextState;

    const filteredChange = this.mutationCoordinator.filterManagedWorkspaceChange(workspaceChange);
    if (!filteredChange) {
      this.mutationCoordinator.workspaceState = nextState;
      this.mutationCoordinator.getWorkspaceRoom()?.replaceWorkspaceEntries(nextState.entries, {
        generatedAt: nextState.scannedAt,
      });
      return;
    }

    await this.mutationCoordinator.apply({
      action: 'filesystem-sync',
      origin: 'filesystem',
      nextState,
      workspaceChange: filteredChange,
    });
  }

  async close() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    await this.runningFlush;
  }
}
