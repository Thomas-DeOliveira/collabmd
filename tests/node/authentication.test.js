import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTH_STRATEGY_NONE,
  AUTH_STRATEGY_OIDC,
  AUTH_STRATEGY_PASSWORD,
  createAuthService,
} from '../../src/server/auth/create-auth-service.js';
import { loadConfig } from '../../src/server/config/env.js';

function withAuthEnvCleared(fn) {
  const previousStrategy = process.env.AUTH_STRATEGY;
  const previousPassword = process.env.AUTH_PASSWORD;
  const previousGitRepoUrl = process.env.COLLABMD_GIT_REPO_URL;
  const previousGitPrivateKeyFile = process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_FILE;
  const previousGitPrivateKeyBase64 = process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_B64;
  const previousGitKnownHostsFile = process.env.COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE;
  const previousGitUserName = process.env.COLLABMD_GIT_USER_NAME;
  const previousGitUserEmail = process.env.COLLABMD_GIT_USER_EMAIL;
  const previousAuthorName = process.env.GIT_AUTHOR_NAME;
  const previousAuthorEmail = process.env.GIT_AUTHOR_EMAIL;
  const previousCommitterName = process.env.GIT_COMMITTER_NAME;
  const previousCommitterEmail = process.env.GIT_COMMITTER_EMAIL;

  delete process.env.AUTH_STRATEGY;
  delete process.env.AUTH_PASSWORD;
  delete process.env.COLLABMD_GIT_REPO_URL;
  delete process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_FILE;
  delete process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_B64;
  delete process.env.COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE;
  delete process.env.COLLABMD_GIT_USER_NAME;
  delete process.env.COLLABMD_GIT_USER_EMAIL;
  delete process.env.GIT_AUTHOR_NAME;
  delete process.env.GIT_AUTHOR_EMAIL;
  delete process.env.GIT_COMMITTER_NAME;
  delete process.env.GIT_COMMITTER_EMAIL;

  try {
    return fn();
  } finally {
    if (previousStrategy === undefined) {
      delete process.env.AUTH_STRATEGY;
    } else {
      process.env.AUTH_STRATEGY = previousStrategy;
    }

    if (previousPassword === undefined) {
      delete process.env.AUTH_PASSWORD;
    } else {
      process.env.AUTH_PASSWORD = previousPassword;
    }

    if (previousGitRepoUrl === undefined) {
      delete process.env.COLLABMD_GIT_REPO_URL;
    } else {
      process.env.COLLABMD_GIT_REPO_URL = previousGitRepoUrl;
    }

    if (previousGitPrivateKeyFile === undefined) {
      delete process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_FILE;
    } else {
      process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_FILE = previousGitPrivateKeyFile;
    }

    if (previousGitPrivateKeyBase64 === undefined) {
      delete process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_B64;
    } else {
      process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_B64 = previousGitPrivateKeyBase64;
    }

    if (previousGitKnownHostsFile === undefined) {
      delete process.env.COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE;
    } else {
      process.env.COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE = previousGitKnownHostsFile;
    }

    if (previousGitUserName === undefined) {
      delete process.env.COLLABMD_GIT_USER_NAME;
    } else {
      process.env.COLLABMD_GIT_USER_NAME = previousGitUserName;
    }

    if (previousGitUserEmail === undefined) {
      delete process.env.COLLABMD_GIT_USER_EMAIL;
    } else {
      process.env.COLLABMD_GIT_USER_EMAIL = previousGitUserEmail;
    }

    if (previousAuthorName === undefined) {
      delete process.env.GIT_AUTHOR_NAME;
    } else {
      process.env.GIT_AUTHOR_NAME = previousAuthorName;
    }

    if (previousAuthorEmail === undefined) {
      delete process.env.GIT_AUTHOR_EMAIL;
    } else {
      process.env.GIT_AUTHOR_EMAIL = previousAuthorEmail;
    }

    if (previousCommitterName === undefined) {
      delete process.env.GIT_COMMITTER_NAME;
    } else {
      process.env.GIT_COMMITTER_NAME = previousCommitterName;
    }

    if (previousCommitterEmail === undefined) {
      delete process.env.GIT_COMMITTER_EMAIL;
    } else {
      process.env.GIT_COMMITTER_EMAIL = previousCommitterEmail;
    }
  }
}

test('loadConfig defaults auth to none', () => withAuthEnvCleared(() => {
  const config = loadConfig({
    vaultDir: process.cwd(),
  });

  assert.equal(config.auth.strategy, AUTH_STRATEGY_NONE);
  assert.equal(config.auth.password, '');
}));

test('password auth generates a password when one is not provided', () => withAuthEnvCleared(() => {
  const config = loadConfig({
    auth: {
      strategy: AUTH_STRATEGY_PASSWORD,
    },
    vaultDir: process.cwd(),
  });

  assert.equal(config.auth.strategy, AUTH_STRATEGY_PASSWORD);
  assert.equal(typeof config.auth.password, 'string');
  assert.equal(config.auth.password.length > 0, true);
  assert.equal(config.auth.passwordWasGenerated, true);
}));

test('oidc auth is reserved in config and marked not implemented in client config', () => {
  const config = loadConfig({
    auth: {
      strategy: AUTH_STRATEGY_OIDC,
    },
    vaultDir: process.cwd(),
  });
  const authService = createAuthService(config);

  assert.equal(authService.getClientConfig().strategy, AUTH_STRATEGY_OIDC);
  assert.equal(authService.getClientConfig().implemented, false);
});

test('password auth returns transport-agnostic session results and API authorization decisions', () => {
  const config = loadConfig({
    auth: {
      password: 'shared-secret',
      strategy: AUTH_STRATEGY_PASSWORD,
    },
    vaultDir: process.cwd(),
  });
  const authService = createAuthService(config);
  const request = {
    headers: {},
  };

  const missingPassword = authService.createSession(request, {});
  assert.equal(missingPassword.statusCode, 400);
  assert.equal(missingPassword.body.error, 'Missing password');
  assert.equal(missingPassword.setCookie, null);

  const unauthorized = authService.authorizeApiRequest(request);
  assert.equal(unauthorized.ok, false);
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.body.code, 'AUTH_REQUIRED');

  const sessionResult = authService.createSession(request, {
    password: 'shared-secret',
  });
  assert.equal(sessionResult.statusCode, 200);
  assert.equal(sessionResult.body.ok, true);
  assert.equal(typeof sessionResult.setCookie, 'string');

  const authorizedRequest = {
    headers: {
      cookie: sessionResult.setCookie,
    },
  };
  assert.deepEqual(authService.authorizeApiRequest(authorizedRequest), { ok: true });
});

test('loadConfig rejects unsupported auth strategies', () => {
  assert.throws(() => {
    loadConfig({
      auth: {
        strategy: 'saml',
      },
      vaultDir: process.cwd(),
    });
  }, /Unsupported auth strategy/);
});

test('loadConfig keeps remote bootstrap disabled when git repo env is absent', () => withAuthEnvCleared(() => {
  const config = loadConfig({
    vaultDir: process.cwd(),
  });

  assert.equal(config.git.remote.enabled, false);
  assert.equal(config.git.remote.repoUrl, '');
}));

test('loadConfig rejects remote bootstrap without a private key source', () => withAuthEnvCleared(() => {
  process.env.COLLABMD_GIT_REPO_URL = 'git@github.com:example/private.git';

  assert.throws(() => {
    loadConfig({
      vaultDir: process.cwd(),
    });
  }, /Remote git bootstrap requires/);
}));

test('loadConfig captures git bootstrap env and prefers file over base64 when both are set', () => withAuthEnvCleared(() => {
  process.env.COLLABMD_GIT_REPO_URL = 'git@github.com:example/private.git';
  process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_FILE = './secrets/id_ed25519';
  process.env.COLLABMD_GIT_SSH_PRIVATE_KEY_B64 = Buffer.from('dummy private key', 'utf8').toString('base64');
  process.env.COLLABMD_GIT_SSH_KNOWN_HOSTS_FILE = './secrets/known_hosts';
  process.env.COLLABMD_GIT_USER_NAME = 'CollabMD Bot';
  process.env.COLLABMD_GIT_USER_EMAIL = 'bot@example.com';

  const config = loadConfig({
    vaultDir: process.cwd(),
  });

  assert.equal(config.git.remote.enabled, true);
  assert.equal(config.git.remote.repoUrl, 'git@github.com:example/private.git');
  assert.equal(config.git.identity.name, 'CollabMD Bot');
  assert.equal(config.git.identity.email, 'bot@example.com');
  assert.match(config.git.remote.sshPrivateKeyFile, /secrets\/id_ed25519$/);
  assert.equal(config.git.remote.sshPrivateKeyBase64.length > 0, true);
  assert.match(config.git.remote.sshKnownHostsFile, /secrets\/known_hosts$/);
}));

test('loadConfig falls back to standard git author env for identity', () => withAuthEnvCleared(() => {
  process.env.GIT_AUTHOR_NAME = 'Standard Author';
  process.env.GIT_AUTHOR_EMAIL = 'author@example.com';

  const config = loadConfig({
    vaultDir: process.cwd(),
  });

  assert.equal(config.git.identity.name, 'Standard Author');
  assert.equal(config.git.identity.email, 'author@example.com');
}));
