import test from 'node:test';
import assert from 'node:assert/strict';

import * as Y from 'yjs';

import { CollaborationRoom } from '../../src/server/domain/collaboration/collaboration-room.js';

function createSocket({ bufferedAmount = 0 } = {}) {
  return {
    OPEN: 1,
    backpressureCloseIssued: false,
    bufferedAmount,
    closeCalls: [],
    readyState: 1,
    sent: [],
    send(payload, callback) {
      this.sent.push(payload);
      callback?.();
    },
    close(code, reason) {
      this.closeCalls.push({ code, reason });
      this.readyState = 2;
    },
    terminate() {
      this.readyState = 3;
    },
  };
}

test('CollaborationRoom hydrates once for concurrent joins', async () => {
  let readCount = 0;
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'hydration-room',
    onEmpty: () => {},
    vaultFileStore: {
      async readMarkdownFile() {
        readCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return '# persisted';
      },
      async writeMarkdownFile() {},
    },
  });

  await Promise.all([room.addClient(createSocket()), room.addClient(createSocket())]);

  assert.equal(readCount, 1);
  assert.equal(room.doc.getText('codemirror').toString(), '# persisted');
});

test('CollaborationRoom closes slow clients when buffered writes exceed the limit', async () => {
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 4,
    name: 'backpressure-room',
    onEmpty: () => {},
    vaultFileStore: null,
  });

  const origin = createSocket();
  const slowClient = createSocket();

  await room.addClient(origin);
  await room.addClient(slowClient);

  const sentCountBeforeBroadcast = slowClient.sent.length;
  slowClient.bufferedAmount = 10;

  const clientDoc = new Y.Doc();
  clientDoc.getText('codemirror').insert(0, 'hello');
  Y.applyUpdate(room.doc, Y.encodeStateAsUpdate(clientDoc), origin);

  assert.equal(slowClient.sent.length, sentCountBeforeBroadcast);
  assert.equal(slowClient.closeCalls.length, 1);
  assert.deepEqual(slowClient.closeCalls[0], {
    code: 1013,
    reason: 'Client too slow',
  });
});

test('CollaborationRoom hydrates and persists excalidraw rooms via excalidraw file APIs', async () => {
  const initialScene = JSON.stringify({
    appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
    elements: [{ id: 'shape-1' }],
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  });
  let readExcalidrawCount = 0;
  const writes = [];
  let backlinkUpdates = 0;

  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'diagram.excalidraw',
    onEmpty: () => {},
    backlinkIndex: {
      updateFile() {
        backlinkUpdates += 1;
      },
    },
    vaultFileStore: {
      async readExcalidrawFile(path) {
        readExcalidrawCount += 1;
        assert.equal(path, 'diagram.excalidraw');
        return initialScene;
      },
      async readMarkdownFile() {
        throw new Error('readMarkdownFile should not be called for .excalidraw rooms');
      },
      async writeExcalidrawFile(path, content) {
        writes.push({ content, path });
        return { ok: true };
      },
      async writeMarkdownFile() {
        throw new Error('writeMarkdownFile should not be called for .excalidraw rooms');
      },
    },
  });

  await room.hydrate();
  assert.equal(readExcalidrawCount, 1);
  assert.equal(room.doc.getText('codemirror').toString(), initialScene);

  room.doc.transact(() => {
    const text = room.doc.getText('codemirror');
    text.delete(0, text.length);
    text.insert(0, `${initialScene}-updated`);
  }, 'test');

  await room.persist();

  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, 'diagram.excalidraw');
  assert.equal(writes[0].content, `${initialScene}-updated`);
  assert.equal(backlinkUpdates, 0);
});
