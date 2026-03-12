const MARKDOWN_FILE_EXTENSIONS = Object.freeze(['.md', '.markdown', '.mdx']);
const EXCALIDRAW_FILE_EXTENSION = '.excalidraw';
const MERMAID_FILE_EXTENSIONS = Object.freeze(['.mmd', '.mermaid']);
const PLANTUML_FILE_EXTENSIONS = Object.freeze(['.puml', '.plantuml']);
const DIAGRAM_FILE_EXTENSIONS = Object.freeze([
  EXCALIDRAW_FILE_EXTENSION,
  ...MERMAID_FILE_EXTENSIONS,
  ...PLANTUML_FILE_EXTENSIONS,
]);
const VAULT_FILE_EXTENSIONS = Object.freeze([
  ...MARKDOWN_FILE_EXTENSIONS,
  ...DIAGRAM_FILE_EXTENSIONS,
]);
const STRIP_VAULT_EXTENSION_PATTERN = /\.(?:md|markdown|mdx|excalidraw|mmd|mermaid|puml|plantuml)$/i;

function normalizeFilePath(filePath) {
  return String(filePath ?? '').trim().toLowerCase();
}

function hasFileExtension(filePath, extensions) {
  const normalized = normalizeFilePath(filePath);
  return extensions.some((extension) => normalized.endsWith(extension));
}

export {
  DIAGRAM_FILE_EXTENSIONS,
  EXCALIDRAW_FILE_EXTENSION,
  MARKDOWN_FILE_EXTENSIONS,
  MERMAID_FILE_EXTENSIONS,
  PLANTUML_FILE_EXTENSIONS,
  VAULT_FILE_EXTENSIONS,
};

export function getVaultFileKind(filePath) {
  if (hasFileExtension(filePath, MARKDOWN_FILE_EXTENSIONS)) {
    return 'markdown';
  }

  if (hasFileExtension(filePath, [EXCALIDRAW_FILE_EXTENSION])) {
    return 'excalidraw';
  }

  if (hasFileExtension(filePath, MERMAID_FILE_EXTENSIONS)) {
    return 'mermaid';
  }

  if (hasFileExtension(filePath, PLANTUML_FILE_EXTENSIONS)) {
    return 'plantuml';
  }

  return null;
}

export function getVaultTreeNodeType(filePath) {
  const kind = getVaultFileKind(filePath);
  if (!kind) {
    return null;
  }

  return kind === 'markdown' ? 'file' : kind;
}

export function getVaultFileExtension(filePath) {
  const normalized = normalizeFilePath(filePath);
  return VAULT_FILE_EXTENSIONS.find((extension) => normalized.endsWith(extension)) ?? '';
}

export function isMarkdownFilePath(filePath) {
  return getVaultFileKind(filePath) === 'markdown';
}

export function isExcalidrawFilePath(filePath) {
  return getVaultFileKind(filePath) === 'excalidraw';
}

export function isMermaidFilePath(filePath) {
  return getVaultFileKind(filePath) === 'mermaid';
}

export function isPlantUmlFilePath(filePath) {
  return getVaultFileKind(filePath) === 'plantuml';
}

export function isDiagramFilePath(filePath) {
  const kind = getVaultFileKind(filePath);
  return kind === 'excalidraw' || kind === 'mermaid' || kind === 'plantuml';
}

export function isVaultFilePath(filePath) {
  return getVaultFileKind(filePath) !== null;
}

export function supportsCommentsForFilePath(filePath) {
  const kind = getVaultFileKind(filePath);
  return kind === 'markdown' || kind === 'mermaid' || kind === 'plantuml';
}

export function supportsBacklinksForFilePath(filePath) {
  return isMarkdownFilePath(filePath);
}

export function stripVaultFileExtension(name) {
  return String(name ?? '').replace(STRIP_VAULT_EXTENSION_PATTERN, '');
}
