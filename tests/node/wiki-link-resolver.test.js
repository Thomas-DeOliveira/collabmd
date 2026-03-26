import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createWikiTargetIndex,
  resolveWikiTargetPath,
  resolveWikiTargetWithIndex,
} from '../../src/domain/wiki-link-resolver.js';

test('resolveWikiTargetPath matches exact paths and bare note names', () => {
  const files = [
    'README.md',
    'notes/daily.md',
    'projects/collabmd.md',
  ];

  assert.equal(resolveWikiTargetPath('README', files), 'README.md');
  assert.equal(resolveWikiTargetPath('notes/daily', files), 'notes/daily.md');
  assert.equal(resolveWikiTargetPath('collabmd', files), 'projects/collabmd.md');
});

test('resolveWikiTargetPath prefers root-level exact matches over nested suffix matches', () => {
  const files = [
    'test-vault/showcase.md',
    'showcase.md',
  ];

  assert.equal(resolveWikiTargetPath('showcase', files), 'showcase.md');
  assert.equal(resolveWikiTargetPath('showcase.md', files), 'showcase.md');
});

test('resolveWikiTargetPath resolves exact non-markdown vault targets without coercing them to markdown', () => {
  const files = [
    'boards/tasks.base',
    'diagrams/architecture.drawio',
    'diagrams/flow.mmd',
    'images/cover.png',
    'scenes/sketch.excalidraw',
    'uml/system.plantuml',
  ];

  assert.equal(resolveWikiTargetPath('boards/tasks.base', files), 'boards/tasks.base');
  assert.equal(resolveWikiTargetPath('architecture.drawio', files), 'diagrams/architecture.drawio');
  assert.equal(resolveWikiTargetPath('flow.mmd', files), 'diagrams/flow.mmd');
  assert.equal(resolveWikiTargetPath('cover.png', files), 'images/cover.png');
  assert.equal(resolveWikiTargetPath('sketch.excalidraw', files), 'scenes/sketch.excalidraw');
  assert.equal(resolveWikiTargetPath('system.plantuml', files), 'uml/system.plantuml');
});

test('resolveWikiTargetPath returns null for empty or missing targets', () => {
  const files = ['README.md'];

  assert.equal(resolveWikiTargetPath('', files), null);
  assert.equal(resolveWikiTargetPath('missing', files), null);
});

test('resolveWikiTargetWithIndex resolves without scanning file arrays', () => {
  const files = [
    'README.md',
    'notes/daily.md',
    'projects/collabmd.md',
  ];
  const index = createWikiTargetIndex(files);

  assert.equal(resolveWikiTargetWithIndex('README', index), 'README.md');
  assert.equal(resolveWikiTargetWithIndex('notes/daily', index), 'notes/daily.md');
  assert.equal(resolveWikiTargetWithIndex('collabmd', index), 'projects/collabmd.md');
});

test('resolveWikiTargetWithIndex prefers root-level exact matches over nested suffix matches', () => {
  const files = [
    'test-vault/showcase.md',
    'showcase.md',
  ];
  const index = createWikiTargetIndex(files);

  assert.equal(resolveWikiTargetWithIndex('showcase', index), 'showcase.md');
  assert.equal(resolveWikiTargetWithIndex('showcase.md', index), 'showcase.md');
});

test('resolveWikiTargetWithIndex resolves exact non-markdown vault targets without markdown fallback', () => {
  const files = [
    'boards/tasks.base',
    'diagrams/architecture.drawio',
    'diagrams/flow.mmd',
    'images/cover.png',
    'scenes/sketch.excalidraw',
    'uml/system.plantuml',
  ];
  const index = createWikiTargetIndex(files);

  assert.equal(resolveWikiTargetWithIndex('boards/tasks.base', index), 'boards/tasks.base');
  assert.equal(resolveWikiTargetWithIndex('architecture.drawio', index), 'diagrams/architecture.drawio');
  assert.equal(resolveWikiTargetWithIndex('flow.mmd', index), 'diagrams/flow.mmd');
  assert.equal(resolveWikiTargetWithIndex('cover.png', index), 'images/cover.png');
  assert.equal(resolveWikiTargetWithIndex('sketch.excalidraw', index), 'scenes/sketch.excalidraw');
  assert.equal(resolveWikiTargetWithIndex('system.plantuml', index), 'uml/system.plantuml');
});
