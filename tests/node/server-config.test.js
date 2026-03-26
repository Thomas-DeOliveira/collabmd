import test from 'node:test';
import assert from 'node:assert/strict';

import { loadConfig } from '../../src/server/config/env.js';

test('loadConfig enables perf logging from COLLABMD_PERF_LOGGING', () => {
  const previousValue = process.env.COLLABMD_PERF_LOGGING;
  process.env.COLLABMD_PERF_LOGGING = '1';

  try {
    const config = loadConfig({ vaultDir: process.cwd() });
    assert.equal(config.perfLoggingEnabled, true);
  } finally {
    if (previousValue === undefined) {
      delete process.env.COLLABMD_PERF_LOGGING;
    } else {
      process.env.COLLABMD_PERF_LOGGING = previousValue;
    }
  }
});
