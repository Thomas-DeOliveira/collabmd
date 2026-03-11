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
