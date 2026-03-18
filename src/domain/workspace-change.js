function uniquePaths(values = []) {
  return Array.from(new Set((values ?? []).filter(Boolean)));
}

function uniqueRenames(values = []) {
  return Array.from(new Map(
    (values ?? [])
      .filter((entry) => entry?.oldPath && entry?.newPath && entry.oldPath !== entry.newPath)
      .map((entry) => [`${entry.oldPath}:${entry.newPath}`, {
        newPath: entry.newPath,
        oldPath: entry.oldPath,
      }]),
  ).values());
}

function normalizeHighlightRanges(values = []) {
  return (values ?? [])
    .filter((entry) => entry?.path && Number.isFinite(entry?.from) && Number.isFinite(entry?.to))
    .map((entry) => ({
      from: Math.max(0, Math.round(entry.from)),
      path: entry.path,
      to: Math.max(0, Math.round(entry.to)),
    }));
}

export function createWorkspaceChange({
  changedPaths = [],
  deletedPaths = [],
  refreshExplorer = true,
  renamedPaths = [],
} = {}) {
  return {
    changedPaths: uniquePaths(changedPaths),
    deletedPaths: uniquePaths(deletedPaths),
    refreshExplorer: refreshExplorer !== false,
    renamedPaths: uniqueRenames(renamedPaths),
  };
}

export function createEmptyWorkspaceChange() {
  return createWorkspaceChange();
}

export function hasWorkspaceMutation(workspaceChange = {}) {
  return Boolean(
    (workspaceChange.changedPaths?.length ?? 0) > 0
    || (workspaceChange.deletedPaths?.length ?? 0) > 0
    || (workspaceChange.renamedPaths?.length ?? 0) > 0,
  );
}

export function normalizeWorkspaceEvent(event) {
  if (!event || typeof event !== 'object' || typeof event.id !== 'string') {
    return null;
  }

  return {
    action: typeof event.action === 'string' ? event.action : 'workspace',
    createdAt: Number.isFinite(event.createdAt) ? event.createdAt : Date.now(),
    highlightRanges: normalizeHighlightRanges(event.highlightRanges),
    id: event.id,
    origin: typeof event.origin === 'string' ? event.origin : 'api',
    reloadRequiredPaths: uniquePaths(event.reloadRequiredPaths),
    requestId: typeof event.requestId === 'string' ? event.requestId : null,
    sourceRef: typeof event.sourceRef === 'string' ? event.sourceRef : null,
    workspaceChange: createWorkspaceChange(event.workspaceChange),
  };
}
