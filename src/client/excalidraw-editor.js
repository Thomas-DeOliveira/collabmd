import React from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

import {
  mergeAwarenessUserPatch,
  resolveLocalAwarenessUser,
} from './domain/excalidraw-collaboration.js';
import {
  normalizeScene,
  parseSceneJson,
  sceneToInitialData,
} from './domain/excalidraw-scene.js';
import { ensureClientAuthenticated } from './infrastructure/auth-client.js';
import { ExcalidrawRoomClient } from './infrastructure/excalidraw-room-client.js';
import { vaultApiClient } from './infrastructure/vault-api-client.js';

const params = new URLSearchParams(window.location.search);
const filePath = params.get('file');
const isTestMode = params.get('test') === '1';
const parentOrigin = window.location.origin;
const syncTimeoutMs = Number.parseInt(params.get('syncTimeoutMs') || '', 10);

let excalidrawAPI = null;
let currentTheme = params.get('theme') || 'dark';
let localAwarenessUser = resolveLocalAwarenessUser({
  params,
  storedUserName: localStorage.getItem('collabmd-user-name'),
});
let appliedSceneJson = '';

let collabReady = false;
let suppressOnChange = false;
let pendingRemoteSceneJson = '';
let pendingCollaborators = null;
let suppressOnChangeReleaseToken = 0;
const roomClient = new ExcalidrawRoomClient({
  filePath,
  onCollaboratorsChange: (collaborators) => {
    if (!collabReady) {
      pendingCollaborators = collaborators;
      return;
    }

    applyCollaborators(collaborators);
  },
  onRemoteSceneJson: (sceneJson) => {
    applySceneFromJson(sceneJson);
  },
  syncTimeoutMs: Number.isFinite(syncTimeoutMs) ? syncTimeoutMs : undefined,
  vaultClient: vaultApiClient,
});

function applyLocalUserPatch(nextUser = {}) {
  localAwarenessUser = mergeAwarenessUserPatch({
    currentUser: localAwarenessUser,
    nextUser,
  });
  roomClient.setLocalUser(localAwarenessUser);
}

if (isTestMode) {
  window.__COLLABMD_EXCALIDRAW_TEST__ = {
    getLocalUserName: () => localAwarenessUser?.name || '',
    getSceneJson: () => roomClient.getLastSceneJson(),
    isReady: () => collabReady && Boolean(excalidrawAPI),
    setScene: (scene) => {
      const json = JSON.stringify(normalizeScene(scene));
      applySceneFromJson(json);
      roomClient.replaceRoomContent(json, 'excalidraw-test');
    },
  };
}

function applyCollaborators(collaborators) {
  if (!excalidrawAPI) {
    pendingCollaborators = collaborators;
    return;
  }

  excalidrawAPI.updateScene({ collaborators });
}

function applySceneFromJson(rawJson) {
  const scene = parseSceneJson(rawJson);
  const normalizedJson = JSON.stringify(scene);
  if (normalizedJson === appliedSceneJson && !pendingRemoteSceneJson) {
    return;
  }

  appliedSceneJson = normalizedJson;

  if (!excalidrawAPI) {
    pendingRemoteSceneJson = normalizedJson;
    return;
  }

  updateApiScene(scene);
}

function releaseOnChangeSuppressionAfterPaint() {
  const releaseToken = ++suppressOnChangeReleaseToken;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (releaseToken !== suppressOnChangeReleaseToken) {
        return;
      }

      suppressOnChange = false;
    });
  });
}

function updateApiScene(scene) {
  suppressOnChange = true;
  try {
    excalidrawAPI.updateScene({
      elements: scene.elements,
      appState: {
        theme: currentTheme,
        viewBackgroundColor: scene.appState.viewBackgroundColor ?? '#ffffff',
        gridSize: scene.appState.gridSize ?? null,
      },
      files: scene.files || {},
    });
  } finally {
    releaseOnChangeSuppressionAfterPaint();
  }
}

function onRoomTextUpdate() {
  applySceneFromJson(roomClient.getLastSceneJson());
}

function postToParent(type, payload = {}) {
  window.parent.postMessage({ source: 'excalidraw-editor', type, ...payload }, parentOrigin);
}

function disconnectRealtimeRoom() {
  collabReady = false;
  pendingCollaborators = null;
  roomClient.disconnect();
}

window.addEventListener('pagehide', () => {
  disconnectRealtimeRoom();
});

window.addEventListener('message', (event) => {
  if (event.origin !== parentOrigin) {
    return;
  }

  const message = event.data;
  if (!message || message.source !== 'collabmd-host') {
    return;
  }

  if (message.type === 'set-theme') {
    currentTheme = message.theme || 'dark';
    if (excalidrawAPI) {
      suppressOnChange = true;
      excalidrawAPI.updateScene({ appState: { theme: currentTheme } });
      releaseOnChangeSuppressionAfterPaint();
    }
    return;
  }

  if (message.type === 'set-user') {
    applyLocalUserPatch(message.user);
  }
});

function scheduleSyncToRoom(elements, appState, files) {
  if (!collabReady || suppressOnChange) {
    return;
  }

  roomClient.scheduleSceneSync(elements, appState, files);
}

async function init() {
  const loadingElement = document.getElementById('loadingState');

  try {
    await ensureClientAuthenticated();
    const initialScene = await roomClient.connect({ initialUser: localAwarenessUser });
    const initialData = sceneToInitialData(initialScene, { theme: currentTheme });

    loadingElement?.remove();

    const excalidrawProps = {
      excalidrawAPI: (api) => {
        excalidrawAPI = api;

        const sceneJson = pendingRemoteSceneJson || roomClient.getLastSceneJson();
        pendingRemoteSceneJson = '';
        updateApiScene(parseSceneJson(sceneJson));

        if (pendingCollaborators) {
          excalidrawAPI.updateScene({ collaborators: pendingCollaborators });
          pendingCollaborators = null;
        }
        collabReady = true;
        onRoomTextUpdate();

        postToParent('ready');
      },
      initialData,
      aiEnabled: false,
      isCollaborating: true,
      onChange: (elements, appState, files) => {
        scheduleSyncToRoom(elements, appState, files);
        roomClient.syncLocalSelectionAwareness(appState);
      },
      onPointerUpdate: (payload) => {
        roomClient.scheduleLocalPointerAwareness(payload);
      },
      theme: currentTheme,
      UIOptions: {
        canvasActions: {
          export: false,
          loadScene: false,
          saveToActiveFile: false,
          toggleTheme: false,
        },
      },
    };

    const App = () => React.createElement(
      'div',
      { style: { height: '100vh', width: '100%' } },
      React.createElement(Excalidraw, excalidrawProps),
    );

    const root = createRoot(document.getElementById('root'));
    root.render(React.createElement(App));
  } catch (error) {
    console.error('[excalidraw] Failed to initialize:', error);
    postToParent('error', {
      message: error instanceof Error ? error.message : 'Failed to load Excalidraw',
    });

    if (loadingElement) {
      loadingElement.className = 'loading-state error';
      loadingElement.textContent = `Failed to load Excalidraw: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

void init();
