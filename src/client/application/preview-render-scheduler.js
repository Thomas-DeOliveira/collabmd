import {
  cancelIdleRender,
  IDLE_RENDER_TIMEOUT_MS,
  requestIdleRender,
} from './preview-diagram-utils.js';
import { getRenderProfile } from './preview-render-profile.js';

export class PreviewRenderScheduler {
  constructor({
    cancelAnimationFrameFn = (frameId) => cancelAnimationFrame(frameId),
    cancelIdleRenderFn = cancelIdleRender,
    clearTimeoutFn = (timeoutId) => clearTimeout(timeoutId),
    getRenderProfileFn = getRenderProfile,
    idleTimeoutMs = IDLE_RENDER_TIMEOUT_MS,
    requestAnimationFrameFn = (callback) => requestAnimationFrame(callback),
    requestIdleRenderFn = requestIdleRender,
    setTimeoutFn = (callback, delay) => setTimeout(callback, delay),
  } = {}) {
    this.cancelAnimationFrameFn = cancelAnimationFrameFn;
    this.cancelIdleRenderFn = cancelIdleRenderFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.getRenderProfileFn = getRenderProfileFn;
    this.idleTimeoutMs = idleTimeoutMs;
    this.requestAnimationFrameFn = requestAnimationFrameFn;
    this.requestIdleRenderFn = requestIdleRenderFn;
    this.setTimeoutFn = setTimeoutFn;
    this.frameId = null;
    this.idleId = null;
    this.timeoutId = null;
  }

  queue({ markdownText, onRenderRequested, renderVersion }) {
    const renderProfile = this.getRenderProfileFn(markdownText);
    this.cancel();

    const scheduleFrame = () => {
      this.frameId = this.requestAnimationFrameFn(() => {
        this.frameId = null;
        this.timeoutId = null;
        onRenderRequested?.(markdownText, renderVersion);
      });
    };

    const scheduleRender = () => {
      if (renderProfile.deferUntilIdle) {
        this.idleId = this.requestIdleRenderFn(() => {
          this.idleId = null;
          scheduleFrame();
        }, this.idleTimeoutMs);
        return;
      }

      scheduleFrame();
    };

    this.timeoutId = this.setTimeoutFn(scheduleRender, renderProfile.debounceMs);
  }

  cancel() {
    this.clearTimeoutFn(this.timeoutId);
    if (this.frameId) {
      this.cancelAnimationFrameFn(this.frameId);
    }
    this.cancelIdleRenderFn(this.idleId);
    this.frameId = null;
    this.idleId = null;
    this.timeoutId = null;
  }

  destroy() {
    this.cancel();
  }
}
