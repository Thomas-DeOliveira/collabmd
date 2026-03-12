import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  createCommentThreadSharedType,
  normalizeCommentQuote,
  normalizeCommentQuoteForComparison,
  serializeCommentThreads,
} from '../../src/domain/comment-threads.js';

test('comment thread serialization supports new line and text anchors', () => {
  const doc = new Y.Doc();
  const threads = doc.getArray('comments');
  const lineThread = createCommentThreadSharedType({
    anchorEnd: { assoc: 0, type: null },
    anchorEndLine: 4,
    anchorKind: 'line',
    anchorQuote: 'Line quote',
    anchorStart: { assoc: 0, type: null },
    anchorStartLine: 4,
    id: 'thread-line',
    messages: [{
      body: 'Line thread',
      id: 'comment-line',
      userName: 'Tester',
    }],
  });
  const textThread = createCommentThreadSharedType({
    anchorEnd: { assoc: 0, type: null },
    anchorEndLine: 5,
    anchorKind: 'text',
    anchorQuote: 'selected text',
    anchorStart: { assoc: 0, type: null },
    anchorStartLine: 5,
    id: 'thread-text',
    messages: [{
      body: 'Text thread',
      id: 'comment-text',
      userName: 'Tester',
    }],
  });

  threads.push([lineThread, textThread]);

  const serialized = serializeCommentThreads(threads);
  assert.equal(serialized.length, 2);
  assert.equal(serialized[0].anchorKind, 'line');
  assert.equal(serialized[1].anchorKind, 'text');
  assert.equal(serialized[1].anchorQuote, 'selected text');
});

test('comment thread serialization ignores old-format thread records', () => {
  const doc = new Y.Doc();
  const threads = doc.getArray('comments');
  const legacyMessages = new Y.Array();
  legacyMessages.push([{
    body: 'Legacy comment',
    id: 'comment-old',
    userName: 'Tester',
  }]);
  const legacyThread = new Y.Map();
  legacyThread.set('anchorEnd', { assoc: 0, type: null });
  legacyThread.set('anchorEndLine', 3);
  legacyThread.set('anchorExcerpt', 'old format');
  legacyThread.set('anchorStart', { assoc: 0, type: null });
  legacyThread.set('anchorStartLine', 3);
  legacyThread.set('id', 'thread-old');
  legacyThread.set('messages', legacyMessages);
  threads.push([legacyThread]);

  assert.deepEqual(serializeCommentThreads(threads), []);
});

test('normalizeCommentQuote preserves source formatting while trimming edges', () => {
  assert.equal(normalizeCommentQuote(' Hello \n   from\tcomment '), 'Hello \n   from\tcomment');
});

test('normalizeCommentQuoteForComparison collapses whitespace for stable preview matching', () => {
  assert.equal(normalizeCommentQuoteForComparison(' Hello \n   from\tcomment '), 'Hello from comment');
});
