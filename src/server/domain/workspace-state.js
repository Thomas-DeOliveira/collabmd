import { isMarkdownFilePath } from '../../domain/file-kind.js';

function compareWorkspacePaths(left = '', right = '') {
  return String(left).localeCompare(String(right), undefined, { sensitivity: 'base' });
}

export function collectWorkspaceStateStats(entries = new Map(), metadata = new Map()) {
  const markdownPaths = [];
  let vaultFileCount = 0;

  entries.forEach((entry, pathValue) => {
    const entryType = entry?.type ?? entry?.nodeType ?? metadata.get(pathValue)?.type ?? '';
    if (entryType === 'directory') {
      return;
    }

    vaultFileCount += 1;
    if (isMarkdownFilePath(pathValue)) {
      markdownPaths.push(pathValue);
    }
  });

  markdownPaths.sort(compareWorkspacePaths);

  return {
    markdownPaths,
    vaultFileCount,
  };
}

export function createWorkspaceStateSnapshot(entries = new Map(), metadata = new Map(), {
  scannedAt = Date.now(),
} = {}) {
  const normalizedEntries = entries instanceof Map ? entries : new Map(entries ?? []);
  const normalizedMetadata = metadata instanceof Map ? metadata : new Map(metadata ?? []);
  const stats = collectWorkspaceStateStats(normalizedEntries, normalizedMetadata);

  return {
    entries: normalizedEntries,
    markdownPaths: stats.markdownPaths,
    metadata: normalizedMetadata,
    scannedAt,
    vaultFileCount: stats.vaultFileCount,
  };
}
