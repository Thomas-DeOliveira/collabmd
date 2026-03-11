import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkspacePreviewController } from '../../src/client/application/workspace-preview-controller.js';

function createController(overrides = {}) {
  return new WorkspacePreviewController({
    backlinksPanel: { clear() {}, ...(overrides.backlinksPanel || {}) },
    commentsPanel: { decoratePreviewAnchors() {}, ...(overrides.commentsPanel || {}) },
    elements: overrides.elements ?? {
      commentSelectionButton: { classList: { toggle() {} } },
      commentsToggle: { classList: { toggle() {} } },
      markdownToolbar: { classList: { toggle() {} } },
      outlineToggle: { classList: { toggle() {} } },
      previewContent: { classList: { add() {}, remove() {}, toggle() {} } },
    },
    excalidrawEmbed: { setHydrationPaused() {}, ...(overrides.excalidrawEmbed || {}) },
    getDisplayName: (filePath) => filePath,
    getSession: () => overrides.session ?? { getText: () => 'graph TD\nA-->B' },
    isExcalidrawFile: (filePath) => filePath?.endsWith('.excalidraw'),
    isMermaidFile: (filePath) => filePath?.endsWith('.mmd'),
    isPlantUmlFile: (filePath) => filePath?.endsWith('.puml'),
    layoutController: { setView() {}, ...(overrides.layoutController || {}) },
    outlineController: { close() {}, scheduleActiveHeadingUpdate() {}, ...(overrides.outlineController || {}) },
    previewRenderer: { setHydrationPaused() {}, ...(overrides.previewRenderer || {}) },
    schedulePreviewLayoutSync: () => {},
    scrollSyncController: { invalidatePreviewBlocks() {}, warmPreviewBlocks() {}, ...(overrides.scrollSyncController || {}) },
  });
}

test('WorkspacePreviewController wraps Mermaid and PlantUML file content for preview rendering', () => {
  const controller = createController({
    session: { getText: () => 'graph TD\nA-->B' },
  });

  assert.equal(
    controller.getPreviewSource('diagram.mmd'),
    '```mermaid\ngraph TD\nA-->B\n```',
  );
  assert.equal(
    controller.getPreviewSource('diagram.puml'),
    '```plantuml\ngraph TD\nA-->B\n```',
  );
  assert.equal(
    controller.getPreviewSource('README.md'),
    'graph TD\nA-->B',
  );
});

test('WorkspacePreviewController pauses preview hydration during editor scroll activity', () => {
  const events = [];
  const controller = createController({
    excalidrawEmbed: {
      setHydrationPaused(value) {
        events.push(['embed', value]);
      },
    },
    previewRenderer: {
      setHydrationPaused(value) {
        events.push(['preview', value]);
      },
    },
  });

  let hydrationPaused = false;
  let pendingPreviewLayoutSync = false;
  let previewLayoutSyncTimer = 123;

  controller.handleEditorScrollActivityChange({
    isActive: true,
    pendingPreviewLayoutSync,
    previewLayoutSyncTimer,
    setHydrationPaused: (value) => {
      hydrationPaused = value;
    },
    setPendingPreviewLayoutSync: (value) => {
      pendingPreviewLayoutSync = value;
    },
    setPreviewLayoutSyncTimer: (value) => {
      previewLayoutSyncTimer = value;
    },
  });

  assert.equal(hydrationPaused, true);
  assert.equal(pendingPreviewLayoutSync, true);
  assert.equal(previewLayoutSyncTimer, null);
  assert.deepEqual(events, [
    ['preview', true],
    ['embed', true],
  ]);
});
