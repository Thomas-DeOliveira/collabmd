import {
  COMMENT_BODY_MAX_LENGTH,
  normalizeCommentQuoteForComparison,
} from '../../domain/comment-threads.js';

const COMMENT_CARD_OFFSET = 14;
const COMMENT_CARD_WIDTH = 360;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sortThreads(threads = []) {
  return [...threads].sort((left, right) => (
    (left.anchor?.startLine ?? 0) - (right.anchor?.startLine ?? 0)
      || left.createdAt - right.createdAt
  ));
}

function formatAnchorLabel(anchor) {
  if (!anchor) {
    return 'No source anchor';
  }

  if ((anchor.kind || anchor.anchorKind) === 'text' && anchor.quote) {
    return anchor.startLine === anchor.endLine
      ? `Line ${anchor.startLine}`
      : `Lines ${anchor.startLine}-${anchor.endLine}`;
  }

  return anchor.startLine === anchor.endLine
    ? `Line ${anchor.startLine}`
    : `Lines ${anchor.startLine}-${anchor.endLine}`;
}

function getAnchorGroupKey(anchor = {}) {
  return [
    anchor.kind || anchor.anchorKind || 'line',
    anchor.startLine ?? 0,
    anchor.endLine ?? 0,
    anchor.quote || '',
  ].join('::');
}

function isLeafSourceBlock(element) {
  return element && !element.querySelector('[data-source-line]');
}

function parseLineNumber(value) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function overlapsAnchorRange(element, anchor) {
  const startLine = parseLineNumber(element?.getAttribute?.('data-source-line'));
  const endLine = parseLineNumber(element?.getAttribute?.('data-source-line-end')) ?? startLine;
  if (!startLine || !endLine || !anchor) {
    return false;
  }

  return anchor.startLine <= endLine && anchor.endLine >= startLine;
}

function createNormalizedTextIndex(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let normalized = '';
  const map = [];
  let lastWasWhitespace = true;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = node.textContent || '';
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const isWhitespace = /\s/.test(char);
      if (isWhitespace) {
        if (lastWasWhitespace) {
          continue;
        }

        normalized += ' ';
        map.push({ node, offset: index });
        lastWasWhitespace = true;
        continue;
      }

      normalized += char;
      map.push({ node, offset: index });
      lastWasWhitespace = false;
    }
  }

  while (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    map.pop();
  }

  return { map, normalized };
}

function findUniqueQuoteRange(root, quote) {
  const normalizedQuote = normalizeCommentQuoteForComparison(quote);
  if (!root || !normalizedQuote) {
    return null;
  }

  const index = createNormalizedTextIndex(root);
  if (!index.normalized) {
    return null;
  }

  const matchIndex = index.normalized.indexOf(normalizedQuote);
  if (matchIndex < 0) {
    return null;
  }
  if (index.normalized.indexOf(normalizedQuote, matchIndex + 1) >= 0) {
    return null;
  }

  const start = index.map[matchIndex];
  const end = index.map[matchIndex + normalizedQuote.length - 1];
  if (!start || !end) {
    return null;
  }

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

function toRelativeRect(rect, containerRect) {
  return {
    bottom: rect.bottom - containerRect.top,
    height: rect.height,
    left: rect.left - containerRect.left,
    right: rect.right - containerRect.left,
    top: rect.top - containerRect.top,
    width: rect.width,
  };
}

function createRectFromRects(rects = []) {
  if (!Array.isArray(rects) || rects.length === 0) {
    return null;
  }

  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));

  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
  };
}

export class CommentUiController {
  constructor({
    commentSelectionButton,
    commentsDrawer,
    commentsDrawerEmpty,
    commentsDrawerList,
    commentsToggleButton,
    editorContainer,
    onCreateThread,
    onNavigateToLine,
    onReplyToThread,
    onResolveThread,
    previewContainer,
    previewElement,
  }) {
    this.commentSelectionButton = commentSelectionButton;
    this.commentsDrawer = commentsDrawer;
    this.commentsDrawerEmpty = commentsDrawerEmpty;
    this.commentsDrawerList = commentsDrawerList;
    this.commentsToggleButton = commentsToggleButton;
    this.editorContainer = editorContainer;
    this.onCreateThread = onCreateThread;
    this.onNavigateToLine = onNavigateToLine;
    this.onReplyToThread = onReplyToThread;
    this.onResolveThread = onResolveThread;
    this.previewContainer = previewContainer;
    this.previewElement = previewElement;

    this.currentFile = null;
    this.fileKind = 'markdown';
    this.supported = false;
    this.drawerOpen = false;
    this.threads = [];
    this.selectionAnchor = null;
    this.session = null;
    this.activeCard = null;
    this.editorLayer = null;
    this.previewLayer = null;
    this.previewHighlightLayer = null;
    this.cardRoot = null;
    this.layoutFrame = 0;
    this.timeFormatter = new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
    });
    this.handleEditorScroll = () => this.scheduleLayoutRefresh();
    this.handlePreviewScroll = () => this.scheduleLayoutRefresh();
    this.handleWindowResize = () => this.scheduleLayoutRefresh();
    this.handleDocumentPointerDown = (event) => {
      if (!this.activeCard || !this.cardRoot) {
        return;
      }
      if (this.cardRoot.contains(event.target)) {
        return;
      }
      this.closeCard();
    };
    this.handleDocumentKeyDown = (event) => {
      if (event.key === 'Escape' && this.activeCard) {
        this.closeCard();
      }
    };

    this.commentSelectionButton?.addEventListener('click', () => {
      this.openComposerForSelection('toolbar');
    });
    this.commentsToggleButton?.addEventListener('click', () => {
      this.drawerOpen = !this.drawerOpen;
      this.render();
    });
    this.previewContainer?.addEventListener('scroll', this.handlePreviewScroll, { passive: true });
    window.addEventListener('resize', this.handleWindowResize);
    document.addEventListener('pointerdown', this.handleDocumentPointerDown);
    document.addEventListener('keydown', this.handleDocumentKeyDown);
  }

  destroy() {
    if (this.layoutFrame) {
      cancelAnimationFrame(this.layoutFrame);
      this.layoutFrame = 0;
    }
    this.attachSession(null);
    this.previewContainer?.removeEventListener('scroll', this.handlePreviewScroll);
    window.removeEventListener('resize', this.handleWindowResize);
    document.removeEventListener('pointerdown', this.handleDocumentPointerDown);
    document.removeEventListener('keydown', this.handleDocumentKeyDown);
    this.cardRoot?.remove();
    this.editorLayer?.remove();
    this.previewLayer?.remove();
  }

  attachSession(session) {
    this.session?.getScrollContainer?.()?.removeEventListener('scroll', this.handleEditorScroll);
    this.session = session;
    this.selectionAnchor = session?.getCurrentSelectionCommentAnchor?.() ?? null;
    session?.getScrollContainer?.()?.addEventListener('scroll', this.handleEditorScroll, { passive: true });
    this.render();
  }

  setCurrentFile(filePath, { fileKind = 'markdown', supported = false } = {}) {
    const didChangeFile = this.currentFile !== filePath;
    this.currentFile = filePath;
    this.fileKind = fileKind;
    this.supported = Boolean(filePath && supported);
    if (didChangeFile) {
      this.drawerOpen = false;
      this.threads = [];
      this.selectionAnchor = null;
      this.activeCard = null;
    }
    if (!this.supported) {
      this.drawerOpen = false;
      this.activeCard = null;
      this.threads = [];
      this.selectionAnchor = null;
    }
    this.render();
  }

  setSelectionAnchor(anchor) {
    this.selectionAnchor = this.supported ? anchor : null;
    this.renderToolbar();
    this.renderEditorLayer();
  }

  setThreads(threads = []) {
    this.threads = sortThreads(threads);
    if (
      this.activeCard?.mode === 'group'
      && !this.getThreadGroups().some((group) => group.key === this.activeCard.groupKey)
    ) {
      this.activeCard = null;
    }
    this.render();
  }

  refreshLayout() {
    this.renderEditorLayer();
    this.renderPreviewLayer();
    this.repositionActiveCard();
  }

  scheduleLayoutRefresh() {
    if (this.layoutFrame) {
      return;
    }

    this.layoutFrame = requestAnimationFrame(() => {
      this.layoutFrame = 0;
      this.refreshLayout();
    });
  }

  render() {
    this.renderToolbar();
    this.renderDrawer();
    this.renderEditorLayer();
    this.renderPreviewLayer();
    this.renderCard();
  }

  renderToolbar() {
    const totalCount = this.threads.length;
    const showControls = this.supported && Boolean(this.session);
    this.commentSelectionButton?.classList.toggle('hidden', !showControls);
    this.commentsToggleButton?.classList.toggle('hidden', !this.supported);
    if (this.commentSelectionButton) {
      this.commentSelectionButton.disabled = !this.selectionAnchor;
    }
    if (this.commentsToggleButton) {
      this.commentsToggleButton.classList.toggle('active', this.drawerOpen);
      this.commentsToggleButton.setAttribute('aria-expanded', String(this.drawerOpen));
      const label = totalCount > 0 ? `Comments ${totalCount}` : 'Comments';
      const labelElement = this.commentsToggleButton.querySelector('.pane-header-btn-label');
      if (labelElement) {
        labelElement.textContent = label;
      } else {
        this.commentsToggleButton.textContent = label;
      }
    }
  }

  renderDrawer() {
    if (!this.commentsDrawer || !this.commentsDrawerList) {
      return;
    }

    this.commentsDrawer.classList.toggle('hidden', !this.supported || !this.drawerOpen);
    this.commentsDrawerList.replaceChildren();
    const groups = this.getThreadGroups();
    this.commentsDrawerEmpty?.classList.toggle('hidden', groups.length > 0);
    if (!this.supported || groups.length === 0) {
      return;
    }

    const fragment = document.createDocumentFragment();
    groups.forEach((group) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'comments-drawer-item';
      button.classList.toggle('is-active', this.activeCard?.groupKey === group.key);
      button.addEventListener('click', () => {
        this.openThreadGroup(group, {
          anchor: group.anchor,
          origin: 'drawer',
          sourceRect: button.getBoundingClientRect(),
        });
      });

      const header = document.createElement('div');
      header.className = 'comments-drawer-item-header';

      const title = document.createElement('span');
      title.className = 'comments-drawer-item-title';
      title.textContent = formatAnchorLabel(group.anchor);

      const count = document.createElement('span');
      count.className = 'comments-drawer-item-count';
      count.textContent = String(group.threads.length);

      header.append(title, count);

      const quote = document.createElement('p');
      quote.className = 'comments-drawer-item-quote';
      quote.textContent = group.anchor.quote || group.anchor.excerpt || 'Source anchored comment';

      const footer = document.createElement('div');
      footer.className = 'comments-drawer-item-footer';
      footer.textContent = `${group.threads.length} thread${group.threads.length === 1 ? '' : 's'}`;

      button.append(header, quote, footer);
      fragment.appendChild(button);
    });

    this.commentsDrawerList.appendChild(fragment);
  }

  ensureEditorLayer() {
    if (this.editorLayer?.isConnected && this.editorLayer.parentElement === this.editorContainer) {
      return this.editorLayer;
    }

    const layer = document.createElement('div');
    layer.className = 'comment-editor-layer';
    this.editorContainer?.appendChild(layer);
    this.editorLayer = layer;
    return layer;
  }

  renderEditorLayer() {
    const layer = this.ensureEditorLayer();
    layer.replaceChildren();

    if (!this.supported || !this.session) {
      return;
    }

    const containerRect = this.editorContainer?.getBoundingClientRect?.();
    if (!containerRect) {
      return;
    }

    const groups = this.getThreadGroups();
    groups.forEach((group) => {
      const rect = this.session.getCommentAnchorClientRect?.(group.anchor);
      if (!rect) {
        return;
      }

      const relativeRect = toRelativeRect(rect, containerRect);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'comment-editor-badge';
      button.dataset.count = String(group.threads.length);
      button.textContent = group.threads.length > 1 ? String(group.threads.length) : '';
      button.style.top = `${Math.max(relativeRect.top, 8)}px`;
      button.style.left = `${Math.max(containerRect.width - 36, 8)}px`;
      button.title = `${group.threads.length} comment${group.threads.length === 1 ? '' : 's'}`;
      button.addEventListener('click', () => {
        this.openThreadGroup(group, {
          anchor: group.anchor,
          origin: 'editor',
          sourceRect: rect,
        });
      });
      layer.appendChild(button);
    });

    if (!this.selectionAnchor) {
      return;
    }

    const rect = this.session.getCommentAnchorClientRect?.(this.selectionAnchor);
    const chipRect = this.session.getSelectionChipClientRect?.(this.selectionAnchor) ?? rect;
    if (!chipRect) {
      return;
    }

    const relativeRect = toRelativeRect(chipRect, containerRect);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'comment-selection-chip';
    button.textContent = 'Comment';
    button.style.top = `${Math.max(relativeRect.top - 6, 8)}px`;
    button.style.left = `${clamp(relativeRect.right + 12, 56, containerRect.width - 120)}px`;
    button.addEventListener('click', () => {
      this.openComposerForSelection('editor');
    });
    layer.appendChild(button);
  }

  ensurePreviewLayer() {
    if (this.previewLayer?.isConnected && this.previewLayer.parentElement === this.previewElement) {
      return this.previewLayer;
    }

    const highlightLayer = document.createElement('div');
    highlightLayer.className = 'comment-preview-highlights';
    const markerLayer = document.createElement('div');
    markerLayer.className = 'comment-preview-layer';
    this.previewElement?.append(highlightLayer, markerLayer);
    this.previewHighlightLayer = highlightLayer;
    this.previewLayer = markerLayer;
    return markerLayer;
  }

  renderPreviewLayer() {
    this.ensurePreviewLayer();
    this.previewLayer?.replaceChildren();
    this.previewHighlightLayer?.replaceChildren();

    if (!this.supported || !this.previewElement) {
      return;
    }

    const previewRect = this.previewElement.getBoundingClientRect();
    const groups = this.getThreadGroups();
    groups.forEach((group) => {
      const target = this.resolvePreviewTarget(group.anchor);
      if (!target?.bubbleRect) {
        return;
      }

      target.highlightRects?.forEach((rect) => {
        const highlight = document.createElement('div');
        highlight.className = 'comment-preview-highlight';
        highlight.style.left = `${rect.left - previewRect.left}px`;
        highlight.style.top = `${rect.top - previewRect.top}px`;
        highlight.style.width = `${rect.width}px`;
        highlight.style.height = `${rect.height}px`;
        this.previewHighlightLayer?.appendChild(highlight);
      });

      const bubble = document.createElement('button');
      bubble.type = 'button';
      bubble.className = 'comment-preview-badge';
      bubble.textContent = group.threads.length > 1 ? String(group.threads.length) : '';
      bubble.style.left = `${clamp(target.bubbleRect.right - previewRect.left + 6, 6, this.previewElement.clientWidth - 34)}px`;
      bubble.style.top = `${Math.max(target.bubbleRect.top - previewRect.top, 6)}px`;
      bubble.title = `${group.threads.length} comment${group.threads.length === 1 ? '' : 's'}`;
      bubble.addEventListener('click', () => {
        this.openThreadGroup(group, {
          anchor: group.anchor,
          origin: 'preview',
          sourceRect: target.bubbleRect,
        });
      });
      this.previewLayer?.appendChild(bubble);
    });
  }

  resolvePreviewTarget(anchor) {
    if (!this.previewElement || !anchor) {
      return null;
    }

    const diagramShell = Array.from(this.previewElement.querySelectorAll('.mermaid-shell, .plantuml-shell'))
      .find((element) => overlapsAnchorRange(element, anchor));
    if (diagramShell) {
      return {
        bubbleRect: diagramShell.getBoundingClientRect(),
        highlightRects: [],
      };
    }

    const candidates = Array.from(this.previewElement.querySelectorAll('[data-source-line]'))
      .filter((element) => isLeafSourceBlock(element) && overlapsAnchorRange(element, anchor));

    if (anchor.kind === 'text' && anchor.quote) {
      const matches = candidates
        .map((element) => ({ element, range: findUniqueQuoteRange(element, anchor.quote) }))
        .filter((candidate) => candidate.range);
      if (matches.length === 1) {
        const rects = Array.from(matches[0].range.getClientRects());
        const bubbleRect = createRectFromRects(rects) || matches[0].element.getBoundingClientRect();
        return {
          bubbleRect,
          highlightRects: rects,
        };
      }
    }

    const fallback = candidates[0];
    if (!fallback) {
      return null;
    }

    return {
      bubbleRect: fallback.getBoundingClientRect(),
      highlightRects: [],
    };
  }

  ensureCardRoot() {
    if (this.cardRoot?.isConnected && this.cardRoot.parentElement === document.body) {
      return this.cardRoot;
    }

    const root = document.createElement('div');
    root.className = 'comment-card-root hidden';
    document.body.appendChild(root);
    this.cardRoot = root;
    return root;
  }

  openComposerForSelection(origin = 'editor') {
    const anchor = this.session?.getCurrentSelectionCommentAnchor?.();
    if (!anchor) {
      return;
    }

    this.selectionAnchor = anchor;
    const sourceRect = origin === 'toolbar'
      ? this.commentSelectionButton?.getBoundingClientRect?.()
      : this.session?.getCommentAnchorClientRect?.(anchor);
    this.activeCard = {
      anchor,
      mode: 'create',
      origin,
      replyThreadId: null,
      sourceRect,
    };
    this.render();
  }

  openThreadGroup(group, { anchor, origin, sourceRect }) {
    this.activeCard = {
      anchor,
      groupKey: group.key,
      mode: 'group',
      origin,
      replyThreadId: null,
      sourceRect,
    };
    this.render();
  }

  closeCard() {
    this.activeCard = null;
    this.renderCard();
  }

  getThreadGroups() {
    const groups = new Map();
    this.threads.forEach((thread) => {
      const key = getAnchorGroupKey(thread.anchor);
      const existing = groups.get(key);
      if (existing) {
        existing.threads.push(thread);
        return;
      }

      groups.set(key, {
        anchor: thread.anchor,
        key,
        threads: [thread],
      });
    });

    return Array.from(groups.values()).sort((left, right) => (
      (left.anchor?.startLine ?? 0) - (right.anchor?.startLine ?? 0)
    ));
  }

  updateCardSourceRect() {
    if (!this.activeCard) {
      return null;
    }

    if (this.activeCard.origin === 'editor') {
      return this.session?.getCommentAnchorClientRect?.(this.activeCard.anchor) ?? this.activeCard.sourceRect;
    }
    if (this.activeCard.origin === 'preview') {
      return this.resolvePreviewTarget(this.activeCard.anchor)?.bubbleRect ?? this.activeCard.sourceRect;
    }
    if (this.activeCard.origin === 'toolbar') {
      return this.commentSelectionButton?.getBoundingClientRect?.() ?? this.activeCard.sourceRect;
    }

    return this.activeCard.sourceRect;
  }

  renderCard() {
    const root = this.ensureCardRoot();
    root.replaceChildren();
    root.classList.toggle('hidden', !this.activeCard);
    if (!this.activeCard) {
      return;
    }

    const card = document.createElement('section');
    card.className = 'comment-card';

    const header = document.createElement('div');
    header.className = 'comment-card-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'comment-card-title-wrap';

    const title = document.createElement('h3');
    title.className = 'comment-card-title';
    title.textContent = this.activeCard.mode === 'create' ? 'New comment' : 'Comment threads';

    const meta = document.createElement('p');
    meta.className = 'comment-card-meta';
    meta.textContent = formatAnchorLabel(this.activeCard.anchor);

    titleWrap.append(title, meta);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'comment-card-close';
    closeButton.setAttribute('aria-label', 'Close comments');
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', () => this.closeCard());

    header.append(titleWrap, closeButton);
    card.appendChild(header);

    if (this.activeCard.anchor?.quote) {
      const quote = document.createElement('p');
      quote.className = 'comment-card-quote';
      quote.textContent = this.activeCard.anchor.quote;
      card.appendChild(quote);
    }

    if (this.activeCard.mode === 'create') {
      card.appendChild(this.createComposer());
    } else {
      const group = this.getThreadGroups().find((entry) => entry.key === this.activeCard.groupKey);
      if (!group) {
        this.closeCard();
        return;
      }

      group.threads.forEach((thread) => {
        card.appendChild(this.createThreadElement(thread));
      });
    }

    root.appendChild(card);
    this.positionCard(card);
  }

  repositionActiveCard() {
    const card = this.cardRoot?.firstElementChild;
    if (!card || !this.activeCard) {
      return;
    }

    this.positionCard(card);
  }

  createComposer() {
    const form = document.createElement('form');
    form.className = 'comment-card-form';

    const textarea = document.createElement('textarea');
    textarea.className = 'input comment-card-input';
    textarea.rows = 4;
    textarea.maxLength = COMMENT_BODY_MAX_LENGTH;
    textarea.placeholder = 'Add context, feedback, or a question...';

    const actions = document.createElement('div');
    actions.className = 'comment-card-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.closeCard());

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn btn-primary';
    submit.textContent = 'Post comment';

    actions.append(cancel, submit);
    form.append(textarea, actions);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const threadId = await this.onCreateThread?.({
        anchor: this.activeCard?.anchor,
        body: textarea.value,
      });
      if (!threadId) {
        textarea.focus();
        return;
      }

      this.closeCard();
    });

    requestAnimationFrame(() => textarea.focus());
    return form;
  }

  createThreadElement(thread) {
    const article = document.createElement('article');
    article.className = 'comment-thread-card';

    const header = document.createElement('div');
    header.className = 'comment-thread-card-header';

    const author = document.createElement('span');
    author.className = 'comment-thread-card-author';
    author.textContent = thread.createdByName;

    const time = document.createElement('span');
    time.className = 'comment-thread-card-time';
    time.textContent = this.formatTimestamp(thread.createdAt);

    const actions = document.createElement('div');
    actions.className = 'comment-thread-card-actions';

    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'comment-thread-card-action';
    jump.textContent = 'Jump';
    jump.addEventListener('click', () => this.onNavigateToLine?.(thread.anchor?.startLine ?? 1));

    const reply = document.createElement('button');
    reply.type = 'button';
    reply.className = 'comment-thread-card-action';
    reply.textContent = this.activeCard?.replyThreadId === thread.id ? 'Cancel reply' : 'Reply';
    reply.addEventListener('click', () => {
      this.activeCard = {
        ...this.activeCard,
        replyThreadId: this.activeCard?.replyThreadId === thread.id ? null : thread.id,
      };
      this.renderCard();
    });

    const resolve = document.createElement('button');
    resolve.type = 'button';
    resolve.className = 'comment-thread-card-action is-danger';
    resolve.textContent = 'Resolve';
    resolve.addEventListener('click', async () => {
      await this.onResolveThread?.(thread.id);
    });

    actions.append(jump, reply, resolve);
    header.append(author, time, actions);

    article.append(header);

    thread.messages.forEach((message) => {
      article.appendChild(this.createMessageElement(message));
    });

    if (this.activeCard?.replyThreadId === thread.id) {
      article.appendChild(this.createReplyComposer(thread));
    }

    return article;
  }

  createMessageElement(message) {
    const container = document.createElement('div');
    container.className = 'comment-message-card';

    const meta = document.createElement('div');
    meta.className = 'comment-message-card-meta';

    const author = document.createElement('span');
    author.className = 'comment-message-card-author';
    author.textContent = message.userName;

    const time = document.createElement('span');
    time.className = 'comment-message-card-time';
    time.textContent = this.formatTimestamp(message.createdAt);

    const body = document.createElement('p');
    body.className = 'comment-message-card-body';
    body.textContent = message.body;

    meta.append(author, time);
    container.append(meta, body);
    return container;
  }

  createReplyComposer(thread) {
    const form = document.createElement('form');
    form.className = 'comment-reply-form';

    const textarea = document.createElement('textarea');
    textarea.className = 'input comment-card-input';
    textarea.rows = 3;
    textarea.maxLength = COMMENT_BODY_MAX_LENGTH;
    textarea.placeholder = 'Reply to thread...';

    const actions = document.createElement('div');
    actions.className = 'comment-card-actions';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      this.activeCard = {
        ...this.activeCard,
        replyThreadId: null,
      };
      this.renderCard();
    });

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn btn-primary';
    submit.textContent = 'Reply';

    actions.append(cancel, submit);
    form.append(textarea, actions);
    requestAnimationFrame(() => textarea.focus());

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const messageId = await this.onReplyToThread?.(thread.id, textarea.value);
      if (!messageId) {
        textarea.focus();
        return;
      }

      this.activeCard = {
        ...this.activeCard,
        replyThreadId: null,
      };
      this.renderCard();
    });

    return form;
  }

  positionCard(card) {
    const sourceRect = this.updateCardSourceRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const cardRect = card.getBoundingClientRect();
    const fallbackLeft = clamp((viewportWidth - cardRect.width) / 2, 16, viewportWidth - cardRect.width - 16);
    const fallbackTop = clamp((viewportHeight - cardRect.height) / 4, 16, viewportHeight - cardRect.height - 16);

    let left = fallbackLeft;
    let top = fallbackTop;

    if (sourceRect) {
      left = clamp(
        sourceRect.left,
        16,
        viewportWidth - Math.min(cardRect.width, COMMENT_CARD_WIDTH) - 16,
      );
      top = sourceRect.bottom + COMMENT_CARD_OFFSET;
      if (top + cardRect.height > viewportHeight - 16) {
        top = Math.max(sourceRect.top - cardRect.height - COMMENT_CARD_OFFSET, 16);
      }
    }

    this.cardRoot.style.left = `${left}px`;
    this.cardRoot.style.top = `${top}px`;
    this.cardRoot.style.width = `${Math.min(Math.max(cardRect.width, COMMENT_CARD_WIDTH), viewportWidth - 32)}px`;
  }

  formatTimestamp(value) {
    if (!Number.isFinite(value)) {
      return '';
    }

    try {
      return this.timeFormatter.format(new Date(value));
    } catch {
      return '';
    }
  }
}
