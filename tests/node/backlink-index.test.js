import test from 'node:test';
import assert from 'node:assert/strict';

import { BacklinkIndex } from '../../src/server/domain/backlink-index.js';

class StubVaultStore {
  constructor(files) {
    this.files = new Map(files);
    this.readCount = 0;
  }

  async tree() {
    return [...this.files.keys()]
      .sort((left, right) => left.localeCompare(right))
      .map((path) => ({
        name: path.split('/').pop(),
        path,
        type: 'file',
      }));
  }

  async readMarkdownFile(path) {
    this.readCount += 1;
    return this.files.get(path) ?? null;
  }
}

test('BacklinkIndex serves cached contexts without additional file reads', async () => {
  const vaultFileStore = new StubVaultStore([
    ['source.md', '# Source\n\nSee [[target]].'],
    ['target.md', '# Target'],
  ]);
  const index = new BacklinkIndex({ vaultFileStore });

  await index.build();
  const readsAfterBuild = vaultFileStore.readCount;

  const backlinks = await index.getBacklinks('target.md');
  assert.deepEqual(backlinks, [
    {
      contexts: ['See [[target]].'],
      file: 'source.md',
    },
  ]);
  assert.equal(vaultFileStore.readCount, readsAfterBuild);
});

test('BacklinkIndex remaps backlink contexts when target file is renamed', async () => {
  const vaultFileStore = new StubVaultStore([
    ['a.md', 'Line one [[b]].\nLine two [[b]].'],
    ['b.md', '# b'],
  ]);
  const index = new BacklinkIndex({ vaultFileStore });

  await index.build();
  index.onFileRenamed('b.md', 'c.md');

  const oldTargetBacklinks = await index.getBacklinks('b.md');
  assert.deepEqual(oldTargetBacklinks, []);

  const newTargetBacklinks = await index.getBacklinks('c.md');
  assert.deepEqual(newTargetBacklinks, [
    {
      contexts: ['Line one [[b]].', 'Line two [[b]].'],
      file: 'a.md',
    },
  ]);
});

test('BacklinkIndex flushes scheduled rebuilds when backlinks are queried', async () => {
  const timers = [];
  const vaultFileStore = new StubVaultStore([
    ['source.md', '# Source\n\nSee [[target]].'],
    ['target.md', '# Target'],
  ]);
  const index = new BacklinkIndex({
    clearTimeoutFn(timer) {
      timer.cleared = true;
    },
    setTimeoutFn(callback) {
      const timer = {
        callback,
        cleared: false,
        unref() {},
      };
      timers.push(timer);
      return timer;
    },
    vaultFileStore,
  });

  await index.build();
  vaultFileStore.files.set('source.md', '# Source\n\nNo links now.');

  index.scheduleBuild();
  const backlinks = await index.getBacklinks('target.md');

  assert.equal(timers.length, 1);
  assert.equal(timers[0].cleared, true);
  assert.deepEqual(backlinks, []);
});
