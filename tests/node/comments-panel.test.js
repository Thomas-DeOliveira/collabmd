import test from 'node:test';
import assert from 'node:assert/strict';

import { countThreadsForSourceBlocks } from '../../src/client/presentation/comments-panel.js';

test('countThreadsForSourceBlocks counts sorted sparse thread ranges per block', () => {
  const counts = countThreadsForSourceBlocks([
    { endLine: 3, startLine: 1 },
    { endLine: 5, startLine: 3 },
    { endLine: 10, startLine: 8 },
  ], [
    { anchor: { startLine: 1 } },
    { anchor: { startLine: 2 } },
    { anchor: { startLine: 4 } },
    { anchor: { startLine: 8 } },
    { anchor: { startLine: 9 } },
  ]);

  assert.deepEqual(counts, [2, 1, 2]);
});

test('countThreadsForSourceBlocks ignores invalid blocks and preserves empty ranges', () => {
  const counts = countThreadsForSourceBlocks([
    { endLine: 4, startLine: 4 },
    { endLine: 7, startLine: 6 },
    { endLine: 0, startLine: null },
  ], [
    { anchor: { startLine: 5 } },
    { anchor: { startLine: 7 } },
  ]);

  assert.deepEqual(counts, [0, 0, 0]);
});
