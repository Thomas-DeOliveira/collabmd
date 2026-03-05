import { cp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const helperDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(helperDir, '../../..');
const templateVaultDir = resolve(projectRoot, 'test-vault');
export const runtimeVaultDir = resolve(projectRoot, '.tmp/e2e-vault');

export async function resetE2EVaultSnapshot() {
  await rm(runtimeVaultDir, { force: true, recursive: true });
  await cp(templateVaultDir, runtimeVaultDir, { recursive: true });
}
