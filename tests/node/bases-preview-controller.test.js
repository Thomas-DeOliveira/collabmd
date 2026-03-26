import test from 'node:test';
import assert from 'node:assert/strict';

import { BasesPreviewController } from '../../src/client/presentation/bases-preview-controller.js';

function createPlaceholder() {
  return {
    innerHTML: '',
    isConnected: true,
  };
}

function createBaseResult({
  cell,
  label = 'Row',
  totalRows = 1,
  type = 'table',
} = {}) {
  return {
    columns: [{ id: 'note.value', label: 'Value' }],
    groups: [{
      key: 'All',
      label: 'All',
      rows: [{
        cells: {
          'note.value': cell ?? { text: label, type: 'string', value: label },
        },
        path: `notes/${label.toLowerCase()}.md`,
      }],
      summaries: [],
      value: { text: '', type: 'empty', value: null },
    }],
    rows: [],
    summaries: [],
    totalRows,
    view: {
      id: 'view-0',
      name: 'Table',
      supported: true,
      type,
    },
    views: [{
      id: 'view-0',
      name: 'Table',
      supported: true,
      type,
    }],
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function createWindowStub() {
  return {
    __COLLABMD_CONFIG__: { basePath: '' },
    location: {
      origin: 'http://localhost:5555',
    },
  };
}

test('BasesPreviewController ignores stale query responses when newer renders finish later', async () => {
  const first = createDeferred();
  const second = createDeferred();
  const controller = new BasesPreviewController({
    vaultApiClient: {
      queryBase() {
        return [first.promise, second.promise].shift();
      },
    },
  });
  const placeholder = createPlaceholder();
  const entry = {
    key: 'base-entry',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: null,
      sourcePath: '',
      view: '',
    },
    placeholder,
    requestVersion: 0,
    result: null,
    search: '',
  };

  const queuedResponses = [first.promise, second.promise];
  controller.vaultApiClient.queryBase = () => queuedResponses.shift();

  const firstRender = controller.renderEntry(entry);
  entry.payload.search = 'newer';
  const secondRender = controller.renderEntry(entry);

  second.resolve({ result: createBaseResult({ label: 'Newest', totalRows: 2 }) });
  await secondRender;
  assert.match(placeholder.innerHTML, /2 results/);
  assert.match(placeholder.innerHTML, /Newest/);

  first.resolve({ result: createBaseResult({ label: 'Older', totalRows: 1 }) });
  await firstRender;

  assert.match(placeholder.innerHTML, /2 results/);
  assert.match(placeholder.innerHTML, /Newest/);
  assert.doesNotMatch(placeholder.innerHTML, /Older/);
});

test('BasesPreviewController renders typed image cells through the attachment endpoint', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = createWindowStub();
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: createBaseResult({
            cell: {
              path: 'notes/images/cover.png',
              text: 'images/cover.png',
              type: 'image',
              value: 'notes/images/cover.png',
            },
          }),
        };
      },
    },
  });
  try {
  const placeholder = createPlaceholder();
  const entry = {
    key: 'image-entry',
    payload: {
      path: 'views/gallery.base',
      search: '',
      source: null,
      sourcePath: 'views/gallery.base',
      view: '',
    },
    placeholder,
    requestVersion: 0,
    result: null,
    search: '',
  };

  await controller.renderEntry(entry);

  assert.match(placeholder.innerHTML, /bases-inline-image/);
  assert.match(placeholder.innerHTML, /\/api\/attachment\?path=notes%2Fimages%2Fcover\.png/);
  } finally {
    globalThis.window = originalWindow;
  }
});
