import {
  isMermaidFilePath,
  isPlantUmlFilePath,
  stripVaultFileExtension,
} from '../../domain/file-kind.js';

export function normalizeVaultPathInput(value) {
  const segments = String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/u, '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return '';
  }

  return segments.join('/');
}

export function composeVaultChildPath(parentDir, childPath) {
  const normalizedParent = normalizeVaultPathInput(parentDir);
  const normalizedChild = normalizeVaultPathInput(childPath);

  if (!normalizedParent) {
    return normalizedChild;
  }

  if (!normalizedChild) {
    return normalizedParent;
  }

  return `${normalizedParent}/${normalizedChild}`;
}

export function ensureVaultExtension(pathValue, extension) {
  return pathValue.toLowerCase().endsWith(extension.toLowerCase())
    ? pathValue
    : `${pathValue}${extension}`;
}

export function createMarkdownStarter(filePath) {
  const title = stripVaultFileExtension(String(filePath ?? '').split('/').pop() || '') || 'Untitled';
  return `# ${title}\n\n`;
}

export function createMermaidStarter(filePath) {
  const normalizedPath = normalizeVaultPathInput(filePath);
  const nextPath = isMermaidFilePath(normalizedPath)
    ? normalizedPath
    : `${normalizedPath}.mmd`;
  return {
    content: [
      'flowchart TD',
      '  A[Start] --> B{Decide}',
      '  B -->|Yes| C[Ship it]',
      '  B -->|No| D[Revise]',
      '',
    ].join('\n'),
    path: nextPath,
  };
}

export function createPlantUmlStarter(filePath) {
  const normalizedPath = normalizeVaultPathInput(filePath);
  const nextPath = isPlantUmlFilePath(normalizedPath)
    ? normalizedPath
    : `${normalizedPath}.puml`;
  return {
    content: [
      '@startuml',
      'Alice -> Bob: Hello',
      '@enduml',
      '',
    ].join('\n'),
    path: nextPath,
  };
}
