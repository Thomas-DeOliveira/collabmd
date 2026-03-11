import { getRequestErrorStatusCode } from './http-errors.js';
import { jsonResponse } from './http-response.js';
import { parseJsonBody } from './request-body.js';
import { createEmptyWorkspaceChange } from '../git/responses.js';

async function parseRequiredBody(req, res, fieldName) {
  const body = await parseJsonBody(req);
  if (!body?.[fieldName]) {
    jsonResponse(req, res, 400, { error: `Missing ${fieldName}` });
    return null;
  }

  return body;
}

function handleGitError(req, res, error, logMessage, fallbackMessage) {
  const statusCode = getRequestErrorStatusCode(error);
  if (statusCode) {
    jsonResponse(req, res, statusCode, { error: error.message });
    return true;
  }

  console.error(logMessage, error.message);
  jsonResponse(req, res, 500, { error: fallbackMessage });
  return true;
}

function hasWorkspaceMutation(workspaceChange = {}) {
  return Boolean(
    (workspaceChange.changedPaths?.length ?? 0) > 0
    || (workspaceChange.deletedPaths?.length ?? 0) > 0
    || (workspaceChange.renamedPaths?.length ?? 0) > 0,
  );
}

async function applyWorkspaceMutationEffects({
  backlinkIndex,
  responsePayload,
  roomRegistry,
  vaultFileStore,
}) {
  const workspaceChange = responsePayload?.workspaceChange ?? createEmptyWorkspaceChange();
  responsePayload.workspaceChange = workspaceChange;

  if (!hasWorkspaceMutation(workspaceChange)) {
    return responsePayload;
  }

  await vaultFileStore?.reconcileSidecars?.(workspaceChange);
  await backlinkIndex?.build?.();
  await roomRegistry?.reconcileWorkspaceChange?.(workspaceChange);
  return responsePayload;
}

export function createGitApiCommandHandler({
  backlinkIndex = null,
  gitService,
  roomRegistry = null,
  vaultFileStore = null,
}) {
  return async function handleGitApiCommand(req, res, requestUrl) {
    if (requestUrl.pathname === '/api/git/stage' && req.method === 'POST') {
      try {
        const body = await parseRequiredBody(req, res, 'path');
        if (!body) {
          return true;
        }

        jsonResponse(req, res, 200, await applyWorkspaceMutationEffects({
          backlinkIndex,
          responsePayload: await gitService.stageFile(body.path),
          roomRegistry,
          vaultFileStore,
        }));
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to stage git file:', 'Failed to stage git file');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/unstage' && req.method === 'POST') {
      try {
        const body = await parseRequiredBody(req, res, 'path');
        if (!body) {
          return true;
        }

        jsonResponse(req, res, 200, await applyWorkspaceMutationEffects({
          backlinkIndex,
          responsePayload: await gitService.unstageFile(body.path),
          roomRegistry,
          vaultFileStore,
        }));
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to unstage git file:', 'Failed to unstage git file');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/commit' && req.method === 'POST') {
      try {
        const body = await parseRequiredBody(req, res, 'message');
        if (!body) {
          return true;
        }

        jsonResponse(req, res, 200, await applyWorkspaceMutationEffects({
          backlinkIndex,
          responsePayload: await gitService.commitStaged({
            message: body.message,
          }),
          roomRegistry,
          vaultFileStore,
        }));
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to commit staged changes:', 'Failed to commit staged changes');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/push' && req.method === 'POST') {
      try {
        jsonResponse(req, res, 200, await applyWorkspaceMutationEffects({
          backlinkIndex,
          responsePayload: await gitService.pushBranch(),
          roomRegistry,
          vaultFileStore,
        }));
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to push git branch:', 'Failed to push git branch');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/pull' && req.method === 'POST') {
      try {
        jsonResponse(req, res, 200, await applyWorkspaceMutationEffects({
          backlinkIndex,
          responsePayload: await gitService.pullBranch(),
          roomRegistry,
          vaultFileStore,
        }));
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to pull git branch:', 'Failed to pull git branch');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/reset-file' && req.method === 'POST') {
      try {
        const body = await parseRequiredBody(req, res, 'path');
        if (!body) {
          return true;
        }

        jsonResponse(req, res, 200, await applyWorkspaceMutationEffects({
          backlinkIndex,
          responsePayload: await gitService.resetFileToHead(body.path),
          roomRegistry,
          vaultFileStore,
        }));
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to reset git file:', 'Failed to reset git file');
      }
      return true;
    }

    return false;
  };
}
