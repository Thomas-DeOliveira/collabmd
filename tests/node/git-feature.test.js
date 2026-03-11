import test from 'node:test';
import assert from 'node:assert/strict';

import { gitFeature } from '../../src/client/application/app-shell/git-feature.js';

function createContext(overrides = {}) {
  const events = [];
  const gitOperationStatus = {
    _text: '',
    _hidden: true,
    classList: {
      toggle(name, force) {
        if (name === 'hidden') {
          gitOperationStatus._hidden = Boolean(force);
        }
      },
    },
    set textContent(value) {
      gitOperationStatus._text = value;
    },
    get textContent() {
      return gitOperationStatus._text;
    },
  };
  const context = {
    ...gitFeature,
    currentFilePath: 'README.md',
    elements: {
      gitOperationStatus,
    },
    fileExplorer: {
      async refresh() {
        events.push(['refresh-explorer']);
      },
    },
    getDisplayName(filePath) {
      return filePath.replace(/\.md$/u, '');
    },
    gitPanel: {
      async refresh() {
        events.push(['refresh-git-panel']);
      },
    },
    isTabActive: true,
    lobby: {
      sendWorkspaceEvent(payload) {
        events.push(['workspace-event', payload]);
      },
    },
    navigation: {
      getHashRoute() {
        return { scope: 'all', type: 'empty' };
      },
      navigateToFile(filePath) {
        events.push(['navigate-file', filePath]);
      },
      navigateToGitDiff(payload) {
        events.push(['navigate-diff', payload]);
      },
    },
    showGitDiff: async () => {
      events.push(['show-git-diff']);
    },
    toastController: {
      show(message) {
        events.push(['toast', message]);
      },
    },
    ...overrides,
  };

  return { context, events, gitOperationStatus };
}

test('gitFeature finalizes git actions by refreshing locally and publishing a workspace event', async () => {
  const { context, events } = createContext();

  await gitFeature.finalizeGitAction.call(context, {
    action: 'stage',
    preferredScope: 'staged',
    result: {
      workspaceChange: {
        changedPaths: [],
        deletedPaths: [],
        refreshExplorer: true,
        renamedPaths: [],
      },
    },
  });

  assert.deepEqual(events, [
    ['refresh-explorer'],
    ['refresh-git-panel'],
    ['workspace-event', {
      action: 'stage',
      sourceRef: null,
      workspaceChange: {
        changedPaths: [],
        deletedPaths: [],
        refreshExplorer: true,
        renamedPaths: [],
      },
    }],
  ]);
});

test('gitFeature closes the current file when an incoming workspace event deletes it', async () => {
  const { context, events } = createContext();

  await gitFeature.handleIncomingWorkspaceEvent.call(context, {
    action: 'pull',
    workspaceChange: {
      changedPaths: [],
      deletedPaths: ['README.md'],
      refreshExplorer: true,
      renamedPaths: [],
    },
  });

  assert.deepEqual(events, [
    ['refresh-explorer'],
    ['refresh-git-panel'],
    ['navigate-file', null],
    ['toast', 'README was removed after a pull operation'],
  ]);
});

test('gitFeature shows and clears the shared git operation status around a long-running action', async () => {
  const states = [];
  const { context, gitOperationStatus } = createContext();

  await gitFeature.runGitActionWithStatus.call(context, 'Resetting file...', async () => {
    states.push([gitOperationStatus.textContent, gitOperationStatus._hidden]);
  });

  states.push([gitOperationStatus.textContent, gitOperationStatus._hidden]);

  assert.deepEqual(states, [
    ['Resetting file...', false],
    ['', true],
  ]);
});
