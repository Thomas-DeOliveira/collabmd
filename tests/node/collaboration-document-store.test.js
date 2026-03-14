import test from 'node:test';
import assert from 'node:assert/strict';

import { CollaborationDocumentStore } from '../../src/server/domain/collaboration/collaboration-document-store.js';

function createDocumentStore({
  contentResult = { ok: true },
  commentResult = { ok: true },
  snapshotResult = { ok: true },
} = {}) {
  const calls = {
    backlinks: [],
    comments: [],
    content: [],
    snapshots: [],
  };

  const vaultFileStore = {
    async writeCommentThreads(path, threads) {
      calls.comments.push({ path, threads });
      return commentResult;
    },
    async writeCollaborationSnapshot(path, snapshot) {
      calls.snapshots.push({ path, snapshot });
      return snapshotResult;
    },
    async writeMarkdownFile(path, content, options) {
      calls.content.push({ content, options, path });
      return contentResult;
    },
  };

  const backlinkIndex = {
    updateFile(path, content) {
      calls.backlinks.push({ content, path });
    },
  };

  return {
    calls,
    store: new CollaborationDocumentStore({
      backlinkIndex,
      name: 'notes.md',
      vaultFileStore,
    }),
  };
}

test('CollaborationDocumentStore rejects persistence when content write reports a failure result', async () => {
  const { calls, store } = createDocumentStore({
    contentResult: { ok: false, error: 'disk full' },
  });

  await assert.rejects(
    () => store.persistState({
      commentThreads: [{ id: 'thread-1' }],
      content: '# Draft\n',
      snapshot: Uint8Array.from([1, 2, 3]),
    }),
    /Failed to write content for "notes\.md": disk full/,
  );

  assert.equal(calls.content.length, 1);
  assert.equal(calls.comments.length, 0);
  assert.equal(calls.snapshots.length, 0);
  assert.equal(calls.backlinks.length, 0);
});

test('CollaborationDocumentStore rejects persistence when comment sidecar writes fail', async () => {
  const { calls, store } = createDocumentStore({
    commentResult: { ok: false, error: 'read only filesystem' },
  });

  await assert.rejects(
    () => store.persistState({
      commentThreads: [{ id: 'thread-1' }],
      content: '# Draft\n',
      snapshot: Uint8Array.from([1, 2, 3]),
    }),
    /Failed to write comment threads for "notes\.md": read only filesystem/,
  );

  assert.equal(calls.content.length, 1);
  assert.equal(calls.comments.length, 1);
  assert.equal(calls.snapshots.length, 0);
  assert.equal(calls.backlinks.length, 0);
});

test('CollaborationDocumentStore rejects persistence when snapshot writes fail', async () => {
  const { calls, store } = createDocumentStore({
    snapshotResult: { ok: false, error: 'snapshot path unavailable' },
  });

  await assert.rejects(
    () => store.persistState({
      commentThreads: [{ id: 'thread-1' }],
      content: '# Draft\n',
      snapshot: Uint8Array.from([1, 2, 3]),
    }),
    /Failed to write collaboration snapshot for "notes\.md": snapshot path unavailable/,
  );

  assert.equal(calls.content.length, 1);
  assert.equal(calls.comments.length, 1);
  assert.equal(calls.snapshots.length, 1);
  assert.equal(calls.backlinks.length, 0);
});

test('CollaborationDocumentStore prefers an atomic collaboration persist when the store provides one', async () => {
  const calls = {
    atomic: [],
    backlinks: [],
  };

  const store = new CollaborationDocumentStore({
    backlinkIndex: {
      updateFile(path, content) {
        calls.backlinks.push({ content, path });
      },
    },
    name: 'notes.md',
    vaultFileStore: {
      async persistCollaborationState(path, state) {
        calls.atomic.push({ path, state });
        return { ok: true };
      },
    },
  });

  const snapshot = Uint8Array.from([4, 5, 6]);
  const commentThreads = [{ id: 'thread-1' }];
  await store.persistState({
    commentThreads,
    content: '# Atomic\n',
    snapshot,
  });

  assert.equal(calls.atomic.length, 1);
  assert.equal(calls.atomic[0].path, 'notes.md');
  assert.equal(calls.atomic[0].state.content, '# Atomic\n');
  assert.equal(calls.atomic[0].state.commentThreads, commentThreads);
  assert.equal(calls.atomic[0].state.snapshot, snapshot);
  assert.deepEqual(calls.backlinks, [{ content: '# Atomic\n', path: 'notes.md' }]);
});
