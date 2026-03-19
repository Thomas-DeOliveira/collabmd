import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkspaceMutationCoordinator } from '../../src/server/infrastructure/workspace/workspace-mutation-coordinator.js';

function createState(paths = []) {
  return {
    entries: new Map(paths.map((pathValue) => [pathValue, { path: pathValue, type: 'file' }])),
    metadata: new Map(),
    scannedAt: Date.now(),
  };
}

test('WorkspaceMutationCoordinator applies small backlink renames incrementally', async () => {
  const calls = [];
  const coordinator = new WorkspaceMutationCoordinator({
    backlinkIndex: {
      build() {
        calls.push(['build']);
      },
      onFileDeleted(pathValue) {
        calls.push(['delete', pathValue]);
      },
      onFileRenamed(oldPath, newPath) {
        calls.push(['rename', oldPath, newPath]);
      },
      updateFile(pathValue) {
        calls.push(['update', pathValue]);
      },
    },
    roomRegistry: null,
    vaultFileStore: {
      readMarkdownFile: async () => null,
    },
  });

  coordinator.workspaceState = createState(['a.md', 'b.md']);
  await coordinator.reconcileBacklinks({
    changedPaths: [],
    deletedPaths: [],
    renamedPaths: [{ oldPath: 'a.md', newPath: 'c.md' }],
  }, createState(['b.md', 'c.md']));

  assert.deepEqual(calls, [['rename', 'a.md', 'c.md']]);
});

test('WorkspaceMutationCoordinator schedules large backlink rebuilds without awaiting a full build', async () => {
  const calls = [];
  const coordinator = new WorkspaceMutationCoordinator({
    backlinkIndex: {
      scheduleBuild() {
        calls.push(['schedule-build']);
      },
    },
    roomRegistry: null,
    vaultFileStore: {
      readMarkdownFile: async () => null,
    },
  });

  coordinator.workspaceState = createState(['note-1.md']);
  await coordinator.reconcileBacklinks({
    changedPaths: Array.from({ length: 26 }, (_, index) => `note-${index}.md`),
    deletedPaths: [],
    renamedPaths: [],
  }, createState(['note-1.md']));

  assert.deepEqual(calls, [['schedule-build']]);
});
