import { clamp } from '../domain/vault-utils.js';
import { resolveApiUrl } from '../domain/runtime-paths.js';
import {
  cancelIdleRender,
  createMermaidPlaceholderCard,
  createMermaidPlaceholderCardWithMessage,
  easeOutCubic,
  getFrameViewportSize,
  IDLE_RENDER_TIMEOUT_MS,
  isNearViewport,
  MERMAID_BATCH_SIZE,
  MERMAID_ZOOM,
  normalizeMermaidSvg,
  requestIdleRender,
  shouldPreserveHydratedDiagram,
  syncAttribute,
} from './preview-diagram-utils.js';

export class MermaidPreviewHydrator {
  constructor(renderer) {
    this.renderer = renderer;
    this.currentTheme = document.documentElement?.dataset.theme === 'light' ? 'light' : 'dark';
    this.loader = null;
    this.runtime = null;
    this.observer = null;
    this.idleId = null;
    this.pendingShells = [];
    this.hydrationInProgress = false;
    this.instanceCounter = 0;
    this.preservedShells = new Map();
    this.fileInflightRequests = new Map();
  }

  applyTheme(theme) {
    this.currentTheme = theme;
    const mermaid = this.runtime;
    if (!mermaid) {
      return;
    }

    this.configureMermaid(mermaid);
    this.resetHydratedShells();
  }

  configureMermaid(mermaid) {
    mermaid.initialize({
      startOnLoad: false,
      theme: this.currentTheme === 'dark' ? 'dark' : 'default',
      themeVariables: this.currentTheme === 'dark' ? {
        background: '#161822',
        clusterBkg: '#1a1c28',
        edgeLabelBackground: '#161822',
        lineColor: '#8b8ba0',
        mainBkg: '#1c1e2c',
        nodeBorder: '#383a50',
        primaryBorderColor: '#383a50',
        primaryColor: '#818cf8',
        primaryTextColor: '#e2e2ea',
        secondaryColor: '#1c1e2c',
        tertiaryColor: '#161822',
        titleColor: '#e2e2ea',
      } : {},
    });
  }

  ensureMermaid() {
    if (this.runtime) {
      this.configureMermaid(this.runtime);
      return Promise.resolve(this.runtime);
    }

    if (this.loader) {
      return this.loader;
    }

    this.loader = import('../mermaid-runtime.js')
      .then((module) => {
        const mermaid = module?.default;
        if (!mermaid) {
          throw new Error('Mermaid runtime failed to initialize');
        }

        this.runtime = mermaid;
        this.configureMermaid(mermaid);
        return mermaid;
      })
      .catch((error) => {
        this.loader = null;
        this.runtime = null;
        throw new Error(error instanceof Error ? error.message : 'Failed to load Mermaid runtime');
      });

    return this.loader;
  }

  destroy() {
    this.cancelHydration();
    this.preservedShells.clear();
  }

  cancelHydration() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    cancelIdleRender(this.idleId);
    this.idleId = null;
    this.pendingShells = [];
    this.hydrationInProgress = false;
  }

  cancelPendingIdleWork() {
    cancelIdleRender(this.idleId);
    this.idleId = null;
  }

  clearPreservedShells() {
    this.preservedShells.clear();
  }

  hasPendingWork() {
    return this.hydrationInProgress || this.pendingShells.length > 0;
  }

  preserveHydratedShellsForCommit() {
    this.preservedShells.clear();
    const previewElement = this.renderer.previewElement;
    if (!previewElement) {
      return;
    }

    Array.from(previewElement.querySelectorAll('.mermaid-shell[data-mermaid-hydrated="true"][data-mermaid-key]')).forEach((shell) => {
      const key = shell.dataset.mermaidKey;
      const source = shell.querySelector('.mermaid-source')?.textContent ?? '';
      const target = shell.dataset.mermaidTarget ?? '';
      if (!key || (!source && !target)) {
        return;
      }

      if (shell.isConnected) {
        shell.remove();
      }

      this.preservedShells.set(key, {
        key,
        shell,
        source,
        target,
      });
    });
  }

  reconcileHydratedShells() {
    const previewElement = this.renderer.previewElement;
    if (!previewElement || this.preservedShells.size === 0) {
      this.preservedShells.clear();
      return;
    }

    let restoredMaximizedShell = false;
    Array.from(previewElement.querySelectorAll('.mermaid-shell[data-mermaid-key]')).forEach((nextShell) => {
      const key = nextShell.dataset.mermaidKey;
      const preservedEntry = key ? this.preservedShells.get(key) : null;
      if (!preservedEntry) {
        return;
      }

      const nextSource = nextShell.querySelector('.mermaid-source')?.textContent ?? '';
      const nextTarget = nextShell.dataset.mermaidTarget ?? '';
      if (!shouldPreserveHydratedDiagram({
        nextSource,
        nextTarget,
        preservedSource: preservedEntry.source,
        preservedTarget: preservedEntry.target,
      })) {
        return;
      }

      this.syncPreservedShell(preservedEntry.shell, nextShell);
      nextShell.replaceWith(preservedEntry.shell);
      restoredMaximizedShell = restoredMaximizedShell || preservedEntry.shell.classList.contains('is-maximized');
      this.preservedShells.delete(key);
    });

    this.preservedShells.clear();
    if (restoredMaximizedShell) {
      document.body.classList.add('mermaid-maximized-open');
    }
  }

  syncPreservedShell(preservedShell, nextShell) {
    syncAttribute(preservedShell, nextShell, 'data-source-line');
    syncAttribute(preservedShell, nextShell, 'data-source-line-end');
    syncAttribute(preservedShell, nextShell, 'data-mermaid-key');
    syncAttribute(preservedShell, nextShell, 'data-mermaid-target');
    syncAttribute(preservedShell, nextShell, 'data-mermaid-label');
    syncAttribute(preservedShell, nextShell, 'data-mermaid-source-hash');

    preservedShell.classList.add('mermaid-shell');
    preservedShell.dataset.mermaidHydrated = 'true';
    preservedShell.removeAttribute('data-mermaid-queued');

    const nextSourceNode = nextShell.querySelector('.mermaid-source');
    let preservedSourceNode = preservedShell.querySelector('.mermaid-source');

    if (!preservedSourceNode && nextSourceNode) {
      preservedSourceNode = nextSourceNode.cloneNode(true);
      preservedShell.prepend(preservedSourceNode);
    }

    if (preservedSourceNode && nextSourceNode) {
      const nextSource = nextSourceNode.textContent ?? '';
      if (nextSource || !nextShell.dataset.mermaidTarget) {
        preservedSourceNode.textContent = nextSource;
      }
      preservedSourceNode.hidden = true;
    }
  }

  setupHydration(renderVersion) {
    const previewElement = this.renderer.previewElement;
    const previewContainer = this.renderer.previewContainer;
    const shells = Array.from(previewElement.querySelectorAll('.mermaid-shell'));
    if (shells.length === 0) {
      return 0;
    }

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        this.enqueueShell(entry.target);
      });
    }, {
      root: previewContainer,
      rootMargin: this.renderer.isLargeDocument ? '180px 0px' : '420px 0px',
    });

    shells.forEach((shell) => this.observer.observe(shell));

    requestAnimationFrame(() => {
      if (renderVersion !== this.renderer.activeRenderVersion) {
        return;
      }

      this.hydrateVisibleShells();
      this.renderer.updateHydrationPhase();
    });

    return shells.length;
  }

  hydrateVisibleShells() {
    const previewElement = this.renderer.previewElement;
    const previewContainer = this.renderer.previewContainer;
    if (this.renderer.hydrationPaused || !previewElement || !previewContainer) {
      return;
    }

    const margin = this.renderer.isLargeDocument ? 180 : 420;
    Array.from(previewElement.querySelectorAll('.mermaid-shell')).forEach((shell) => {
      if (isNearViewport(shell, previewContainer, margin)) {
        this.enqueueShell(shell, { prioritize: true });
      }
    });
  }

  enqueueShell(shell, { prioritize = false } = {}) {
    if (!shell?.isConnected || shell.dataset.mermaidHydrated === 'true' || shell.dataset.mermaidQueued === 'true') {
      return;
    }

    shell.dataset.mermaidQueued = 'true';
    if (prioritize) {
      this.pendingShells.unshift(shell);
    } else {
      this.pendingShells.push(shell);
    }

    if (this.renderer.hydrationPaused) {
      return;
    }

    this.renderer.updateHydrationPhase();
    this.scheduleHydration();
  }

  scheduleHydration() {
    if (this.renderer.hydrationPaused || this.hydrationInProgress || this.idleId !== null) {
      return;
    }

    this.idleId = requestIdleRender(() => {
      this.idleId = null;
      void this.flushHydrationQueue();
    }, IDLE_RENDER_TIMEOUT_MS);
  }

  async flushHydrationQueue() {
    if (this.renderer.hydrationPaused || this.hydrationInProgress) {
      return;
    }

    const shells = [];
    while (this.pendingShells.length > 0 && shells.length < MERMAID_BATCH_SIZE) {
      const nextShell = this.pendingShells.shift();
      if (!nextShell?.isConnected || nextShell.dataset.mermaidHydrated === 'true') {
        continue;
      }

      nextShell.removeAttribute('data-mermaid-queued');
      shells.push(nextShell);
    }

    if (shells.length === 0) {
      this.renderer.updateHydrationPhase();
      return;
    }

    this.hydrationInProgress = true;
    this.renderer.setPhase('hydrating');

    let mermaid = null;
    try {
      mermaid = await this.ensureMermaid();
    } catch (error) {
      console.warn('[preview] Mermaid runtime failed to load:', error);
      shells.forEach((shell) => {
        shell.removeAttribute('data-mermaid-queued');
      });
      this.hydrationInProgress = false;
      this.renderer.updateHydrationPhase();
      return;
    }

    for (const shell of shells) {
      await this.hydrateShell(shell, mermaid);
    }

    this.hydrationInProgress = false;

    if (this.pendingShells.length > 0) {
      this.scheduleHydration();
    }

    this.renderer.updateHydrationPhase();
  }

  async hydrateShell(shell, mermaid) {
    if (!mermaid || !shell?.isConnected || shell.dataset.mermaidHydrated === 'true') {
      return;
    }

    let sourceNode = shell.querySelector('.mermaid-source');
    if (!sourceNode) {
      sourceNode = document.createElement('span');
      sourceNode.className = 'mermaid-source';
      sourceNode.hidden = true;
      shell.appendChild(sourceNode);
    }

    let source = sourceNode.textContent ?? '';
    try {
      if (!source.trim() && shell.dataset.mermaidTarget) {
        source = await this.fetchSource(shell.dataset.mermaidTarget);
        if (!shell.isConnected) {
          return;
        }
        sourceNode.textContent = source;
      }

      if (!source.trim()) {
        throw new Error(shell.dataset.mermaidTarget ? 'Mermaid file is empty' : 'Mermaid source is empty');
      }

      shell.querySelector('.mermaid-placeholder-card')?.remove();

      const diagram = document.createElement('div');
      diagram.className = 'mermaid mermaid-render-node';
      diagram.id = shell.dataset.mermaidKey || `mermaid-${Date.now()}`;
      const sourceLine = shell.getAttribute('data-source-line');
      const sourceLineEnd = shell.getAttribute('data-source-line-end');
      if (sourceLine) {
        diagram.setAttribute('data-source-line', sourceLine);
      }
      if (sourceLineEnd) {
        diagram.setAttribute('data-source-line-end', sourceLineEnd);
      }
      diagram.textContent = source;
      shell.appendChild(diagram);

      await mermaid.run({ nodes: [diagram] });
      if (!diagram.isConnected || shell !== diagram.parentElement) {
        return;
      }

      this.enhanceDiagram(shell, diagram);
      shell.dataset.mermaidHydrated = 'true';
      shell.dataset.mermaidInstanceId = String(++this.instanceCounter);
    } catch (error) {
      console.warn('[preview] Mermaid render failed:', error);
      shell.querySelector(':scope > .mermaid-toolbar')?.remove();
      shell.querySelector(':scope > .mermaid-frame')?.remove();
      shell.querySelector(':scope > .mermaid-render-node')?.remove();
      if (!shell.querySelector('.mermaid-placeholder-card')) {
        sourceNode?.after(createMermaidPlaceholderCardWithMessage(shell.dataset.mermaidKey || 'mermaid', {
          label: shell.dataset.mermaidLabel || 'Mermaid diagram',
          message: error instanceof Error ? error.message : 'Render failed',
        }));
      }
    }
  }

  resetHydratedShells() {
    const previewElement = this.renderer.previewElement;
    if (!previewElement) {
      return;
    }

    const hydratedShells = Array.from(previewElement.querySelectorAll('.mermaid-shell[data-mermaid-hydrated="true"]'));
    if (hydratedShells.length === 0) {
      return;
    }

    hydratedShells.forEach((shell) => {
      shell.removeAttribute('data-mermaid-hydrated');
      shell.querySelector(':scope > .mermaid-toolbar')?.remove();
      shell.querySelector(':scope > .mermaid-frame')?.remove();
      shell.querySelector(':scope > .mermaid-render-node')?.remove();
      if (!shell.querySelector('.mermaid-placeholder-card')) {
        shell.querySelector('.mermaid-source')?.after(createMermaidPlaceholderCard(shell.dataset.mermaidKey || 'mermaid'));
      }
      this.enqueueShell(shell, { prioritize: true });
    });
  }

  async fetchSource(filePath) {
    const target = String(filePath ?? '').trim();
    if (!target) {
      throw new Error('Missing Mermaid file path');
    }

    if (this.fileInflightRequests.has(target)) {
      return this.fileInflightRequests.get(target);
    }

    const request = fetch(resolveApiUrl(`/file?path=${encodeURIComponent(target)}`), {
      headers: {
        Accept: 'application/json',
      },
    })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || typeof data?.content !== 'string') {
          throw new Error(data?.error || `Failed to load ${target}`);
        }

        return data.content;
      })
      .finally(() => {
        this.fileInflightRequests.delete(target);
      });

    this.fileInflightRequests.set(target, request);
    return request;
  }

  enhanceDiagram(shell, renderedDiagram) {
    const svg = renderedDiagram.querySelector('svg');
    if (!svg) {
      renderedDiagram.remove();
      return;
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'mermaid-toolbar';

    const decreaseButton = this.createZoomButton('−', 'Zoom out');
    const increaseButton = this.createZoomButton('+', 'Zoom in');
    const resetButton = this.createZoomButton('Reset', 'Reset zoom');
    const maximizeButton = this.createZoomButton('Max', 'Maximize diagram');
    maximizeButton.classList.add('mermaid-maximize-btn');
    const zoomLabel = document.createElement('span');
    zoomLabel.className = 'mermaid-zoom-label';
    zoomLabel.setAttribute('aria-live', 'polite');

    toolbar.append(decreaseButton, zoomLabel, resetButton, increaseButton, maximizeButton);

    const frame = document.createElement('div');
    frame.className = 'mermaid-frame';

    const { width: baseWidth, height: baseHeight } = normalizeMermaidSvg(svg);
    let currentZoom = MERMAID_ZOOM.default;
    let defaultZoom = 1;
    let zoomAnimationFrameId = null;
    let isPanning = false;
    let activePointerId = null;
    let panStartX = 0;
    let panStartY = 0;
    let panStartScrollLeft = 0;
    let panStartScrollTop = 0;

    svg.style.display = 'block';
    svg.style.margin = '0 auto';
    svg.style.maxWidth = 'none';

    const applyZoom = (nextZoom) => {
      currentZoom = clamp(nextZoom, MERMAID_ZOOM.min, MERMAID_ZOOM.max);

      svg.style.width = `${baseWidth * currentZoom}px`;
      svg.style.height = `${baseHeight * currentZoom}px`;
      zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;

      decreaseButton.disabled = currentZoom <= MERMAID_ZOOM.min;
      increaseButton.disabled = currentZoom >= MERMAID_ZOOM.max;

      const viewport = getFrameViewportSize(frame);
      const isPannable = (baseWidth * currentZoom) > viewport.width || (baseHeight * currentZoom) > viewport.height;
      frame.classList.toggle('is-pannable', isPannable);
    };

    const getViewportCenter = () => ({
      x: frame.scrollLeft + (frame.clientWidth / 2),
      y: frame.scrollTop + (frame.clientHeight / 2),
    });

    const restoreViewportCenter = (previousZoom, nextZoom, center) => {
      if (previousZoom === 0) {
        return;
      }

      const scale = nextZoom / previousZoom;
      frame.scrollLeft = (center.x * scale) - (frame.clientWidth / 2);
      frame.scrollTop = (center.y * scale) - (frame.clientHeight / 2);
    };

    const animateZoomTo = (nextZoom) => {
      const targetZoom = clamp(nextZoom, MERMAID_ZOOM.min, MERMAID_ZOOM.max);
      const startZoom = currentZoom;

      if (targetZoom === startZoom) {
        return;
      }

      const center = getViewportCenter();
      const startedAt = performance.now();

      if (zoomAnimationFrameId) {
        cancelAnimationFrame(zoomAnimationFrameId);
      }

      const tick = (now) => {
        const progress = clamp((now - startedAt) / MERMAID_ZOOM.animationDurationMs, 0, 1);
        const easedProgress = easeOutCubic(progress);
        const animatedZoom = startZoom + ((targetZoom - startZoom) * easedProgress);

        applyZoom(animatedZoom);
        restoreViewportCenter(startZoom, animatedZoom, center);

        if (progress < 1) {
          zoomAnimationFrameId = requestAnimationFrame(tick);
          return;
        }

        zoomAnimationFrameId = null;
        applyZoom(targetZoom);
        restoreViewportCenter(startZoom, targetZoom, center);
      };

      zoomAnimationFrameId = requestAnimationFrame(tick);
    };

    const zoomBy = (delta) => {
      animateZoomTo(currentZoom + delta);
    };

    decreaseButton.addEventListener('click', () => zoomBy(-MERMAID_ZOOM.step));
    increaseButton.addEventListener('click', () => zoomBy(MERMAID_ZOOM.step));
    resetButton.addEventListener('click', () => animateZoomTo(defaultZoom));

    const syncMaximizeButtonState = () => {
      const isMaximized = shell.classList.contains('is-maximized');
      maximizeButton.textContent = isMaximized ? 'Restore' : 'Max';
      maximizeButton.setAttribute('aria-label', isMaximized ? 'Restore diagram size' : 'Maximize diagram');
    };

    const setMaximizedState = (shouldMaximize) => {
      const previewElement = this.renderer.previewElement;
      if (shouldMaximize) {
        const activeContainer = previewElement.querySelector('.mermaid-shell.is-maximized');
        if (activeContainer && activeContainer !== shell) {
          activeContainer.classList.remove('is-maximized');
          const activeButton = activeContainer.querySelector('.mermaid-maximize-btn');
          if (activeButton) {
            activeButton.textContent = 'Max';
            activeButton.setAttribute('aria-label', 'Maximize diagram');
          }
        }
        shell.classList.add('is-maximized');
        document.body.classList.add('mermaid-maximized-open');
        syncMaximizeButtonState();
        return;
      }

      shell.classList.remove('is-maximized');
      if (!previewElement.querySelector('.mermaid-shell.is-maximized')) {
        document.body.classList.remove('mermaid-maximized-open');
      }
      syncMaximizeButtonState();
    };

    syncMaximizeButtonState();
    maximizeButton.addEventListener('click', () => {
      setMaximizedState(!shell.classList.contains('is-maximized'));
    });

    const stopPanning = () => {
      if (!isPanning) {
        return;
      }

      isPanning = false;
      frame.classList.remove('is-dragging');

      if (activePointerId !== null && typeof frame.releasePointerCapture === 'function') {
        try {
          frame.releasePointerCapture(activePointerId);
        } catch {
          // Ignore capture release issues during drag end.
        }
      }

      activePointerId = null;
    };

    frame.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || !frame.classList.contains('is-pannable')) {
        return;
      }

      if (zoomAnimationFrameId) {
        cancelAnimationFrame(zoomAnimationFrameId);
        zoomAnimationFrameId = null;
      }

      isPanning = true;
      activePointerId = event.pointerId;
      panStartX = event.clientX;
      panStartY = event.clientY;
      panStartScrollLeft = frame.scrollLeft;
      panStartScrollTop = frame.scrollTop;

      frame.classList.add('is-dragging');
      frame.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });

    frame.addEventListener('pointermove', (event) => {
      if (!isPanning) {
        return;
      }

      frame.scrollLeft = panStartScrollLeft - (event.clientX - panStartX);
      frame.scrollTop = panStartScrollTop - (event.clientY - panStartY);
    });

    frame.addEventListener('pointerup', stopPanning);
    frame.addEventListener('pointercancel', stopPanning);
    frame.addEventListener('lostpointercapture', stopPanning);

    frame.appendChild(svg);
    const sourceNode = shell.querySelector('.mermaid-source');
    renderedDiagram.remove();
    shell.replaceChildren();
    if (sourceNode) {
      sourceNode.hidden = true;
      shell.appendChild(sourceNode);
    }
    shell.append(toolbar, frame);

    applyZoom(defaultZoom);
  }

  createZoomButton(label, ariaLabel) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mermaid-zoom-btn';
    button.setAttribute('aria-label', ariaLabel);
    button.textContent = label;
    return button;
  }
}
