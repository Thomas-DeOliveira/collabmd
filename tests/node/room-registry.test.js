import test from 'node:test';
import assert from 'node:assert/strict';

import { RoomRegistry } from '../../src/server/domain/collaboration/room-registry.js';

test('RoomRegistry reset destroys active rooms and clears the registry', async () => {
  const destroyed = [];
  const registry = new RoomRegistry({
    createRoom: ({ name }) => ({
      destroy() {
        destroyed.push(name);
      },
    }),
  });

  registry.getOrCreate('README.md');
  registry.getOrCreate('sample-mermaid.mmd');

  await registry.reset();

  assert.deepEqual(destroyed.sort(), ['README.md', 'sample-mermaid.mmd']);
  assert.equal(registry.rooms.size, 0);
});

test('RoomRegistry replaces deleted rooms without letting stale room cleanup remove the replacement', () => {
  const callbacks = new Map();
  let roomId = 0;
  const registry = new RoomRegistry({
    createRoom: ({ onEmpty }) => {
      const room = {
        deleted: false,
        id: ++roomId,
        isDeleted() {
          return this.deleted;
        },
        markDeleted() {
          this.deleted = true;
        },
      };
      callbacks.set(room, onEmpty);
      return room;
    },
  });

  const originalRoom = registry.getOrCreate('README.md');
  originalRoom.markDeleted();

  const replacementRoom = registry.getOrCreate('README.md');

  assert.notEqual(replacementRoom, originalRoom);
  assert.equal(registry.get('README.md'), replacementRoom);

  callbacks.get(originalRoom)?.('README.md');
  assert.equal(registry.get('README.md'), replacementRoom);

  callbacks.get(replacementRoom)?.('README.md');
  assert.equal(registry.get('README.md'), undefined);
});

test('RoomRegistry reconciles workspace changes by reloading changed rooms, destroying deletions, and preserving renames', async () => {
  const events = [];
  const registry = new RoomRegistry({
    createRoom: ({ name }) => ({
      name,
      async destroy() {
        events.push(['destroy', name]);
      },
      isDeleted() {
        return false;
      },
      markDeleted() {
        events.push(['mark-deleted', name]);
      },
      async reloadFromDisk() {
        events.push(['reload', name]);
      },
    }),
  });

  registry.getOrCreate('changed.md');
  registry.getOrCreate('deleted.md');
  registry.getOrCreate('renamed-old.md');

  await registry.reconcileWorkspaceChange({
    changedPaths: ['changed.md'],
    deletedPaths: ['deleted.md'],
    renamedPaths: [{ oldPath: 'renamed-old.md', newPath: 'renamed-new.md' }],
  });

  assert.deepEqual(events, [
    ['mark-deleted', 'deleted.md'],
    ['destroy', 'deleted.md'],
    ['reload', 'changed.md'],
  ]);
  assert.equal(registry.get('deleted.md'), undefined);
  assert.equal(registry.get('renamed-old.md'), undefined);
  assert.notEqual(registry.get('renamed-new.md'), undefined);
});
