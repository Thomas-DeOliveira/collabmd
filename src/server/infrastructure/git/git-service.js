import { createGitRequestError } from './errors.js';
import { normalizeRelativeGitPath } from './path-utils.js';
import { GitCommandRunner } from './command-runner.js';
import { GitDiffService } from './diff-service.js';
import { GitStatusService } from './status-service.js';
import { GitUntrackedFileService } from './untracked-files.js';

export class GitService {
  constructor({
    commandEnv = null,
    enabled = true,
    execFileImpl,
    maxInitialPatchBytes = 250_000,
    maxInitialPatchLines = 1_500,
    statusCacheTtlMs = 2_000,
    vaultDir,
  }) {
    this.commandRunner = new GitCommandRunner({
      commandEnv,
      enabled,
      execFileImpl,
      vaultDir,
    });
    this.untrackedFileService = new GitUntrackedFileService({ vaultDir });
    this.statusService = new GitStatusService({
      commandRunner: this.commandRunner,
      statusCacheTtlMs,
      untrackedFileService: this.untrackedFileService,
    });
    this.diffService = new GitDiffService({
      commandRunner: this.commandRunner,
      maxInitialPatchBytes,
      maxInitialPatchLines,
      statusService: this.statusService,
      untrackedFileService: this.untrackedFileService,
    });
  }

  async isGitRepo() {
    return this.commandRunner.isGitRepo();
  }

  async execGit(args) {
    return this.commandRunner.execGit(args);
  }

  invalidateStatusCache() {
    this.statusService.invalidate();
    this.diffService.invalidate();
  }

  async getStatus(options = {}) {
    return this.statusService.getStatus(options);
  }

  async stageFile(path) {
    const normalizedPath = normalizeRelativeGitPath(path);
    await this.commandRunner.execGit(['add', '-A', '--', normalizedPath]);
    this.invalidateStatusCache();
    return {
      ok: true,
      path: normalizedPath,
    };
  }

  async unstageFile(path) {
    const normalizedPath = normalizeRelativeGitPath(path);
    await this.commandRunner.execGit(['reset', 'HEAD', '--', normalizedPath]);
    this.invalidateStatusCache();
    return {
      ok: true,
      path: normalizedPath,
    };
  }

  async commitStaged({ message } = {}) {
    const normalizedMessage = String(message ?? '').trim();
    if (!normalizedMessage) {
      throw createGitRequestError(400, 'Missing commit message');
    }

    const status = await this.getStatus({ force: true });
    if (Number(status.summary?.staged || 0) === 0) {
      throw createGitRequestError(409, 'No staged changes to commit');
    }

    await this.commandRunner.execGit(['commit', '-m', normalizedMessage]);
    const hash = (await this.commandRunner.execGit(['rev-parse', 'HEAD'])).trim();
    const shortHash = (await this.commandRunner.execGit(['rev-parse', '--short', 'HEAD'])).trim();
    this.invalidateStatusCache();
    return {
      commit: {
        hash,
        message: normalizedMessage,
        shortHash,
      },
      ok: true,
    };
  }

  async pushBranch() {
    const status = await this.getStatus({ force: true });
    if (status.branch?.detached) {
      throw createGitRequestError(409, 'Cannot push from a detached HEAD');
    }
    if (!status.branch?.upstream) {
      throw createGitRequestError(409, 'No upstream branch is configured for push');
    }

    const output = await this.commandRunner.execGit(['push']);
    this.invalidateStatusCache();
    return {
      ok: true,
      output: output.trim(),
    };
  }

  async pullBranch() {
    const status = await this.getStatus({ force: true });
    if (status.branch?.detached) {
      throw createGitRequestError(409, 'Cannot pull from a detached HEAD');
    }
    if (!status.branch?.upstream) {
      throw createGitRequestError(409, 'No upstream branch is configured for pull');
    }

    const output = await this.commandRunner.execGit(['pull', '--ff-only']);
    this.invalidateStatusCache();
    return {
      ok: true,
      output: output.trim(),
    };
  }

  async getDiff({ allowLargePatch = false, metaOnly = false, path = null, scope = 'working-tree' } = {}) {
    const normalizedPath = path ? normalizeRelativeGitPath(path) : null;
    return this.diffService.getDiff({
      allowLargePatch,
      metaOnly,
      path: normalizedPath,
      scope,
    });
  }
}
