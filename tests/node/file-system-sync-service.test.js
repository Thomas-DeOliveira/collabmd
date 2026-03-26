import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { VaultFileStore } from '../../src/server/infrastructure/persistence/vault-file-store.js';
import { FileSystemSyncService } from '../../src/server/infrastructure/workspace/file-system-sync-service.js';

async function createVault() {
  const vaultDir = await mkdtemp(join(tmpdir(), 'collabmd-fs-sync-'));
  await mkdir(join(vaultDir, 'docs'), { recursive: true });
  await writeFile(join(vaultDir, 'README.md'), '# Readme\n', 'utf8');
  await writeFile(join(vaultDir, 'docs', 'guide.md'), '# Guide\n', 'utf8');

  return {
    cleanup: () => rm(vaultDir, { force: true, recursive: true }),
    store: new VaultFileStore({ vaultDir }),
    vaultDir,
  };
}

test('FileSystemSyncService applies single-file content changes without a full workspace rescan', async (t) => {
  const { cleanup, store, vaultDir } = await createVault();
  t.after(cleanup);

  const baselineState = await store.scanWorkspaceState();
  let scanCount = 0;
  const originalScanWorkspaceState = store.scanWorkspaceState.bind(store);
  store.scanWorkspaceState = async (...args) => {
    scanCount += 1;
    return originalScanWorkspaceState(...args);
  };

  let applied = null;
  const mutationCoordinator = {
    filterManagedWorkspaceChange(workspaceChange) {
      return workspaceChange;
    },
    async apply(payload) {
      applied = payload;
      return payload;
    },
    getWorkspaceRoom() {
      return null;
    },
    workspaceState: baselineState,
  };

  const service = new FileSystemSyncService({
    mutationCoordinator,
    vaultFileStore: store,
  });
  service.lastState = baselineState;
  service.pendingEventTypesByPath.set('README.md', new Set(['change']));

  await writeFile(join(vaultDir, 'README.md'), '# Readme\n\nUpdated\n', 'utf8');
  await service.flush();

  assert.equal(scanCount, 0);
  assert.deepEqual(applied?.workspaceChange?.changedPaths, ['README.md']);
  assert.equal(applied?.nextState?.entries?.has('README.md'), true);
});

test('FileSystemSyncService falls back to a full workspace rescan for rename events', async (t) => {
  const { cleanup, store, vaultDir } = await createVault();
  t.after(cleanup);

  const baselineState = await store.scanWorkspaceState();
  let scanCount = 0;
  const originalScanWorkspaceState = store.scanWorkspaceState.bind(store);
  store.scanWorkspaceState = async (...args) => {
    scanCount += 1;
    return originalScanWorkspaceState(...args);
  };

  let applied = null;
  const mutationCoordinator = {
    filterManagedWorkspaceChange(workspaceChange) {
      return workspaceChange;
    },
    async apply(payload) {
      applied = payload;
      return payload;
    },
    getWorkspaceRoom() {
      return null;
    },
    workspaceState: baselineState,
  };

  const service = new FileSystemSyncService({
    mutationCoordinator,
    vaultFileStore: store,
  });
  service.lastState = baselineState;
  service.pendingEventTypesByPath.set('README.md', new Set(['rename']));
  service.forceFullScan = true;

  await rename(join(vaultDir, 'README.md'), join(vaultDir, 'docs', 'README.md'));
  await service.flush();

  assert.equal(scanCount, 1);
  assert.deepEqual(applied?.workspaceChange?.renamedPaths, [{
    oldPath: 'README.md',
    newPath: 'docs/README.md',
  }]);
});

test('FileSystemSyncService emits gated perf logs for full-scan fallback reasons', async (t) => {
  const { cleanup, store, vaultDir } = await createVault();
  t.after(cleanup);

  const perfLogs = [];
  const originalConsoleInfo = console.info;
  console.info = (...args) => {
    perfLogs.push(args.join(' '));
  };
  t.after(() => {
    console.info = originalConsoleInfo;
  });

  const baselineState = await store.scanWorkspaceState();
  const mutationCoordinator = {
    filterManagedWorkspaceChange(workspaceChange) {
      return workspaceChange;
    },
    async apply(payload) {
      return payload;
    },
    getWorkspaceRoom() {
      return null;
    },
    workspaceState: baselineState,
  };

  const service = new FileSystemSyncService({
    mutationCoordinator,
    perfLoggingEnabled: true,
    vaultFileStore: store,
  });
  service.lastState = baselineState;
  service.pendingEventTypesByPath.set('README.md', new Set(['rename']));
  service.forceFullScan = true;

  await rename(join(vaultDir, 'README.md'), join(vaultDir, 'docs', 'README.md'));
  await service.flush();

  assert.ok(perfLogs.some((line) => (
    line.includes('[perf][filesystem-sync]')
    && line.includes('mode=full-scan')
    && line.includes('fallbackReason=forced-full-scan')
  )));
});
