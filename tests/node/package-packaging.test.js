import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

async function listRelativeFiles(rootPath, currentPath = rootPath) {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = resolve(currentPath, entry.name);
    if (entry.isDirectory()) {
      return listRelativeFiles(rootPath, entryPath);
    }

    return [entryPath.slice(rootPath.length + 1).replaceAll('\\', '/')];
  }));

  return nested.flat();
}

async function packProject() {
  const tempRoot = await mkdtemp(resolve(tmpdir(), 'collabmd-pack-'));
  const packDir = resolve(tempRoot, 'pack');
  const unpackDir = resolve(tempRoot, 'unpack');
  const npmCacheDir = resolve(tempRoot, 'npm-cache');
  const npmConfigDir = resolve(tempRoot, 'xdg-config');
  const npmHomeDir = resolve(tempRoot, 'home');
  const npmLogDir = resolve(tempRoot, 'npm-logs');
  const npmTempDir = resolve(tempRoot, 'npm-tmp');

  await mkdir(packDir, { recursive: true });
  await mkdir(unpackDir, { recursive: true });
  await mkdir(npmCacheDir, { recursive: true });
  await mkdir(npmConfigDir, { recursive: true });
  await mkdir(npmHomeDir, { recursive: true });
  await mkdir(npmLogDir, { recursive: true });
  await mkdir(npmTempDir, { recursive: true });

  const npmEnv = {
    ...process.env,
    HOME: npmHomeDir,
    USERPROFILE: npmHomeDir,
    XDG_CACHE_HOME: npmCacheDir,
    XDG_CONFIG_HOME: npmConfigDir,
    npm_config_cache: npmCacheDir,
    npm_config_logs_dir: npmLogDir,
    npm_config_loglevel: 'error',
    npm_config_tmp: npmTempDir,
    npm_config_update_notifier: 'false',
    npm_config_userconfig: resolve(npmHomeDir, '.npmrc'),
  };

  await execFile('npm', ['run', 'build'], {
    cwd: rootDir,
    env: npmEnv,
  });

  const { stdout } = await execFile('npm', ['pack', '--pack-destination', packDir, '--json'], {
    cwd: rootDir,
    env: npmEnv,
  });
  const [packResult] = JSON.parse(stdout);
  const tarballPath = resolve(packDir, packResult.filename);

  await execFile('tar', ['-xzf', tarballPath, '-C', unpackDir]);

  return {
    cleanup: () => rm(tempRoot, { force: true, recursive: true }),
    packageRoot: resolve(unpackDir, 'package'),
  };
}

test('npm pack includes built public assets and runtime helper scripts required by the packaged install', async () => {
  const artifact = await packProject();

  try {
    const packagedPaths = new Set(await listRelativeFiles(artifact.packageRoot));

    assert.ok(packagedPaths.has('public/index.html'));
    assert.ok(packagedPaths.has('public/assets/css/base.css'));
    assert.ok(packagedPaths.has('public/assets/css/style.css'));
    assert.ok(packagedPaths.has('public/assets/js/main.js'));
    assert.ok(packagedPaths.has('public/assets/vendor/highlight/github-dark.min.css'));
    assert.ok(packagedPaths.has('docker-compose.yml'));
    assert.ok(packagedPaths.has('scripts/cloudflare-tunnel.mjs'));
    assert.ok(packagedPaths.has('scripts/local-plantuml-compose.mjs'));
  } finally {
    await artifact.cleanup();
  }
});

test('packed tarball can run the CLI help path and includes valid runtime helper scripts', async () => {
  const artifact = await packProject();

  try {
    const { packageRoot } = artifact;
    const packagedCliPath = resolve(packageRoot, 'bin/collabmd.js');
    const dockerComposePath = resolve(packageRoot, 'docker-compose.yml');
    const localPlantUmlScriptPath = resolve(packageRoot, 'scripts/local-plantuml-compose.mjs');
    const cloudflareTunnelScriptPath = resolve(packageRoot, 'scripts/cloudflare-tunnel.mjs');

    await access(packagedCliPath);
    await access(dockerComposePath);
    await access(localPlantUmlScriptPath);
    await access(cloudflareTunnelScriptPath);

    const helpResult = await execFile(process.execPath, [packagedCliPath, '--help'], {
      cwd: packageRoot,
    });

    assert.match(helpResult.stdout, /CollabMD/);
    assert.match(helpResult.stdout, /--local-plantuml/);

    await execFile(process.execPath, ['--check', packagedCliPath], {
      cwd: packageRoot,
    });
    await execFile(process.execPath, ['--check', localPlantUmlScriptPath], {
      cwd: packageRoot,
    });
    await execFile(process.execPath, ['--check', cloudflareTunnelScriptPath], {
      cwd: packageRoot,
    });
  } finally {
    await artifact.cleanup();
  }
});
