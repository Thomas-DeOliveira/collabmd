import { cp, mkdir, rm, copyFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = resolve(rootDir, 'public');
const clientSourceDir = resolve(rootDir, 'src/client');
const sharedDomainSourceDir = resolve(rootDir, 'src/domain');
const clientOutputDir = resolve(publicDir, 'assets/js');
const sharedDomainOutputDir = resolve(publicDir, 'assets/domain');
const vendorModuleOutputDir = resolve(publicDir, 'assets/vendor/modules');
const previewWorkerSource = resolve(clientSourceDir, 'application/preview-render-worker.js');
const previewWorkerOutput = resolve(clientOutputDir, 'application/preview-render-worker.js');
const browserModuleBundles = [
  ['@codemirror/autocomplete', 'codemirror-autocomplete.js'],
  ['@codemirror/commands', 'codemirror-commands.js'],
  ['@codemirror/lang-markdown', 'codemirror-lang-markdown.js'],
  ['@codemirror/language', 'codemirror-language.js'],
  ['@codemirror/language-data', 'codemirror-language-data.js'],
  ['@codemirror/search', 'codemirror-search.js'],
  ['@codemirror/state', 'codemirror-state.js'],
  ['@codemirror/theme-one-dark', 'codemirror-theme-one-dark.js'],
  ['@codemirror/view', 'codemirror-view.js'],
  ['highlight.js', 'highlight.js'],
  ['markdown-it', 'markdown-it.js'],
  ['y-codemirror.next', 'y-codemirror-next.js'],
  ['y-websocket', 'y-websocket.js'],
  ['yjs', 'yjs.js'],
];
const browserResolveAliases = new Map([
  ['lib0/webcrypto', resolve(rootDir, 'node_modules/lib0/webcrypto.js')],
]);

async function resolveBrowserEntry(specifier) {
  return fileURLToPath(await import.meta.resolve(specifier));
}

function createNodeResolvePlugin({ externalSpecifiers = new Set() } = {}) {
  return {
    name: 'node-resolve',
    setup(buildContext) {
      buildContext.onResolve({ filter: /^[^./]|^\.[^./]|^\.\.[^/]/ }, async (args) => {
        if (externalSpecifiers.has(args.path)) {
          return {
            external: true,
            path: args.path,
          };
        }

        const browserAlias = browserResolveAliases.get(args.path);
        if (browserAlias) {
          return { path: browserAlias };
        }

        try {
          const resolvedUrl = args.importer
            ? await import.meta.resolve(args.path, pathToFileURL(args.importer).href)
            : await import.meta.resolve(args.path);

          return {
            path: fileURLToPath(resolvedUrl),
          };
        } catch {
          return null;
        }
      });
    },
  };
}

async function copyHighlightThemeFiles() {
  const themeDir = resolve(publicDir, 'assets/vendor/highlight');
  await mkdir(themeDir, { recursive: true });

  await copyFile(
    require.resolve('highlight.js/styles/github.min.css'),
    resolve(themeDir, 'github.min.css'),
  );

  await copyFile(
    require.resolve('highlight.js/styles/github-dark.min.css'),
    resolve(themeDir, 'github-dark.min.css'),
  );
}

async function copyMermaidBundle() {
  const mermaidDir = resolve(publicDir, 'assets/vendor/mermaid');
  await mkdir(mermaidDir, { recursive: true });
  await copyFile(
    require.resolve('mermaid/dist/mermaid.min.js'),
    resolve(mermaidDir, 'mermaid.min.js'),
  );
}

async function bundlePreviewWorker() {
  await mkdir(resolve(clientOutputDir, 'application'), { recursive: true });
  await build({
    alias: {
      'highlight.js': resolve(rootDir, 'node_modules/highlight.js/lib/index.js'),
      'markdown-it': resolve(rootDir, 'node_modules/markdown-it/dist/markdown-it.js'),
    },
    bundle: true,
    entryPoints: [previewWorkerSource],
    format: 'esm',
    outfile: previewWorkerOutput,
    platform: 'browser',
    plugins: [createNodeResolvePlugin()],
    target: ['es2022'],
  });
}

async function bundleBrowserModules() {
  await mkdir(vendorModuleOutputDir, { recursive: true });

  const entryPoints = Object.fromEntries(await Promise.all(
    browserModuleBundles.map(async ([specifier, fileName]) => [
      fileName.replace(/\.js$/u, ''),
      await resolveBrowserEntry(specifier),
    ]),
  ));

  await build({
    bundle: true,
    chunkNames: 'chunks/[name]-[hash]',
    entryNames: '[name]',
    entryPoints,
    format: 'esm',
    outdir: vendorModuleOutputDir,
    platform: 'browser',
    plugins: [createNodeResolvePlugin()],
    splitting: true,
    target: ['es2022'],
  });
}

await rm(clientOutputDir, { force: true, recursive: true });
await rm(sharedDomainOutputDir, { force: true, recursive: true });
await rm(vendorModuleOutputDir, { force: true, recursive: true });
await mkdir(clientOutputDir, { recursive: true });
await mkdir(sharedDomainOutputDir, { recursive: true });
await cp(clientSourceDir, clientOutputDir, { recursive: true });
await cp(sharedDomainSourceDir, sharedDomainOutputDir, { recursive: true });
await copyHighlightThemeFiles();
await copyMermaidBundle();
await bundlePreviewWorker();
await bundleBrowserModules();
