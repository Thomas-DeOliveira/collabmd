import test from 'node:test';
import assert from 'node:assert/strict';

import { VaultApiClient } from '../../src/client/infrastructure/vault-api-client.js';

function createWindowStub() {
  return {
    __COLLABMD_CONFIG__: { basePath: '/app' },
    location: {
      origin: 'http://localhost:3000',
    },
  };
}

test('VaultApiClient prefixes vault endpoints with the configured base path', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const requests = [];

  globalThis.window = createWindowStub();
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ options, url });
    return new Response(JSON.stringify({ ok: true, tree: [] }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  });

  const client = new VaultApiClient();

  await client.readTree();
  await client.readFile('notes/today.md');
  await client.createFile({ content: '# Today\n', path: 'notes/today.md' });
  await client.renameFile({ newPath: 'notes/tomorrow.md', oldPath: 'notes/today.md' });
  await client.deleteFile('notes/tomorrow.md');
  await client.createDirectory('notes/archive');

  assert.deepEqual(
    requests.map(({ options, url }) => ({
      body: options.body ? JSON.parse(options.body) : null,
      method: options.method ?? 'GET',
      url,
    })),
    [
      { body: null, method: 'GET', url: '/app/api/files' },
      { body: null, method: 'GET', url: '/app/api/file?path=notes%2Ftoday.md' },
      { body: { content: '# Today\n', path: 'notes/today.md' }, method: 'POST', url: '/app/api/file' },
      {
        body: { newPath: 'notes/tomorrow.md', oldPath: 'notes/today.md' },
        method: 'PATCH',
        url: '/app/api/file',
      },
      { body: null, method: 'DELETE', url: '/app/api/file?path=notes%2Ftomorrow.md' },
      { body: { path: 'notes/archive' }, method: 'POST', url: '/app/api/directory' },
    ],
  );
});

test('VaultApiClient surfaces API-provided errors', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;

  globalThis.window = createWindowStub();
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'File already exists', ok: false }), {
    headers: { 'Content-Type': 'application/json' },
    status: 409,
  });

  t.after(() => {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  });

  const client = new VaultApiClient();

  await assert.rejects(
    client.createFile({ content: '', path: 'notes/today.md' }),
    (error) => {
      assert.equal(error.message, 'File already exists');
      assert.equal(error.status, 409);
      assert.deepEqual(error.body, { error: 'File already exists', ok: false });
      return true;
    },
  );
});
