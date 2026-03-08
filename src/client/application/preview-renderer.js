import { MermaidPreviewHydrator } from './mermaid-preview-hydrator.js';
import { PlantUmlPreviewHydrator } from './plantuml-preview-hydrator.js';
import {
  cancelIdleRender,
  IDLE_RENDER_TIMEOUT_MS,
  requestIdleRender,
} from './preview-diagram-utils.js';
import { getRenderProfile, isLargeDocumentStats } from './preview-render-profile.js';

export class PreviewRenderer {
  constructor({
    getContent,
    getFileList,
    onAfterRenderCommit,
    onBeforeRenderCommit,
    onRenderComplete,
    outlineController,
    previewContainer,
    previewElement,
  }) {
    this.getContent = getContent;
    this.getFileList = getFileList;
    this.onAfterRenderCommit = onAfterRenderCommit;
    this.onBeforeRenderCommit = onBeforeRenderCommit;
    this.onRenderComplete = onRenderComplete;
    this.outlineController = outlineController;
    this.previewContainer = previewContainer;
    this.previewElement = previewElement;
    this.renderHost = null;

    this.frameId = null;
    this.idleId = null;
    this.timeoutId = null;
    this.pendingRenderVersion = 0;
    this.activeRenderVersion = 0;
    this.readyRenderVersion = 0;
    this.currentStats = null;
    this.isLargeDocument = false;
    this.worker = null;
    this.workerDisabled = false;
    this.workerJob = null;
    this.workerPrewarmId = null;
    this.hydrationPaused = false;

    this.handlePreviewClick = (event) => {
      const mermaidButton = event.target.closest('.mermaid-placeholder-btn');
      if (mermaidButton) {
        const shell = mermaidButton.closest('.mermaid-shell');
        if (!shell) {
          return;
        }

        event.preventDefault();
        this.enqueueMermaidShell(shell, { prioritize: true });
        return;
      }

      const plantUmlButton = event.target.closest('.plantuml-placeholder-btn');
      if (plantUmlButton) {
        const shell = plantUmlButton.closest('.plantuml-shell');
        if (!shell) {
          return;
        }

        event.preventDefault();
        this.enqueuePlantUmlShell(shell, { prioritize: true });
      }
    };

    this.handleWorkerMessage = (event) => {
      if (!this.workerJob || event.data?.renderVersion !== this.workerJob.renderVersion) {
        return;
      }

      const job = this.workerJob;
      this.workerJob = null;

      if (event.data?.error) {
        job.reject(new Error(event.data.error));
        return;
      }

      job.resolve({
        html: event.data.html,
        stats: event.data.stats,
      });
    };

    this.handleWorkerError = (event) => {
      const error = new Error(event.message || 'Preview worker failed');
      if (this.workerJob) {
        this.workerJob.reject(error);
        this.workerJob = null;
      }

      this.resetWorker('Preview worker failed', { disable: true });
    };

    this.handleWindowResize = () => {
      this.plantUmlHydrator.scheduleActiveRefit();
    };

    this.mermaidHydrator = new MermaidPreviewHydrator(this);
    this.plantUmlHydrator = new PlantUmlPreviewHydrator(this);

    this.previewElement?.addEventListener('click', this.handlePreviewClick);
    window.addEventListener('resize', this.handleWindowResize);
    this.setPhase('ready');
  }

  ensureRenderHost() {
    if (!this.previewElement) {
      return null;
    }

    if (this.renderHost?.isConnected && this.renderHost.parentElement === this.previewElement) {
      return this.renderHost;
    }

    let renderHost = this.previewElement.querySelector('[data-preview-render-host="true"]');
    if (!renderHost) {
      renderHost = document.createElement('div');
      renderHost.dataset.previewRenderHost = 'true';
      this.previewElement.appendChild(renderHost);
    }

    this.renderHost = renderHost;
    return this.renderHost;
  }

  normalizePreviewChildren(renderHost = this.renderHost) {
    if (!this.previewElement) {
      return;
    }

    Array.from(this.previewElement.children).forEach((child) => {
      if (child === renderHost || child.dataset.excalidrawOverlayRoot === 'true') {
        return;
      }

      child.remove();
    });
  }

  getReservedPreviewHeight() {
    const currentRenderHeight = this.renderHost?.getBoundingClientRect?.().height ?? 0;
    const containerHeight = this.previewContainer?.clientHeight ?? 0;
    return Math.max(Math.round(currentRenderHeight), Math.round(containerHeight), 320);
  }

  beginDocumentLoad() {
    this.cancelScheduledRender();
    this.cancelMermaidHydration();
    this.cancelPlantUmlHydration();
    this.mermaidHydrator.clearPreservedShells();
    this.plantUmlHydrator.clearPreservedShells();
    this.clearActivePlantUmlShell();
    this.onBeforeRenderCommit?.(this.previewElement);
    this.pendingRenderVersion += 1;
    this.activeRenderVersion = this.pendingRenderVersion;
    this.readyRenderVersion = 0;
    this.currentStats = null;
    this.isLargeDocument = false;
    if (this.workerJob) {
      this.resetWorker('Document changed');
    }
    const renderHost = this.ensureRenderHost();
    this.normalizePreviewChildren(renderHost);
    const reservedHeight = this.getReservedPreviewHeight();
    if (renderHost) {
      renderHost.replaceChildren();
      renderHost.style.minHeight = `${reservedHeight}px`;
    }
    const shell = document.createElement('div');
    shell.className = 'preview-shell';
    shell.style.minHeight = `${reservedHeight}px`;
    shell.textContent = 'Rendering preview…';
    renderHost?.append(shell);
    this.setPhase('shell');
  }

  applyTheme(theme) {
    const highlightTheme = document.getElementById('hljs-theme');
    if (highlightTheme) {
      const { darkHref, lightHref } = highlightTheme.dataset;
      highlightTheme.href = theme === 'dark' ? darkHref : lightHref;
    }
    this.mermaidHydrator.applyTheme(theme);
  }

  configureMermaid(mermaid) {
    this.mermaidHydrator.configureMermaid(mermaid);
  }

  ensureMermaid() {
    return this.mermaidHydrator.ensureMermaid();
  }

  queueRender() {
    const markdownText = this.getContent();
    const renderProfile = getRenderProfile(markdownText);

    this.cancelScheduledRender();

    this.pendingRenderVersion += 1;
    const scheduledVersion = this.pendingRenderVersion;

    const scheduleRender = () => {
      if (renderProfile.deferUntilIdle) {
        this.idleId = requestIdleRender(() => {
          this.idleId = null;
          this.frameId = requestAnimationFrame(() => {
            this.frameId = null;
            this.timeoutId = null;
            void this.render(markdownText, scheduledVersion);
          });
        }, IDLE_RENDER_TIMEOUT_MS);
        return;
      }

      this.frameId = requestAnimationFrame(() => {
        this.frameId = null;
        this.timeoutId = null;
        void this.render(markdownText, scheduledVersion);
      });
    };

    this.timeoutId = setTimeout(scheduleRender, renderProfile.debounceMs);
  }

  async render(markdownText = this.getContent(), renderVersion = this.pendingRenderVersion) {
    if (!this.previewElement) {
      return;
    }

    try {
      const result = await this.compilePreview(markdownText, renderVersion);
      if (renderVersion !== this.pendingRenderVersion) {
        return;
      }

      this.commitBaseRender(result, renderVersion);
    } catch (error) {
      if (renderVersion !== this.pendingRenderVersion) {
        return;
      }

      console.warn('[preview] Failed to render preview:', error);
    }
  }

  destroy() {
    this.cancelScheduledRender();
    this.mermaidHydrator.destroy();
    this.plantUmlHydrator.destroy();
    cancelIdleRender(this.workerPrewarmId);
    this.workerPrewarmId = null;
    this.resetWorker('Preview renderer destroyed');
    this.previewElement?.removeEventListener('click', this.handlePreviewClick);
    window.removeEventListener('resize', this.handleWindowResize);
  }

  setPhase(phase) {
    if (this.previewElement) {
      this.previewElement.dataset.renderPhase = phase;
    }
  }

  cancelScheduledRender() {
    clearTimeout(this.timeoutId);
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
    }
    cancelIdleRender(this.idleId);
    this.frameId = null;
    this.idleId = null;
    this.timeoutId = null;
  }

  cancelMermaidHydration() {
    this.mermaidHydrator.cancelHydration();
  }

  cancelPlantUmlHydration() {
    this.plantUmlHydrator.cancelHydration();
  }

  clearActivePlantUmlShell() {
    this.plantUmlHydrator.clearActiveShell();
  }

  syncActivePlantUmlShell() {
    return this.plantUmlHydrator.syncActiveShell();
  }

  scheduleActivePlantUmlRefit() {
    this.plantUmlHydrator.scheduleActiveRefit();
  }

  setHydrationPaused(paused) {
    this.hydrationPaused = Boolean(paused);

    if (this.hydrationPaused) {
      this.mermaidHydrator.cancelPendingIdleWork();
      this.plantUmlHydrator.cancelPendingIdleWork();
      return;
    }

    this.mermaidHydrator.hydrateVisibleShells();
    this.mermaidHydrator.scheduleHydration();
    this.plantUmlHydrator.hydrateVisibleShells();
    this.plantUmlHydrator.scheduleHydration();
    this.updateHydrationPhase();
  }

  resetWorker(reason, { disable = false } = {}) {
    this.cancelWorkerJob(reason);

    if (this.worker) {
      this.worker.removeEventListener('message', this.handleWorkerMessage);
      this.worker.removeEventListener('error', this.handleWorkerError);
      this.worker.terminate();
      this.worker = null;
    }

    if (disable) {
      this.workerDisabled = true;
    }
  }

  cancelWorkerJob(reason) {
    if (!this.workerJob) {
      return;
    }

    this.workerJob.reject(new Error(reason));
    this.workerJob = null;
  }

  scheduleWorkerPrewarm({ timeout = IDLE_RENDER_TIMEOUT_MS } = {}) {
    if (this.workerDisabled || this.worker || this.workerPrewarmId !== null || typeof Worker !== 'function') {
      return;
    }

    this.workerPrewarmId = requestIdleRender(() => {
      this.workerPrewarmId = null;
      this.ensureWorker();
    }, timeout);
  }

  ensureWorker() {
    if (this.workerDisabled || typeof Worker !== 'function') {
      return null;
    }

    if (this.worker) {
      return this.worker;
    }

    try {
      this.worker = new Worker(new URL('./application/preview-render-worker.js', import.meta.url), { type: 'module' });
      this.worker.addEventListener('message', this.handleWorkerMessage);
      this.worker.addEventListener('error', this.handleWorkerError);
      return this.worker;
    } catch {
      this.workerDisabled = true;
      return null;
    }
  }

  async compilePreview(markdownText, renderVersion) {
    const worker = this.ensureWorker();

    if (worker) {
      if (this.workerJob) {
        this.resetWorker('Superseded preview render');
      }

      const activeWorker = this.ensureWorker();
      return new Promise((resolve, reject) => {
        this.workerJob = { reject, renderVersion, resolve };
        activeWorker.postMessage({
          fileList: this.getFileList?.() ?? [],
          markdownText,
          renderVersion,
        });
      });
    }

    const { compilePreviewDocument } = await import('./preview-render-compiler.js');
    return compilePreviewDocument({
      fileList: this.getFileList?.() ?? [],
      markdownText,
    });
  }

  commitBaseRender({ html, stats }, renderVersion) {
    this.activeRenderVersion = renderVersion;
    this.readyRenderVersion = 0;
    this.currentStats = stats;
    this.isLargeDocument = isLargeDocumentStats(stats);

    this.cancelMermaidHydration();
    this.cancelPlantUmlHydration();
    document.body.classList.remove('mermaid-maximized-open');
    document.body.classList.remove('plantuml-maximized-open');
    this.preserveHydratedMermaidsForCommit();
    this.preserveHydratedPlantUmlsForCommit();

    this.onBeforeRenderCommit?.(this.previewElement);
    const renderHost = this.ensureRenderHost();
    this.normalizePreviewChildren(renderHost);
    if (renderHost) {
      renderHost.innerHTML = html;
    }
    this.reconcileHydratedMermaids();
    this.reconcileHydratedPlantUmls();
    this.setPhase('base');

    this.outlineController.refresh();
    this.onAfterRenderCommit?.(this.previewElement, {
      ...stats,
      isLargeDocument: this.isLargeDocument,
      renderVersion,
    });

    const mermaidShellCount = this.setupMermaidHydration(renderVersion);
    const plantUmlShellCount = this.setupPlantUmlHydration(renderVersion);

    if (mermaidShellCount === 0 && plantUmlShellCount === 0) {
      this.notifyReady();
    }
  }

  preserveHydratedMermaidsForCommit() {
    this.mermaidHydrator.preserveHydratedShellsForCommit();
  }

  preserveHydratedPlantUmlsForCommit() {
    this.plantUmlHydrator.preserveHydratedShellsForCommit();
  }

  reconcileHydratedMermaids() {
    this.mermaidHydrator.reconcileHydratedShells();
  }

  reconcileHydratedPlantUmls() {
    this.plantUmlHydrator.reconcileHydratedShells();
  }

  syncPreservedMermaidShell(preservedShell, nextShell) {
    this.mermaidHydrator.syncPreservedShell(preservedShell, nextShell);
  }

  syncPreservedPlantUmlShell(preservedShell, nextShell) {
    this.plantUmlHydrator.syncPreservedShell(preservedShell, nextShell);
  }

  setupMermaidHydration(renderVersion) {
    return this.mermaidHydrator.setupHydration(renderVersion);
  }

  hydrateVisibleMermaids() {
    this.mermaidHydrator.hydrateVisibleShells();
  }

  enqueueMermaidShell(shell, { prioritize = false } = {}) {
    this.mermaidHydrator.enqueueShell(shell, { prioritize });
  }

  scheduleMermaidHydration() {
    this.mermaidHydrator.scheduleHydration();
  }

  async flushMermaidHydrationQueue() {
    await this.mermaidHydrator.flushHydrationQueue();
  }

  async hydrateMermaidShell(shell, mermaid) {
    await this.mermaidHydrator.hydrateShell(shell, mermaid);
  }

  resetHydratedMermaids() {
    this.mermaidHydrator.resetHydratedShells();
  }

  setupPlantUmlHydration(renderVersion) {
    return this.plantUmlHydrator.setupHydration(renderVersion);
  }

  hydrateVisiblePlantUmls() {
    this.plantUmlHydrator.hydrateVisibleShells();
  }

  enqueuePlantUmlShell(shell, { prioritize = false } = {}) {
    this.plantUmlHydrator.enqueueShell(shell, { prioritize });
  }

  schedulePlantUmlHydration() {
    this.plantUmlHydrator.scheduleHydration();
  }

  async flushPlantUmlHydrationQueue() {
    await this.plantUmlHydrator.flushHydrationQueue();
  }

  async hydratePlantUmlShell(shell) {
    await this.plantUmlHydrator.hydrateShell(shell);
  }

  updateHydrationPhase() {
    if (this.hydrationPaused) {
      if (this.mermaidHydrator.hasPendingWork() || this.plantUmlHydrator.hasPendingWork()) {
        this.setPhase('base');
        return;
      }
    }

    if (this.mermaidHydrator.hasPendingWork() || this.plantUmlHydrator.hasPendingWork()) {
      this.setPhase('hydrating');
      return;
    }

    this.notifyReady();
  }

  notifyReady() {
    if (this.renderHost) {
      this.renderHost.style.minHeight = '';
    }

    this.setPhase('ready');

    if (this.readyRenderVersion === this.activeRenderVersion) {
      return;
    }

    this.readyRenderVersion = this.activeRenderVersion;
    this.onRenderComplete?.({
      isLargeDocument: this.isLargeDocument,
      stats: this.currentStats,
    });
  }

  async fetchPlantUmlSvg(source) {
    return this.plantUmlHydrator.fetchSvg(source);
  }

  async fetchPlantUmlSource(filePath) {
    return this.plantUmlHydrator.fetchSource(filePath);
  }

  async fetchMermaidSource(filePath) {
    return this.mermaidHydrator.fetchSource(filePath);
  }

  resetPlantUmlShell(shell, { clearCache = false, message = 'Renders server-side when visible' } = {}) {
    this.plantUmlHydrator.resetShell(shell, { clearCache, message });
  }

  enhancePlantUmlDiagram(shell, svgMarkup) {
    this.plantUmlHydrator.enhanceDiagram(shell, svgMarkup);
  }

  enhanceMermaidDiagram(shell, renderedDiagram) {
    this.mermaidHydrator.enhanceDiagram(shell, renderedDiagram);
  }

  createMermaidZoomButton(label, ariaLabel) {
    return this.mermaidHydrator.createZoomButton(label, ariaLabel);
  }

  createPlantUmlToolButton(label, ariaLabel) {
    return this.plantUmlHydrator.createToolButton(label, ariaLabel);
  }
}
