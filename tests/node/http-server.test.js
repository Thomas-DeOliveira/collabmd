import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';

import { startTestServer } from './helpers/test-server.js';

function httpRequest(url, { method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      agent: false,
      method,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        resolve({
          body: Buffer.concat(chunks).toString('utf-8'),
          headers: res.headers,
          statusCode: res.statusCode,
        });
      });
    });

    req.on('error', reject);
    req.end();
  });
}

test('HTTP server serves health, runtime config, and static assets', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const healthResponse = await httpRequest(`${app.baseUrl}/health`);
  assert.equal(healthResponse.statusCode, 200);
  assert.equal(healthResponse.body, 'ok');

  const runtimeConfigResponse = await httpRequest(`${app.baseUrl}/app-config.js`);
  assert.equal(runtimeConfigResponse.statusCode, 200);
  assert.match(runtimeConfigResponse.body, /window\.__COLLABMD_CONFIG__/);

  const indexResponse = await httpRequest(`${app.baseUrl}/`);
  assert.equal(indexResponse.statusCode, 200);
  assert.match(indexResponse.body, /CollabMD/);

  const assetHeadResponse = await httpRequest(`${app.baseUrl}/assets/css/style.css`, { method: 'HEAD' });
  assert.equal(assetHeadResponse.statusCode, 200);
});

test('HTTP server rejects unsupported methods and missing files', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const postResponse = await httpRequest(`${app.baseUrl}/`, { method: 'POST' });
  assert.equal(postResponse.statusCode, 405);

  const missingResponse = await httpRequest(`${app.baseUrl}/missing-file.txt`);
  assert.equal(missingResponse.statusCode, 404);
});
