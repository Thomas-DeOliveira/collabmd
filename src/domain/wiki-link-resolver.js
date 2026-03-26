import { getVaultFileExtension, isMarkdownFilePath } from './file-kind.js';

function normalizeWikiTarget(target) {
  const trimmed = String(target ?? '').trim();
  if (!trimmed) {
    return null;
  }

  return trimmed;
}

export function createWikiTargetIndex(files = []) {
  const exactPaths = new Set();
  const suffixMatch = new Map();

  for (const filePath of files) {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      continue;
    }

    exactPaths.add(filePath);

    const segments = filePath.split('/');
    for (let index = 0; index < segments.length; index += 1) {
      const suffix = segments.slice(index).join('/');
      if (!suffixMatch.has(suffix)) {
        suffixMatch.set(suffix, filePath);
      }
    }
  }

  return {
    exactPaths,
    suffixMatch,
  };
}

export function resolveWikiTargetWithIndex(target, index) {
  const rawTarget = normalizeWikiTarget(target);
  if (!rawTarget || !index) {
    return null;
  }

  if (index.exactPaths?.has(rawTarget)) {
    return rawTarget;
  }

  const suffixMatch = index.suffixMatch?.get(rawTarget);
  if (suffixMatch) {
    return suffixMatch;
  }

  if (getVaultFileExtension(rawTarget)) {
    return null;
  }

  const markdownTarget = `${rawTarget}.md`;
  if (index.exactPaths?.has(markdownTarget)) {
    return markdownTarget;
  }

  return index.suffixMatch?.get(markdownTarget) ?? null;
}

export function resolveWikiTargetPath(target, files) {
  const rawTarget = normalizeWikiTarget(target);
  if (!rawTarget || !Array.isArray(files) || files.length === 0) {
    return null;
  }

  let fallbackSuffixMatch = null;

  for (const filePath of files) {
    if (filePath === rawTarget) {
      return filePath;
    }

    if (!fallbackSuffixMatch && filePath.endsWith(`/${rawTarget}`)) {
      fallbackSuffixMatch = filePath;
    }
  }

  if (fallbackSuffixMatch || getVaultFileExtension(rawTarget)) {
    return fallbackSuffixMatch;
  }

  const markdownTarget = `${rawTarget}.md`;
  let markdownSuffixMatch = null;
  for (const filePath of files) {
    if (!isMarkdownFilePath(filePath)) {
      continue;
    }

    if (filePath === markdownTarget) {
      return filePath;
    }

    if (!markdownSuffixMatch && filePath.endsWith(`/${markdownTarget}`)) {
      markdownSuffixMatch = filePath;
    }
  }

  return markdownSuffixMatch;
}
