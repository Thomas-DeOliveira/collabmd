import * as Y from 'yjs';

import {
  createCommentId,
  createCommentThreadSharedType,
  normalizeCommentBody,
  serializeCommentThreads,
  summarizeCommentExcerpt,
} from '../../domain/comment-threads.js';

function createCommentMessage({ body, user }) {
  return {
    body,
    createdAt: Date.now(),
    id: createCommentId('comment'),
    peerId: user?.peerId ?? '',
    userColor: user?.color ?? '',
    userName: user?.name ?? 'Anonymous',
  };
}

export class CommentThreadStore {
  constructor({
    getDoc,
    getEditorState,
    getLocalUser,
    onCommentsChange = null,
  }) {
    this.getDoc = getDoc;
    this.getEditorState = getEditorState;
    this.getLocalUser = getLocalUser;
    this.onCommentsChange = onCommentsChange;
    this.commentThreads = null;
    this.ydoc = null;
    this.ytext = null;
    this.handleCommentThreadsChange = null;
  }

  bind({ commentThreads, ydoc, ytext }) {
    this.unbind();
    this.commentThreads = commentThreads;
    this.ydoc = ydoc;
    this.ytext = ytext;
    this.handleCommentThreadsChange = () => {
      this.onCommentsChange?.(this.getCommentThreads());
    };
    this.commentThreads.observeDeep(this.handleCommentThreadsChange);
    this.onCommentsChange?.(this.getCommentThreads());
  }

  unbind() {
    if (this.commentThreads && this.handleCommentThreadsChange) {
      this.commentThreads.unobserveDeep(this.handleCommentThreadsChange);
    }

    this.commentThreads = null;
    this.ydoc = null;
    this.ytext = null;
    this.handleCommentThreadsChange = null;
  }

  getCommentThreads() {
    if (!this.commentThreads) {
      return [];
    }

    return serializeCommentThreads(this.commentThreads)
      .map((thread) => this.resolveCommentThread(thread))
      .filter(Boolean);
  }

  createCommentThread({ body, endLine, startLine }) {
    const state = this.getEditorState();
    if (!state || !this.commentThreads || !this.ytext || !this.ydoc) {
      return null;
    }

    const normalizedBody = normalizeCommentBody(body);
    if (!normalizedBody) {
      return null;
    }

    const range = this.normalizeLineRange({ endLine, startLine });
    const start = state.doc.line(range.startLine);
    const end = state.doc.line(range.endLine);
    const excerpt = summarizeCommentExcerpt(state.doc.sliceString(start.from, end.to));
    const thread = createCommentThreadSharedType({
      anchorEnd: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(this.ytext, end.to)),
      anchorEndLine: range.endLine,
      anchorExcerpt: excerpt,
      anchorStart: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(this.ytext, start.from)),
      anchorStartLine: range.startLine,
      createdAt: Date.now(),
      createdByColor: this.getLocalUser()?.color ?? '',
      createdByName: this.getLocalUser()?.name ?? 'Anonymous',
      createdByPeerId: this.getLocalUser()?.peerId ?? '',
      id: createCommentId('thread'),
      messages: [createCommentMessage({
        body: normalizedBody,
        user: this.getLocalUser(),
      })],
    });

    if (!thread) {
      return null;
    }

    this.ydoc.transact(() => {
      this.commentThreads.push([thread]);
    }, 'comment-thread-create');

    return thread.get('id');
  }

  replyToCommentThread(threadId, body) {
    const normalizedBody = normalizeCommentBody(body);
    if (!normalizedBody) {
      return null;
    }

    const thread = this.findSharedCommentThread(threadId);
    const messages = thread?.get('messages');
    if (!(messages instanceof Y.Array)) {
      return null;
    }

    const message = createCommentMessage({
      body: normalizedBody,
      user: this.getLocalUser(),
    });

    this.ydoc.transact(() => {
      messages.push([message]);
    }, 'comment-thread-reply');

    return message.id;
  }

  deleteCommentThread(threadId) {
    if (!this.commentThreads) {
      return false;
    }

    const threadIndex = this.findSharedCommentThreadIndex(threadId);
    if (threadIndex < 0) {
      return false;
    }

    this.ydoc.transact(() => {
      this.commentThreads.delete(threadIndex, 1);
    }, 'comment-thread-resolve');

    return true;
  }

  findSharedCommentThread(threadId) {
    if (!this.commentThreads) {
      return null;
    }

    return this.commentThreads.toArray().find((thread) => (
      thread instanceof Y.Map && thread.get('id') === threadId
    )) ?? null;
  }

  findSharedCommentThreadIndex(threadId) {
    if (!this.commentThreads) {
      return -1;
    }

    return this.commentThreads.toArray().findIndex((thread) => (
      thread instanceof Y.Map && thread.get('id') === threadId
    ));
  }

  normalizeLineRange({ endLine, startLine }) {
    const state = this.getEditorState();
    if (!state) {
      return { endLine: 1, startLine: 1 };
    }

    const lineCount = state.doc.lines;
    const normalizedStart = Math.min(Math.max(Math.round(startLine ?? 1), 1), lineCount);
    const normalizedEnd = Math.min(Math.max(Math.round(endLine ?? normalizedStart), normalizedStart), lineCount);

    return {
      endLine: normalizedEnd,
      startLine: normalizedStart,
    };
  }

  resolveCommentThread(thread) {
    const state = this.getEditorState();
    if (!thread || !state || !this.ydoc) {
      return null;
    }

    const anchorStart = this.resolveCommentPosition(thread.anchorStart);
    const anchorEnd = this.resolveCommentPosition(thread.anchorEnd);
    const startIndex = anchorStart?.index ?? state.doc.line(
      Math.min(Math.max(thread.anchorStartLine ?? 1, 1), state.doc.lines),
    ).from;
    const endIndex = anchorEnd?.index ?? state.doc.line(
      Math.min(Math.max(thread.anchorEndLine ?? thread.anchorStartLine ?? 1, 1), state.doc.lines),
    ).to;
    const startLine = state.doc.lineAt(startIndex).number;
    const endLine = state.doc.lineAt(Math.min(Math.max(endIndex, startIndex), state.doc.length)).number;
    const excerpt = summarizeCommentExcerpt(
      state.doc.sliceString(startIndex, Math.max(endIndex, startIndex)),
    ) || thread.anchorExcerpt;

    return {
      ...thread,
      anchor: {
        endIndex,
        endLine,
        excerpt: excerpt || thread.anchorExcerpt || '',
        startIndex,
        startLine,
      },
    };
  }

  resolveCommentPosition(positionJson) {
    if (!positionJson || !this.ydoc || !this.ytext) {
      return null;
    }

    try {
      const position = Y.createRelativePositionFromJSON(positionJson);
      const absolute = Y.createAbsolutePositionFromRelativePosition(position, this.ydoc);
      if (!absolute || absolute.type !== this.ytext) {
        return null;
      }

      return absolute;
    } catch {
      return null;
    }
  }
}
