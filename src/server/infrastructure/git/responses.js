const STATUS_MAP = {
  A: { code: 'A', label: 'added', status: 'added' },
  C: { code: 'C', label: 'copied', status: 'copied' },
  D: { code: 'D', label: 'deleted', status: 'deleted' },
  M: { code: 'M', label: 'modified', status: 'modified' },
  R: { code: 'R', label: 'renamed', status: 'renamed' },
  T: { code: 'T', label: 'type change', status: 'type-changed' },
  U: { code: 'U', label: 'conflicted', status: 'conflicted' },
  '?': { code: 'U', label: 'untracked', status: 'untracked' },
};

export function createStatusInfo(symbol) {
  return STATUS_MAP[symbol] ?? { code: symbol || 'M', label: 'modified', status: 'modified' };
}

export function createEmptyStats() {
  return {
    additions: 0,
    deletions: 0,
  };
}

export function createEmptySummary() {
  return {
    additions: 0,
    changedFiles: 0,
    deletions: 0,
    staged: 0,
    untracked: 0,
    workingTree: 0,
  };
}

export function createEmptyBranchStatus() {
  return {
    ahead: 0,
    behind: 0,
    detached: false,
    hasCommits: false,
    name: null,
    upstream: null,
  };
}

export function createEmptyWorkspaceChange() {
  return {
    changedPaths: [],
    deletedPaths: [],
    refreshExplorer: true,
    renamedPaths: [],
  };
}

export function createEmptyStatusResponse() {
  return {
    branch: createEmptyBranchStatus(),
    isGitRepo: false,
    sections: [
      { files: [], key: 'staged', label: 'Staged Changes' },
      { files: [], key: 'working-tree', label: 'Changes' },
      { files: [], key: 'untracked', label: 'Untracked' },
    ],
    summary: createEmptySummary(),
  };
}

export function createDiffResponse({
  files = [],
  isGitRepo = true,
  metaOnly = false,
  path = null,
  scope = 'working-tree',
  summary = {
    additions: 0,
    deletions: 0,
    filesChanged: 0,
  },
} = {}) {
  return {
    files,
    isGitRepo,
    metaOnly,
    path,
    scope,
    summary,
  };
}

export function createWorkspaceChange({
  changedPaths = [],
  deletedPaths = [],
  refreshExplorer = true,
  renamedPaths = [],
} = {}) {
  return {
    changedPaths: Array.from(new Set((changedPaths ?? []).filter(Boolean))),
    deletedPaths: Array.from(new Set((deletedPaths ?? []).filter(Boolean))),
    refreshExplorer: Boolean(refreshExplorer),
    renamedPaths: Array.from(new Map(
      (renamedPaths ?? [])
        .filter((entry) => entry?.oldPath && entry?.newPath && entry.oldPath !== entry.newPath)
        .map((entry) => [`${entry.oldPath}:${entry.newPath}`, {
          newPath: entry.newPath,
          oldPath: entry.oldPath,
        }]),
    ).values()),
  };
}
