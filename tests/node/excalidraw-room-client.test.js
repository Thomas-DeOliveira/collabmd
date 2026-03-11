import test from 'node:test';
import assert from 'node:assert/strict';

import { ExcalidrawRoomClient } from '../../src/client/infrastructure/excalidraw-room-client.js';

function createFakeYText(initialValue = '') {
  const observers = new Set();
  return {
    value: initialValue,
    get length() {
      return this.value.length;
    },
    delete(start, count) {
      this.value = this.value.slice(0, start) + this.value.slice(start + count);
      observers.forEach((observer) => observer());
    },
    insert(start, text) {
      this.value = this.value.slice(0, start) + text + this.value.slice(start);
      observers.forEach((observer) => observer());
    },
    observe(callback) {
      observers.add(callback);
    },
    toString() {
      return this.value;
    },
    unobserve(callback) {
      observers.delete(callback);
    },
  };
}

function createFakeAwareness() {
  const states = new Map();
  return {
    clientID: 1,
    getStates() {
      return states;
    },
    off() {},
    on() {},
    setLocalState(value) {
      this.localState = value;
    },
    setLocalStateField(key, value) {
      this.localState = {
        ...(this.localState || {}),
        [key]: value,
      };
      states.set(1, this.localState);
    },
  };
}

function createFakeProvider(ytext) {
  const listeners = new Map();
  return {
    awareness: createFakeAwareness(),
    destroy() {
      this.destroyed = true;
    },
    disconnect() {
      this.disconnected = true;
    },
    off(type, handler) {
      listeners.delete(`${type}:${handler}`);
    },
    on(type, handler) {
      listeners.set(`${type}:${handler}`, handler);
    },
    synced: true,
    ytext,
  };
}

test('ExcalidrawRoomClient uses an empty scene when no file path is configured', async () => {
  const client = new ExcalidrawRoomClient({ vaultClient: {} });

  const scene = await client.connect({
    initialUser: { color: '#111111', colorLight: '#11111133', name: 'Andes', peerId: 'peer-1' },
  });

  assert.equal(scene.type, 'excalidraw');
  assert.match(client.getLastSceneJson(), /"type":"excalidraw"/);
});

test('ExcalidrawRoomClient syncs scene updates through the shared Yjs text', async () => {
  const ytext = createFakeYText('');
  const provider = createFakeProvider(ytext);
  const ydoc = {
    destroy() {
      this.destroyed = true;
    },
    getText() {
      return ytext;
    },
    transact(callback) {
      callback();
    },
  };

  const remoteScenes = [];
  const client = new ExcalidrawRoomClient({
    filePath: 'diagram.excalidraw',
    resolveWsBaseUrlFn: () => 'ws://localhost:3000',
    setTimeoutFn: (callback) => {
      callback();
      return 1;
    },
    vaultClient: {
      async readFile() {
        return { content: JSON.stringify({ type: 'excalidraw', version: 2, source: 'collabmd', elements: [], appState: {}, files: {} }) };
      },
    },
    websocketProviderFactory: () => provider,
    ydocFactory: () => ydoc,
    onRemoteSceneJson: (sceneJson) => remoteScenes.push(sceneJson),
  });

  await client.connect({
    initialUser: { color: '#111111', colorLight: '#11111133', name: 'Andes', peerId: 'peer-1' },
  });

  client.scheduleSceneSync(
    [{ id: 'shape-1', isDeleted: false }],
    { gridSize: 12, viewBackgroundColor: '#abcdef' },
    {},
  );

  assert.match(ytext.toString(), /shape-1/);
  assert.match(client.getLastSceneJson(), /shape-1/);
  assert.deepEqual(remoteScenes, []);
});

test('ExcalidrawRoomClient updates awareness fields for local user, pointer, and selection state', async () => {
  const ytext = createFakeYText('');
  const provider = createFakeProvider(ytext);
  const ydoc = {
    destroy() {},
    getText() {
      return ytext;
    },
    transact(callback) {
      callback();
    },
  };

  const rafCallbacks = [];
  const client = new ExcalidrawRoomClient({
    filePath: 'diagram.excalidraw',
    requestAnimationFrameFn: (callback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    },
    resolveWsBaseUrlFn: () => 'ws://localhost:3000',
    setTimeoutFn: (callback) => {
      callback();
      return 1;
    },
    vaultClient: {
      async readFile() {
        return { content: JSON.stringify({ type: 'excalidraw', version: 2, source: 'collabmd', elements: [], appState: {}, files: {} }) };
      },
    },
    websocketProviderFactory: () => provider,
    ydocFactory: () => ydoc,
  });

  await client.connect({
    initialUser: { color: '#111111', colorLight: '#11111133', name: 'Andes', peerId: 'peer-1' },
  });

  client.setLocalUser({ name: 'Updated Name' });
  client.syncLocalSelectionAwareness({ selectedElementIds: { shapeA: true } });
  client.scheduleLocalPointerAwareness({ button: 'down', pointer: { tool: 'laser', x: 10, y: 20 } });
  rafCallbacks[0]();

  assert.equal(provider.awareness.localState.user.name, 'Updated Name');
  assert.deepEqual(provider.awareness.localState.selectedElementIds, { shapeA: true });
  assert.deepEqual(provider.awareness.localState.pointer, { tool: 'laser', x: 10, y: 20 });
  assert.equal(provider.awareness.localState.pointerButton, 'down');
});
