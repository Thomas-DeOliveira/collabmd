import test from 'node:test';
import assert from 'node:assert/strict';

import { FileActionController } from '../../src/client/presentation/file-action-controller.js';
import { FileTreeState } from '../../src/client/presentation/file-tree-state.js';

function installDocumentStub(t) {
  const originalDocument = globalThis.document;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

  globalThis.document = {
    getElementById() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };

  t.after(() => {
    globalThis.document = originalDocument;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  });
}

function createController(t, overrides = {}) {
  installDocumentStub(t);

  const calls = [];
  const state = overrides.state ?? new FileTreeState();
  const controller = new FileActionController({
    onFileDelete: (filePath) => calls.push(['delete-callback', filePath]),
    onFileSelect: (filePath) => calls.push(['select', filePath]),
    refresh: async () => {
      calls.push(['refresh']);
    },
    state,
    toastController: {
      show(message) {
        calls.push(['toast', message]);
      },
    },
    vaultClient: overrides.vaultClient ?? {
      async createDirectory(path) {
        calls.push(['create-directory', path]);
      },
      async createFile({ content, path }) {
        calls.push(['create-file', path, content]);
      },
      async deleteFile(path) {
        calls.push(['delete-file', path]);
      },
      async renameFile({ newPath, oldPath }) {
        calls.push(['rename-file', oldPath, newPath]);
      },
    },
    view: { removeContextMenu() {} },
  });

  return { calls, controller, state };
}

test('FileActionController creates files and expands parent directories', async (t) => {
  const { calls, controller, state } = createController(t);

  const created = await controller.createVaultFile('plans/q1.md', '# q1\n', { openAfterCreate: true });

  assert.equal(created, true);
  assert.deepEqual(calls, [
    ['create-file', 'plans/q1.md', '# q1\n'],
    ['refresh'],
    ['select', 'plans/q1.md'],
  ]);
  assert.deepEqual([...state.expandedDirs], ['plans']);
});

test('FileActionController renames the active file and notifies selection listeners', async (t) => {
  const state = new FileTreeState();
  state.activeFilePath = 'notes/today.md';
  const { calls, controller } = createController(t, { state });

  const renamed = await controller.renameVaultFile('notes/today.md', 'tomorrow', '.md');

  assert.equal(renamed, true);
  assert.equal(state.activeFilePath, 'notes/tomorrow.md');
  assert.deepEqual(calls, [
    ['rename-file', 'notes/today.md', 'notes/tomorrow.md'],
    ['refresh'],
    ['select', 'notes/tomorrow.md'],
  ]);
});

test('FileActionController clears active state when deleting the open file', async (t) => {
  const state = new FileTreeState();
  state.activeFilePath = 'notes/today.md';
  const { calls, controller } = createController(t, { state });

  const deleted = await controller.deleteVaultFile('notes/today.md');

  assert.equal(deleted, true);
  assert.equal(state.activeFilePath, null);
  assert.deepEqual(calls, [
    ['delete-file', 'notes/today.md'],
    ['refresh'],
    ['delete-callback', 'notes/today.md'],
  ]);
});

test('FileActionController rejects nested rename targets', async (t) => {
  const { calls, controller } = createController(t);

  const renamed = await controller.renameVaultFile('notes/today.md', 'next/week', '.md');

  assert.equal(renamed, false);
  assert.deepEqual(calls, [
    ['toast', 'Rename only supports the file name right now'],
  ]);
});
