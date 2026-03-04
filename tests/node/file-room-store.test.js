import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { FileRoomStore } from '../../src/server/infrastructure/persistence/file-room-store.js';

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), 'collabmd-store-'));
  return {
    cleanup: () => rm(directory, { force: true, recursive: true }),
    directory,
    store: new FileRoomStore({ directory }),
  };
}

test('FileRoomStore writes, reads, and removes room snapshots', async (t) => {
  const { store, cleanup } = await createStore();
  t.after(cleanup);

  const update = new Uint8Array([1, 2, 3, 4]);
  await store.write('room/alpha', update);

  const persisted = await store.read('room/alpha');
  assert.deepEqual(Array.from(persisted), Array.from(update));

  await store.write('room/alpha', new Uint8Array());
  assert.equal(await store.read('room/alpha'), null);
});

test('FileRoomStore treats empty snapshot files as missing state', async (t) => {
  const { store, directory, cleanup } = await createStore();
  t.after(cleanup);

  await writeFile(join(directory, 'room-beta.bin'), '');
  assert.equal(await store.read('room-beta'), null);
});

test('FileRoomStore quarantines corrupt files with a renamed snapshot', async (t) => {
  const { store, directory, cleanup } = await createStore();
  t.after(cleanup);

  await writeFile(join(directory, 'room-gamma.bin'), 'broken');

  const quarantinedPath = await store.quarantine('room-gamma');
  assert.ok(quarantinedPath);
  assert.equal(await store.read('room-gamma'), null);

  const file = await stat(quarantinedPath);
  assert.ok(file.isFile());
});
