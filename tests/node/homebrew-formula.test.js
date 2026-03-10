import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('homebrew formula generator includes asset build steps and static asset verification', async () => {
  const tempDir = await mkdtemp(resolve(tmpdir(), 'collabmd-formula-'));
  const outputPath = resolve(tempDir, 'collabmd.rb');

  try {
    await execFile(process.execPath, [
      resolve(rootDir, 'scripts/render-homebrew-formula.mjs'),
      '--sha256', 'a'.repeat(64),
      '--output', outputPath,
    ], {
      cwd: rootDir,
    });

    const formula = await readFile(outputPath, 'utf8');

    assert.match(formula, /system "npm", "install", \*std_npm_args\(prefix: false\), "--include=dev"/);
    assert.match(formula, /system "npm", "run", "build"/);
    assert.match(formula, /system "npm", "install", \*std_npm_args/);
    assert.match(formula, /curl -i -fsS http:\/\/127\.0\.0\.1:#\{port\}\/assets\/css\/style\.css/);
    assert.match(formula, /assert_match "Content-Type: text\/css; charset=utf-8", asset_response/);
  } finally {
    await rm(tempDir, { force: true, recursive: true });
  }
});
