import { Doc } from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import {
  buildCollaboratorsMap,
  mergeAwarenessUserPatch,
} from '../domain/excalidraw-collaboration.js';
import {
  buildStoredScene,
  createEmptyScene,
  parseSceneJson,
} from '../domain/excalidraw-scene.js';
import { resolveWsBaseUrl } from '../domain/runtime-paths.js';

const DEFAULT_ROOM_TEXT_KEY = 'codemirror';
const DEFAULT_SAVE_THROTTLE_MS = 48;
const DEFAULT_SYNC_TIMEOUT_MS = 4000;

export class ExcalidrawRoomClient {
  constructor({
    cancelAnimationFrameFn = (frameId) => cancelAnimationFrame(frameId),
    clearTimeoutFn = (timeoutId) => clearTimeout(timeoutId),
    filePath = '',
    now = () => Date.now(),
    onCollaboratorsChange = () => {},
    onRemoteSceneJson = () => {},
    requestAnimationFrameFn = (callback) => requestAnimationFrame(callback),
    resolveWsBaseUrlFn = resolveWsBaseUrl,
    roomTextKey = DEFAULT_ROOM_TEXT_KEY,
    saveThrottleMs = DEFAULT_SAVE_THROTTLE_MS,
    setTimeoutFn = (callback, delay) => window.setTimeout(callback, delay),
    syncTimeoutMs = DEFAULT_SYNC_TIMEOUT_MS,
    vaultClient,
    websocketProviderFactory = (wsUrl, path, ydoc, options) => new WebsocketProvider(wsUrl, path, ydoc, options),
    ydocFactory = () => new Doc(),
  }) {
    this.cancelAnimationFrameFn = cancelAnimationFrameFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.filePath = filePath;
    this.now = now;
    this.onCollaboratorsChange = onCollaboratorsChange;
    this.onRemoteSceneJson = onRemoteSceneJson;
    this.requestAnimationFrameFn = requestAnimationFrameFn;
    this.resolveWsBaseUrlFn = resolveWsBaseUrlFn;
    this.roomTextKey = roomTextKey;
    this.saveThrottleMs = saveThrottleMs;
    this.setTimeoutFn = setTimeoutFn;
    this.syncTimeoutMs = syncTimeoutMs;
    this.vaultClient = vaultClient;
    this.websocketProviderFactory = websocketProviderFactory;
    this.ydocFactory = ydocFactory;
    this.ydoc = null;
    this.ytext = null;
    this.provider = null;
    this.awareness = null;
    this.localUser = null;
    this.handleProviderSync = null;
    this.lastSceneJson = '';
    this.sceneSyncTimer = null;
    this.lastSceneSyncAt = 0;
    this.pendingSceneSyncPayload = null;
    this.pointerAwarenessFrame = 0;
    this.pendingPointerPayload = null;
    this.lastSelectedIdsSignature = '';
    this.canWriteToRoom = false;
    this.waitingForAuthoritativeSync = false;

    this.handleAwarenessChange = () => {
      this.onCollaboratorsChange(buildCollaboratorsMap(this.awareness));
    };

    this.handleRoomTextUpdate = () => {
      if (!this.ytext) {
        return;
      }

      const remoteJson = this.ytext.toString();
      if (!remoteJson || remoteJson === this.lastSceneJson) {
        return;
      }

      this.unlockRoomWrites();
      this.lastSceneJson = JSON.stringify(parseSceneJson(remoteJson));
      this.onRemoteSceneJson(this.lastSceneJson);
    };
  }

  getLastSceneJson() {
    return this.lastSceneJson;
  }

  getLocalUser() {
    return this.localUser;
  }

  setLocalUser(nextUser = {}) {
    this.localUser = mergeAwarenessUserPatch({
      currentUser: this.localUser,
      nextUser,
    });

    if (this.awareness) {
      this.awareness.setLocalStateField('user', this.localUser);
    }

    this.handleAwarenessChange();
    return this.localUser;
  }

  async connect({ initialUser = null } = {}) {
    this.localUser = initialUser;

    if (!this.filePath) {
      const scene = createEmptyScene();
      this.lastSceneJson = JSON.stringify(scene);
      return scene;
    }

    this.ydoc = this.ydocFactory();
    this.ytext = this.ydoc.getText(this.roomTextKey);
    this.provider = this.websocketProviderFactory(this.resolveWsBaseUrlFn(), this.filePath, this.ydoc, {
      disableBc: true,
      maxBackoffTime: 5000,
    });

    this.awareness = this.provider.awareness;
    if (this.localUser) {
      this.awareness.setLocalStateField('user', this.localUser);
    }
    this.awareness.setLocalStateField('pointerButton', 'up');
    this.awareness.setLocalStateField('selectedElementIds', {});
    this.awareness.on('change', this.handleAwarenessChange);

    this.handleProviderSync = (isSynced) => {
      if (!isSynced) {
        return;
      }

      this.unlockRoomWrites();
      this.handleRoomTextUpdate();
    };
    this.provider.on('sync', this.handleProviderSync);

    const didInitialSyncFinish = await this.waitForSync(this.provider, this.syncTimeoutMs);

    let initialJson = this.ytext.toString();
    let usedApiFallback = false;
    if (!initialJson) {
      const sceneFromApi = await this.loadSceneFromApi();
      const syncedJson = this.ytext.toString();
      if (syncedJson) {
        initialJson = syncedJson;
      } else {
        initialJson = JSON.stringify(sceneFromApi);
        usedApiFallback = true;
      }
    }

    if (!initialJson) {
      initialJson = JSON.stringify(createEmptyScene());
    }

    this.waitingForAuthoritativeSync = usedApiFallback && !didInitialSyncFinish;
    this.canWriteToRoom = !this.waitingForAuthoritativeSync;
    this.lastSceneJson = JSON.stringify(parseSceneJson(initialJson));
    this.ytext.observe(this.handleRoomTextUpdate);
    this.handleRoomTextUpdate();
    this.handleAwarenessChange();

    return parseSceneJson(this.lastSceneJson);
  }

  async loadSceneFromApi({ createIfMissing = true } = {}) {
    if (!this.filePath) {
      return createEmptyScene();
    }

    try {
      const data = await this.vaultClient.readFile(this.filePath);
      return parseSceneJson(data.content);
    } catch (readError) {
      if (readError?.status !== 404 || !createIfMissing) {
        if (readError?.status === 404) {
          throw new Error(readError.message || 'Excalidraw file not found');
        }

        throw new Error(readError?.message || 'Failed to load Excalidraw file');
      }
    }

    const emptyScene = createEmptyScene();
    try {
      await this.vaultClient.createFile({
        content: JSON.stringify(emptyScene),
        path: this.filePath,
      });
      return emptyScene;
    } catch (createError) {
      if (createError?.status === 409) {
        return emptyScene;
      }

      throw new Error(createError?.message || 'Failed to create Excalidraw file');
    }
  }

  waitForSync(providerInstance, timeoutMs = DEFAULT_SYNC_TIMEOUT_MS) {
    if (providerInstance.synced) {
      return Promise.resolve(true);
    }

    return new Promise((resolve) => {
      let settled = false;

      const handleSync = (isSynced) => {
        if (!isSynced || settled) {
          return;
        }

        settled = true;
        this.clearTimeoutFn(timer);
        providerInstance.off('sync', handleSync);
        resolve(true);
      };

      const timer = this.setTimeoutFn(() => {
        if (settled) {
          return;
        }

        settled = true;
        providerInstance.off('sync', handleSync);
        resolve(false);
      }, timeoutMs);

      providerInstance.on('sync', handleSync);
    });
  }

  unlockRoomWrites() {
    this.waitingForAuthoritativeSync = false;
    this.canWriteToRoom = true;

    if (this.pendingSceneSyncPayload) {
      this.scheduleSceneSyncFlush();
    }
  }

  replaceRoomContent(nextJson, origin = 'excalidraw-room-write') {
    if (!this.ydoc || !this.ytext) {
      return;
    }

    this.ydoc.transact(() => {
      if (this.ytext.length > 0) {
        this.ytext.delete(0, this.ytext.length);
      }
      if (nextJson) {
        this.ytext.insert(0, nextJson);
      }
    }, origin);
  }

  scheduleSceneSync(elements, appState, files) {
    this.pendingSceneSyncPayload = { appState, elements, files };
    if (!this.canWriteToRoom) {
      return;
    }

    this.scheduleSceneSyncFlush();
  }

  scheduleSceneSyncFlush() {
    if (this.sceneSyncTimer !== null) {
      return;
    }

    const elapsed = this.now() - this.lastSceneSyncAt;
    const delay = Math.max(0, this.saveThrottleMs - elapsed);
    this.sceneSyncTimer = this.setTimeoutFn(() => {
      this.sceneSyncTimer = null;
      this.flushSceneSync();
    }, delay);
  }

  flushSceneSync() {
    if (!this.ytext || !this.pendingSceneSyncPayload) {
      return;
    }

    const { elements, appState, files } = this.pendingSceneSyncPayload;
    this.pendingSceneSyncPayload = null;

    const sceneData = buildStoredScene(elements, appState, files);
    const json = JSON.stringify(sceneData);

    if (json !== this.lastSceneJson) {
      this.lastSceneJson = json;
      this.lastSceneSyncAt = this.now();
      this.replaceRoomContent(json, 'excalidraw-local-change');
    }

    if (this.pendingSceneSyncPayload) {
      this.scheduleSceneSyncFlush();
    }
  }

  flushPointerAwarenessPayload() {
    this.pointerAwarenessFrame = 0;

    if (!this.awareness || !this.pendingPointerPayload) {
      return;
    }

    this.awareness.setLocalStateField('pointer', this.pendingPointerPayload.pointer);
    this.awareness.setLocalStateField('pointerButton', this.pendingPointerPayload.button);
    this.pendingPointerPayload = null;
  }

  scheduleLocalPointerAwareness(payload) {
    if (!this.awareness || !payload?.pointer) {
      return;
    }

    this.pendingPointerPayload = {
      button: payload.button === 'down' ? 'down' : 'up',
      pointer: {
        x: payload.pointer.x,
        y: payload.pointer.y,
        tool: payload.pointer.tool === 'laser' ? 'laser' : 'pointer',
      },
    };

    if (this.pointerAwarenessFrame) {
      return;
    }

    this.pointerAwarenessFrame = this.requestAnimationFrameFn(() => this.flushPointerAwarenessPayload());
  }

  syncLocalSelectionAwareness(appState) {
    if (!this.awareness) {
      return;
    }

    const selected = appState?.selectedElementIds || {};
    const signature = Object.keys(selected).sort().join(',');
    if (signature === this.lastSelectedIdsSignature) {
      return;
    }

    this.lastSelectedIdsSignature = signature;
    this.awareness.setLocalStateField('selectedElementIds', selected);
  }

  disconnect() {
    this.flushSceneSync();
    this.clearTimeoutFn(this.sceneSyncTimer);
    this.sceneSyncTimer = null;
    this.pendingSceneSyncPayload = null;

    if (this.pointerAwarenessFrame) {
      this.cancelAnimationFrameFn(this.pointerAwarenessFrame);
    }
    this.pointerAwarenessFrame = 0;
    this.pendingPointerPayload = null;
    this.lastSelectedIdsSignature = '';

    if (this.ytext) {
      this.ytext.unobserve(this.handleRoomTextUpdate);
    }

    if (this.awareness) {
      this.awareness.off('change', this.handleAwarenessChange);
      this.awareness.setLocalState(null);
    }
    this.awareness = null;

    if (this.provider && this.handleProviderSync) {
      this.provider.off('sync', this.handleProviderSync);
    }
    this.handleProviderSync = null;
    this.provider?.disconnect();
    this.provider?.destroy();
    this.provider = null;

    this.ydoc?.destroy();
    this.ydoc = null;
    this.ytext = null;
    this.localUser = null;
    this.canWriteToRoom = false;
    this.waitingForAuthoritativeSync = false;
  }
}
