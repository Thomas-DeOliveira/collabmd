import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

import { normalizeWorkspaceEvent } from '../../domain/workspace-change.js';
import { WORKSPACE_ROOM_NAME } from '../../domain/workspace-room.js';
import { resolveWsBaseUrl } from '../domain/runtime-paths.js';
import { stopReconnectOnControlledClose } from './yjs-provider-reset-guard.js';

function createNode(entry) {
  if (!entry?.path || !entry?.type) {
    return null;
  }

  if (entry.nodeType === 'directory' || entry.type === 'directory') {
    return {
      children: [],
      name: entry.name,
      path: entry.path,
      type: 'directory',
    };
  }

  return {
    name: entry.name,
    path: entry.path,
    type: entry.type,
  };
}

function sortNodes(nodes = []) {
  nodes.sort((left, right) => {
    if (left.type === 'directory' && right.type !== 'directory') return -1;
    if (left.type !== 'directory' && right.type === 'directory') return 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });

  nodes.forEach((node) => {
    if (Array.isArray(node.children)) {
      sortNodes(node.children);
    }
  });

  return nodes;
}

function toEntryMap(value) {
  if (value instanceof Map) {
    return value;
  }

  return new Map(Object.entries(value ?? {}));
}

function buildTree(rawEntries) {
  const entriesMap = toEntryMap(rawEntries);
  const nodesByPath = new Map();
  const roots = [];

  entriesMap.forEach((entry) => {
    const node = createNode(entry);
    if (node) {
      nodesByPath.set(entry.path, node);
    }
  });

  Array.from(nodesByPath.entries()).forEach(([pathValue, node]) => {
    const entry = entriesMap.get(pathValue);
    const parentPath = entry?.parentPath || '';
    if (!parentPath) {
      roots.push(node);
      return;
    }

    const parent = nodesByPath.get(parentPath);
    if (parent?.type === 'directory') {
      parent.children.push(node);
      return;
    }

    roots.push(node);
  });

  return sortNodes(roots);
}

export class WorkspaceSyncClient {
  constructor({
    onTreeChange = () => {},
    onWorkspaceEvent = () => {},
  } = {}) {
    this.onTreeChange = onTreeChange;
    this.onWorkspaceEvent = onWorkspaceEvent;
    this.ydoc = new Y.Doc();
    this.entries = this.ydoc.getMap('entries');
    this.events = this.ydoc.getArray('events');
    this.provider = null;
    this._didInitialSync = false;
    this.seenEventIds = new Set();

    this.handleEntriesChange = () => {
      this.onTreeChange(buildTree(this.entries.toJSON()));
    };
    this.handleEventsChange = () => {
      if (!this._didInitialSync) {
        this.primeEventCache();
        return;
      }

      this.events.toArray().forEach((event) => {
        const normalized = normalizeWorkspaceEvent(event);
        if (!normalized || this.seenEventIds.has(normalized.id)) {
          return;
        }

        this.seenEventIds.add(normalized.id);
        this.onWorkspaceEvent(normalized);
      });
    };
  }

  connect() {
    if (this.provider) {
      return;
    }

    this._didInitialSync = false;
    this.provider = new WebsocketProvider(resolveWsBaseUrl(), WORKSPACE_ROOM_NAME, this.ydoc, {
      disableBc: true,
      maxBackoffTime: 5000,
    });
    stopReconnectOnControlledClose(this.provider);

    this.entries.observeDeep(this.handleEntriesChange);
    this.events.observe(this.handleEventsChange);
    this.provider.on('sync', (isSynced) => {
      if (!isSynced || this._didInitialSync) {
        return;
      }

      this._didInitialSync = true;
      this.primeEventCache();
      this.handleEntriesChange();
    });
  }

  primeEventCache() {
    this.events.toArray().forEach((event) => {
      const normalized = normalizeWorkspaceEvent(event);
      if (normalized) {
        this.seenEventIds.add(normalized.id);
      }
    });
  }

  disconnect() {
    this.entries.unobserveDeep(this.handleEntriesChange);
    this.events.unobserve(this.handleEventsChange);
    this.provider?.disconnect();
    this.provider?.destroy();
    this.provider = null;
    this._didInitialSync = false;
    this.seenEventIds.clear();
  }

  destroy() {
    this.disconnect();
    this.ydoc.destroy();
  }
}
