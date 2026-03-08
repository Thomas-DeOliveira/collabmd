import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises';
import { dirname, join, normalize, relative, resolve } from 'path';
import {
  getVaultTreeNodeType,
  isExcalidrawFilePath,
  isMarkdownFilePath,
  isMermaidFilePath,
  isPlantUmlFilePath,
  isVaultFilePath,
} from '../../../domain/file-kind.js';

const IGNORED_DIRECTORIES = new Set(['.git', '.obsidian', '.trash', 'node_modules', '.DS_Store']);
const COMMENT_STORAGE_ROOT = '.collabmd/comments';
const YJS_SNAPSHOT_STORAGE_ROOT = '.collabmd/yjs';

function isIgnored(name) {
  return IGNORED_DIRECTORIES.has(name) || name.startsWith('.');
}

function sanitizePath(vaultDir, requestedPath) {
  const normalized = normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  const absolute = resolve(vaultDir, normalized);
  const vaultRoot = vaultDir.endsWith('/') ? vaultDir : `${vaultDir}/`;

  if (!absolute.startsWith(vaultRoot) && absolute !== vaultDir) {
    return null;
  }

  return absolute;
}

function getCommentThreadPath(vaultDir, filePath) {
  const absoluteVaultPath = sanitizePath(vaultDir, filePath);
  if (!absoluteVaultPath || !isVaultFilePath(absoluteVaultPath)) {
    return null;
  }

  const relativeVaultPath = relative(vaultDir, absoluteVaultPath);
  return resolve(vaultDir, COMMENT_STORAGE_ROOT, `${relativeVaultPath}.json`);
}

function getYjsSnapshotPath(vaultDir, filePath) {
  const absoluteVaultPath = sanitizePath(vaultDir, filePath);
  if (!absoluteVaultPath || !isVaultFilePath(absoluteVaultPath)) {
    return null;
  }

  const relativeVaultPath = relative(vaultDir, absoluteVaultPath);
  return resolve(vaultDir, YJS_SNAPSHOT_STORAGE_ROOT, `${relativeVaultPath}.bin`);
}

export class VaultFileStore {
  constructor({ vaultDir }) {
    this.vaultDir = resolve(vaultDir);
  }

  async tree() {
    return this.readDirectory(this.vaultDir);
  }

  async readDirectory(dirPath) {
    const entries = [];

    let dirEntries;
    try {
      dirEntries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return entries;
    }

    const sorted = dirEntries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    for (const entry of sorted) {
      if (isIgnored(entry.name)) continue;

      const fullPath = join(dirPath, entry.name);
      const relativePath = relative(this.vaultDir, fullPath);

      if (entry.isDirectory()) {
        const children = await this.readDirectory(fullPath);
        entries.push({
          name: entry.name,
          path: relativePath,
          type: 'directory',
          children,
        });
      } else if (isVaultFilePath(entry.name)) {
        entries.push({
          name: entry.name,
          path: relativePath,
          type: getVaultTreeNodeType(entry.name),
        });
      }
    }

    return entries;
  }

  async readMarkdownFile(filePath) {
    const absolute = sanitizePath(this.vaultDir, filePath);
    if (!absolute || !isMarkdownFilePath(absolute)) {
      return null;
    }

    try {
      const content = await readFile(absolute, 'utf-8');
      return content;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async readCommentThreads(filePath) {
    const absolute = getCommentThreadPath(this.vaultDir, filePath);
    if (!absolute) {
      return [];
    }

    try {
      const raw = await readFile(absolute, 'utf-8');
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        return parsed;
      }

      return Array.isArray(parsed?.threads) ? parsed.threads : [];
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  async readCollaborationSnapshot(filePath) {
    const absolute = getYjsSnapshotPath(this.vaultDir, filePath);
    if (!absolute) {
      return null;
    }

    try {
      const content = await readFile(absolute);
      return new Uint8Array(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  async writeCommentThreads(filePath, threads = []) {
    const absolute = getCommentThreadPath(this.vaultDir, filePath);
    if (!absolute) {
      return { ok: false, error: 'Invalid file path' };
    }

    try {
      if (!Array.isArray(threads) || threads.length === 0) {
        await rm(absolute, { force: true });
        return { ok: true };
      }

      const dir = dirname(absolute);
      await mkdir(dir, { recursive: true });
      await writeFile(absolute, `${JSON.stringify({
        threads,
        version: 1,
      }, null, 2)}\n`, 'utf-8');
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async readExcalidrawFile(filePath) {
    const absolute = sanitizePath(this.vaultDir, filePath);
    if (!absolute || !isExcalidrawFilePath(absolute)) {
      return null;
    }

    try {
      const content = await readFile(absolute, 'utf-8');
      return content;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async writeExcalidrawFile(
    filePath,
    content,
    { invalidateCollaborationSnapshot = true } = {},
  ) {
    const absolute = sanitizePath(this.vaultDir, filePath);
    if (!absolute || !isExcalidrawFilePath(absolute)) {
      return { ok: false, error: 'Invalid file path — must end in .excalidraw' };
    }

    try {
      const dir = dirname(absolute);
      await mkdir(dir, { recursive: true });
      await writeFile(absolute, content, 'utf-8');
      if (invalidateCollaborationSnapshot) {
        await this.deleteCollaborationSnapshot(filePath);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async readPlantUmlFile(filePath) {
    const absolute = sanitizePath(this.vaultDir, filePath);
    if (!absolute || !isPlantUmlFilePath(absolute)) {
      return null;
    }

    try {
      const content = await readFile(absolute, 'utf-8');
      return content;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async readMermaidFile(filePath) {
    const absolute = sanitizePath(this.vaultDir, filePath);
    if (!absolute || !isMermaidFilePath(absolute)) {
      return null;
    }

    try {
      const content = await readFile(absolute, 'utf-8');
      return content;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async writeMermaidFile(
    filePath,
    content,
    { invalidateCollaborationSnapshot = true } = {},
  ) {
    const absolute = sanitizePath(this.vaultDir, filePath);
    if (!absolute || !isMermaidFilePath(absolute)) {
      return { ok: false, error: 'Invalid file path — must end in .mmd or .mermaid' };
    }

    try {
      const dir = dirname(absolute);
      await mkdir(dir, { recursive: true });
      await writeFile(absolute, content, 'utf-8');
      if (invalidateCollaborationSnapshot) {
        await this.deleteCollaborationSnapshot(filePath);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async writePlantUmlFile(
    filePath,
    content,
    { invalidateCollaborationSnapshot = true } = {},
  ) {
    const absolute = sanitizePath(this.vaultDir, filePath);
    if (!absolute || !isPlantUmlFilePath(absolute)) {
      return { ok: false, error: 'Invalid file path — must end in .puml or .plantuml' };
    }

    try {
      const dir = dirname(absolute);
      await mkdir(dir, { recursive: true });
      await writeFile(absolute, content, 'utf-8');
      if (invalidateCollaborationSnapshot) {
        await this.deleteCollaborationSnapshot(filePath);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async writeMarkdownFile(
    filePath,
    content,
    { invalidateCollaborationSnapshot = true } = {},
  ) {
    const absolute = sanitizePath(this.vaultDir, filePath);
    if (!absolute || !isMarkdownFilePath(absolute)) {
      return { ok: false, error: 'Invalid file path' };
    }

    try {
      const dir = dirname(absolute);
      await mkdir(dir, { recursive: true });
      await writeFile(absolute, content, 'utf-8');
      if (invalidateCollaborationSnapshot) {
        await this.deleteCollaborationSnapshot(filePath);
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async writeCollaborationSnapshot(filePath, snapshot) {
    const absolute = getYjsSnapshotPath(this.vaultDir, filePath);
    if (!absolute) {
      return { ok: false, error: 'Invalid file path' };
    }

    try {
      const dir = dirname(absolute);
      await mkdir(dir, { recursive: true });
      await writeFile(absolute, Buffer.from(snapshot));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async deleteCollaborationSnapshot(filePath) {
    const absolute = getYjsSnapshotPath(this.vaultDir, filePath);
    if (!absolute) {
      return { ok: false, error: 'Invalid file path' };
    }

    try {
      await rm(absolute, { force: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async createFile(filePath, content = '') {
    const absolute = sanitizePath(this.vaultDir, filePath);
    if (!absolute || !isVaultFilePath(absolute)) {
      return { ok: false, error: 'Invalid file path — must end in .md, .excalidraw, .mmd, .mermaid, .puml, or .plantuml' };
    }

    try {
      await stat(absolute);
      return { ok: false, error: 'File already exists' };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const dir = dirname(absolute);
    await mkdir(dir, { recursive: true });
    await writeFile(absolute, content, 'utf-8');
    await this.deleteCollaborationSnapshot(filePath);
    return { ok: true };
  }

  async deleteFile(filePath) {
    const absolute = sanitizePath(this.vaultDir, filePath);
    if (!absolute || !isVaultFilePath(absolute)) {
      return { ok: false, error: 'Invalid file path — must end in .md, .excalidraw, .mmd, .mermaid, .puml, or .plantuml' };
    }

    try {
      await rm(absolute, { force: true });
      const commentPath = getCommentThreadPath(this.vaultDir, filePath);
      if (commentPath) {
        await rm(commentPath, { force: true });
      }
      const snapshotPath = getYjsSnapshotPath(this.vaultDir, filePath);
      if (snapshotPath) {
        await rm(snapshotPath, { force: true });
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async renameFile(oldPath, newPath) {
    const absoluteOld = sanitizePath(this.vaultDir, oldPath);
    const absoluteNew = sanitizePath(this.vaultDir, newPath);

    if (!absoluteOld || !absoluteNew) {
      return { ok: false, error: 'Invalid file path' };
    }

    if (!isVaultFilePath(absoluteOld)) {
      return { ok: false, error: 'Old path must be a vault file (.md, .excalidraw, .mmd, .mermaid, .puml, or .plantuml)' };
    }

    if (!isVaultFilePath(absoluteNew)) {
      return { ok: false, error: 'New path must be a vault file (.md, .excalidraw, .mmd, .mermaid, .puml, or .plantuml)' };
    }

    try {
      const dir = dirname(absoluteNew);
      await mkdir(dir, { recursive: true });
      await rename(absoluteOld, absoluteNew);

      const oldCommentPath = getCommentThreadPath(this.vaultDir, oldPath);
      const newCommentPath = getCommentThreadPath(this.vaultDir, newPath);
      if (oldCommentPath && newCommentPath) {
        try {
          await stat(oldCommentPath);
          await mkdir(dirname(newCommentPath), { recursive: true });
          await rename(oldCommentPath, newCommentPath);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      }

      const oldSnapshotPath = getYjsSnapshotPath(this.vaultDir, oldPath);
      const newSnapshotPath = getYjsSnapshotPath(this.vaultDir, newPath);
      if (oldSnapshotPath && newSnapshotPath) {
        try {
          await stat(oldSnapshotPath);
          await mkdir(dirname(newSnapshotPath), { recursive: true });
          await rename(oldSnapshotPath, newSnapshotPath);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      }

      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async createDirectory(dirPath) {
    const absolute = sanitizePath(this.vaultDir, dirPath);
    if (!absolute) {
      return { ok: false, error: 'Invalid directory path' };
    }

    try {
      await mkdir(absolute, { recursive: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async countVaultFiles() {
    return this.countFilesInDir(this.vaultDir);
  }

  async countFilesInDir(dirPath) {
    let count = 0;

    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return 0;
    }

    for (const entry of entries) {
      if (isIgnored(entry.name)) continue;
      const fullPath = join(dirPath, entry.name);

      if (entry.isDirectory()) {
        count += await this.countFilesInDir(fullPath);
      } else if (isVaultFilePath(entry.name)) {
        count += 1;
      }
    }

    return count;
  }

  resolveWikiLink(linkTarget) {
    const normalized = linkTarget.endsWith('.md') ? linkTarget : `${linkTarget}.md`;
    const absolute = sanitizePath(this.vaultDir, normalized);
    if (!absolute) return null;
    return relative(this.vaultDir, absolute);
  }
}
