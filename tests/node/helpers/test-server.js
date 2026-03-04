import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { loadConfig } from '../../../src/server/config/env.js';
import { createAppServer } from '../../../src/server/create-app-server.js';

export async function startTestServer(overrides = {}) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'collabmd-test-'));
  const config = {
    ...loadConfig(),
    host: '127.0.0.1',
    nodeEnv: 'test',
    persistenceDir: join(tempRoot, 'rooms'),
    port: 0,
    roomNamespace: 'collabmd-test',
    ...overrides,
  };
  const server = createAppServer(config);
  const { port } = await server.listen();

  return {
    baseUrl: `http://${config.host}:${port}`,
    close: async () => {
      await server.close();
      await rm(tempRoot, { force: true, recursive: true });
    },
    port,
    server,
    tempRoot,
    wsUrl: (roomName) => `ws://${config.host}:${port}${config.wsBasePath}/${encodeURIComponent(roomName)}`,
  };
}

export async function waitForCondition(assertion, {
  intervalMs = 25,
  timeoutMs = 5000,
} = {}) {
  const startedAt = Date.now();

  while ((Date.now() - startedAt) < timeoutMs) {
    const result = await assertion();
    if (result) {
      return result;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}
