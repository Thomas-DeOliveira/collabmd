import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';

import { getVaultTreeNodeType, isVaultFilePath } from '../../../domain/file-kind.js';
import { getVaultContentAdapter } from './vault-content-adapter.js';
import {
  INVALID_VAULT_FILE_PATH_ERROR,
  isIgnoredVaultEntry,
  resolveVaultDirectoryPath,
  resolveVaultFilePath,
  resolveVaultRenamePaths,
  sanitizeVaultPath,
  toVaultRelativePath,
} from './path-utils.js';
import { SidecarStore } from './sidecar-store.js';

export class VaultFileStore {
  constructor({ vaultDir }) {
    this.vaultDir = resolve(vaultDir);
    this.sidecarStore = new SidecarStore({ vaultDir: this.vaultDir });
  }

  async tree() {
    return this.readDirectory(this.vaultDir);
  }

  async readDirectory(dirPath) {
    const entries = [];

    let dirEntries;
    try {
      dirEntries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return entries;
    }

    const sorted = dirEntries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    for (const entry of sorted) {
      if (isIgnoredVaultEntry(entry.name)) {
        continue;
      }

      const fullPath = join(dirPath, entry.name);
      const relativePath = toVaultRelativePath(this.vaultDir, fullPath);

      if (entry.isDirectory()) {
        entries.push({
          children: await this.readDirectory(fullPath),
          name: entry.name,
          path: relativePath,
          type: 'directory',
        });
        continue;
      }

      if (isVaultFilePath(entry.name)) {
        entries.push({
          name: entry.name,
          path: relativePath,
          type: getVaultTreeNodeType(entry.name),
        });
      }
    }

    return entries;
  }

  resolveContentPath(filePath, { requireVaultFile = true } = {}) {
    if (!requireVaultFile) {
      return sanitizeVaultPath(this.vaultDir, filePath);
    }

    return resolveVaultFilePath(this.vaultDir, filePath).absolute;
  }

  resolveAdapter(filePath) {
    const absolute = this.resolveContentPath(filePath);
    if (!absolute) {
      return null;
    }

    const adapter = getVaultContentAdapter(absolute);
    if (!adapter) {
      return null;
    }

    return { absolute, adapter };
  }

  async readContentFile(filePath, expectedKind) {
    const resolved = this.resolveAdapter(filePath);
    if (!resolved || resolved.adapter.kind !== expectedKind) {
      return null;
    }

    try {
      return await readFile(resolved.absolute, 'utf-8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  async writeContentFile(filePath, content, expectedKind, { invalidateCollaborationSnapshot = true } = {}) {
    const resolved = this.resolveAdapter(filePath);
    if (!resolved || resolved.adapter.kind !== expectedKind) {
      return {
        ok: false,
        error: resolved?.adapter?.invalidPathError ?? getVaultContentAdapter(filePath)?.invalidPathError ?? INVALID_VAULT_FILE_PATH_ERROR,
      };
    }

    try {
      await mkdir(dirname(resolved.absolute), { recursive: true });
      await writeFile(resolved.absolute, content, 'utf-8');
      if (invalidateCollaborationSnapshot) {
        await this.deleteCollaborationSnapshot(filePath);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async readMarkdownFile(filePath) {
    return this.readContentFile(filePath, 'markdown');
  }

  async readExcalidrawFile(filePath) {
    return this.readContentFile(filePath, 'excalidraw');
  }

  async readMermaidFile(filePath) {
    return this.readContentFile(filePath, 'mermaid');
  }

  async readPlantUmlFile(filePath) {
    return this.readContentFile(filePath, 'plantuml');
  }

  async writeMarkdownFile(filePath, content, options = {}) {
    return this.writeContentFile(filePath, content, 'markdown', options);
  }

  async writeExcalidrawFile(filePath, content, options = {}) {
    return this.writeContentFile(filePath, content, 'excalidraw', options);
  }

  async writeMermaidFile(filePath, content, options = {}) {
    return this.writeContentFile(filePath, content, 'mermaid', options);
  }

  async writePlantUmlFile(filePath, content, options = {}) {
    return this.writeContentFile(filePath, content, 'plantuml', options);
  }

  async readCommentThreads(filePath) {
    return this.sidecarStore.readCommentThreads(filePath);
  }

  async writeCommentThreads(filePath, threads = []) {
    return this.sidecarStore.writeCommentThreads(filePath, threads);
  }

  async readCollaborationSnapshot(filePath) {
    return this.sidecarStore.readSnapshot(filePath);
  }

  async writeCollaborationSnapshot(filePath, snapshot) {
    return this.sidecarStore.writeSnapshot(filePath, snapshot);
  }

  async deleteCollaborationSnapshot(filePath) {
    return this.sidecarStore.deleteSnapshot(filePath);
  }

  async createFile(filePath, content = '') {
    const { absolute, error } = resolveVaultFilePath(this.vaultDir, filePath);
    if (!absolute) {
      return { ok: false, error };
    }

    try {
      await stat(absolute);
      return { ok: false, error: 'File already exists' };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf-8');
    await this.deleteCollaborationSnapshot(filePath);
    return { ok: true };
  }

  async deleteFile(filePath) {
    const { absolute, error } = resolveVaultFilePath(this.vaultDir, filePath);
    if (!absolute) {
      return { ok: false, error };
    }

    try {
      await rm(absolute, { force: true });
      await this.sidecarStore.deleteAllForFile(filePath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async renameFile(oldPath, newPath) {
    const { absoluteNew, absoluteOld, error } = resolveVaultRenamePaths(this.vaultDir, oldPath, newPath);
    if (!absoluteOld || !absoluteNew) {
      return { ok: false, error };
    }

    try {
      await mkdir(dirname(absoluteNew), { recursive: true });
      await rename(absoluteOld, absoluteNew);
      await this.sidecarStore.renameAllForFile(oldPath, newPath);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async createDirectory(dirPath) {
    const { absolute, error } = resolveVaultDirectoryPath(this.vaultDir, dirPath);
    if (!absolute) {
      return { ok: false, error };
    }

    try {
      await mkdir(absolute, { recursive: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async countVaultFiles() {
    return this.countFilesInDir(this.vaultDir);
  }

  async countFilesInDir(dirPath) {
    let count = 0;

    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return 0;
    }

    for (const entry of entries) {
      if (isIgnoredVaultEntry(entry.name)) {
        continue;
      }

      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        count += await this.countFilesInDir(fullPath);
      } else if (isVaultFilePath(entry.name)) {
        count += 1;
      }
    }

    return count;
  }

  resolveWikiLink(linkTarget) {
    const normalized = linkTarget.endsWith('.md') ? linkTarget : `${linkTarget}.md`;
    const absolute = this.resolveContentPath(normalized, { requireVaultFile: false });
    if (!absolute) {
      return null;
    }

    return toVaultRelativePath(this.vaultDir, absolute);
  }
}
