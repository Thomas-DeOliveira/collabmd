import test from 'node:test';
import assert from 'node:assert/strict';

import { PreviewRenderScheduler } from '../../src/client/application/preview-render-scheduler.js';

test('PreviewRenderScheduler debounces and schedules immediate frame renders', () => {
  const timeouts = [];
  const frames = [];
  const idle = [];
  const calls = [];
  const scheduler = new PreviewRenderScheduler({
    cancelAnimationFrameFn() {},
    cancelIdleRenderFn() {},
    clearTimeoutFn() {},
    getRenderProfileFn: () => ({ debounceMs: 12, deferUntilIdle: false }),
    requestAnimationFrameFn: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    requestIdleRenderFn: (callback, timeout) => {
      idle.push({ callback, timeout });
      return idle.length;
    },
    setTimeoutFn: (callback, delay) => {
      timeouts.push({ callback, delay });
      return timeouts.length;
    },
  });

  scheduler.queue({
    markdownText: '# Preview',
    onRenderRequested: (markdownText, renderVersion) => {
      calls.push({ markdownText, renderVersion });
    },
    renderVersion: 4,
  });

  assert.equal(timeouts.length, 1);
  assert.equal(timeouts[0].delay, 12);
  assert.equal(frames.length, 0);

  timeouts[0].callback();
  assert.equal(frames.length, 1);
  assert.equal(idle.length, 0);

  frames[0]();
  assert.deepEqual(calls, [{ markdownText: '# Preview', renderVersion: 4 }]);
});

test('PreviewRenderScheduler defers idle renders before the animation frame', () => {
  const timeouts = [];
  const frames = [];
  const idle = [];
  const calls = [];
  const scheduler = new PreviewRenderScheduler({
    cancelAnimationFrameFn() {},
    cancelIdleRenderFn() {},
    clearTimeoutFn() {},
    getRenderProfileFn: () => ({ debounceMs: 4, deferUntilIdle: true }),
    requestAnimationFrameFn: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    requestIdleRenderFn: (callback, timeout) => {
      idle.push({ callback, timeout });
      return idle.length;
    },
    setTimeoutFn: (callback, delay) => {
      timeouts.push({ callback, delay });
      return timeouts.length;
    },
  });

  scheduler.queue({
    markdownText: 'large doc',
    onRenderRequested: (markdownText, renderVersion) => {
      calls.push({ markdownText, renderVersion });
    },
    renderVersion: 9,
  });

  timeouts[0].callback();
  assert.equal(idle.length, 1);
  assert.equal(idle[0].timeout > 0, true);

  idle[0].callback();
  assert.equal(frames.length, 1);
  frames[0]();

  assert.deepEqual(calls, [{ markdownText: 'large doc', renderVersion: 9 }]);
});

test('PreviewRenderScheduler cancels timeout, idle, and frame work together', () => {
  const cancelled = [];
  let timeoutCallback = null;
  const scheduler = new PreviewRenderScheduler({
    cancelAnimationFrameFn: (frameId) => {
      if (frameId !== null) {
        cancelled.push(['frame', frameId]);
      }
    },
    cancelIdleRenderFn: (idleId) => {
      if (idleId !== null) {
        cancelled.push(['idle', idleId]);
      }
    },
    clearTimeoutFn: (timeoutId) => {
      if (timeoutId !== null) {
        cancelled.push(['timeout', timeoutId]);
      }
    },
    getRenderProfileFn: () => ({ debounceMs: 1, deferUntilIdle: true }),
    requestAnimationFrameFn: () => 22,
    requestIdleRenderFn: () => 11,
    setTimeoutFn: (callback) => {
      timeoutCallback = callback;
      return 33;
    },
  });

  scheduler.queue({
    markdownText: 'cancel me',
    onRenderRequested() {},
    renderVersion: 1,
  });

  timeoutCallback();
  scheduler.cancel();

  assert.deepEqual(cancelled, [
    ['timeout', 33],
    ['idle', 11],
  ]);
});
