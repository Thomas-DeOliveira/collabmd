import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const clientDistDir = resolve(rootDir, 'dist/client');

function extractAssetPath(html, pattern, label) {
  const match = html.match(pattern);
  assert.ok(match, `expected ${label} asset reference`);
  return match[1];
}

test('client build emits hashed entry assets and the main bundle references the emitted preview worker', async () => {
  const indexHtml = await readFile(resolve(clientDistDir, 'index.html'), 'utf8');
  const mainAssetPath = extractAssetPath(indexHtml, /src="\.\/(assets\/[^"]+\.js)"/, 'main bundle');
  const mainStylesheetPath = extractAssetPath(indexHtml, /href="\.\/(assets\/[^"]+-[A-Za-z0-9]{8,}\.css)"/, 'main stylesheet');
  const mainBundle = await readFile(resolve(clientDistDir, mainAssetPath), 'utf8');
  const workerMatch = mainBundle.match(/\bpreview-render-worker-[A-Za-z0-9]+\.js\b/);

  assert.ok(workerMatch, 'expected main bundle to reference hashed preview worker');
  assert.doesNotMatch(mainBundle, /\bpreview-render-worker\.js\b/);
  await access(resolve(clientDistDir, 'assets', workerMatch[0]), fsConstants.R_OK);
  await access(resolve(clientDistDir, mainStylesheetPath), fsConstants.R_OK);
  assert.doesNotMatch(indexHtml, /main-entry\.js/);
});

test('excalidraw build references hashed HTML entry assets and omits the disabled mermaid-to-excalidraw payload', async () => {
  const excalidrawHtml = await readFile(resolve(clientDistDir, 'excalidraw-editor.html'), 'utf8');
  const excalidrawJsPath = extractAssetPath(
    excalidrawHtml,
    /src="\.\/(assets\/[^"]+\.js)"/,
    'Excalidraw script',
  );
  const excalidrawCssPath = extractAssetPath(
    excalidrawHtml,
    /href="\.\/(assets\/[^"]+-[A-Za-z0-9]{8,}\.css)"/,
    'Excalidraw stylesheet',
  );
  const excalidrawBundle = await readFile(resolve(clientDistDir, excalidrawJsPath), 'utf8');

  await access(resolve(clientDistDir, excalidrawCssPath), fsConstants.R_OK);
  assert.doesNotMatch(excalidrawHtml, /excalidraw-editor-entry\.js/);
  const importedSpecifiers = [
    ...excalidrawBundle.matchAll(/from"([^"]+)"/g),
    ...excalidrawBundle.matchAll(/import\("([^"]+)"\)/g),
  ].map((match) => match[1]);

  assert.match(excalidrawBundle, /excalidraw-mermaid-stub/i);
  assert.deepEqual(
    importedSpecifiers.filter((specifier) => /(flowchart-elk|mindmap-definition|sequenceDiagram|katex|cytoscape|elk)/i.test(specifier)),
    [],
  );
});
