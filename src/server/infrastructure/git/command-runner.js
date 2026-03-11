import { execFile as execFileCallback } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

export class GitCommandRunner {
  constructor({
    commandEnv = null,
    enabled = true,
    execFileImpl = execFile,
    vaultDir,
  }) {
    this.commandEnv = commandEnv;
    this.enabled = enabled;
    this.execFileImpl = execFileImpl;
    this.vaultDir = vaultDir;
  }

  async isGitRepo() {
    if (!this.enabled) {
      return false;
    }

    try {
      await access(join(this.vaultDir, '.git'));
      return true;
    } catch {
      return false;
    }
  }

  async execGit(args) {
    const result = await this.execFileImpl('git', ['-c', 'core.quotepath=false', ...args], {
      cwd: this.vaultDir,
      encoding: 'utf8',
      env: {
        ...process.env,
        ...(this.commandEnv ?? {}),
      },
      maxBuffer: 5 * 1024 * 1024,
      timeout: 10_000,
    });

    return String(result.stdout ?? '');
  }
}
