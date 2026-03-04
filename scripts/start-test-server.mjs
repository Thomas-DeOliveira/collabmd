#!/usr/bin/env node

import { rm } from 'fs/promises';
import { resolve } from 'path';

import { loadConfig } from '../src/server/config/env.js';
import { createAppServer } from '../src/server/create-app-server.js';

const parsedPort = Number.parseInt(process.env.TEST_SERVER_PORT || '', 10);
const config = {
  ...loadConfig(),
  host: process.env.TEST_SERVER_HOST || '127.0.0.1',
  nodeEnv: 'test',
  persistenceDir: resolve(process.cwd(), process.env.TEST_SERVER_PERSISTENCE_DIR || '.tmp/test-server-data'),
  port: Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 4173,
  roomNamespace: process.env.TEST_SERVER_ROOM_NAMESPACE || 'collabmd-test',
};

await rm(config.persistenceDir, { force: true, recursive: true });

const server = createAppServer(config);
let shutdownPromise = null;

function shutdown(signal) {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = server.close()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error(`[test-server] Shutdown error after ${signal}:`, error.message);
      process.exit(1);
    });

  return shutdownPromise;
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

server.listen().then(({ host, port, wsPath }) => {
  console.log(`[test-server] http://${host}:${port}`);
  console.log(`[test-server] ws route: ${wsPath}`);
}).catch((error) => {
  console.error('[test-server] Failed to start:', error.message);
  process.exit(1);
});
