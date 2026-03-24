import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeExportBridge, exportDocument } from '../../src/client/export/export-host.js';
import { resolveExportAssets } from '../../src/client/export/export-pipeline.js';

describe('export pipeline browser helpers', () => {
  const originalFetch = globalThis.fetch;
  const originalOpen = window.open;

  afterEach(() => {
    document.body.innerHTML = '';
    globalThis.fetch = originalFetch;
    window.open = originalOpen;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('inlines remote images into the canonical snapshot', async () => {
    globalThis.fetch = vi.fn(async () => new Response(
      new Blob(['png-bytes'], { type: 'image/png' }),
      {
        headers: {
          'Content-Length': '9',
        },
        status: 200,
      },
    ));

    const container = document.createElement('div');
    container.innerHTML = '<p><img src="https://cdn.example.com/diagram.png" alt="Architecture"></p>';
    const snapshot = {
      assets: {},
      warnings: [],
    };

    await resolveExportAssets(snapshot, { container });

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(image?.getAttribute('data-export-docx-src')).toMatch(/^data:image\/png;base64,/);
    expect(Object.keys(snapshot.assets)).toHaveLength(1);
    expect(snapshot.warnings).toHaveLength(0);
  });

  it('replaces image nodes with a stable warning when remote inlining fails', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    const container = document.createElement('div');
    container.innerHTML = '<p><img src="https://cdn.example.com/diagram.png" alt="Architecture"></p>';
    const snapshot = {
      assets: {},
      warnings: [],
    };

    await resolveExportAssets(snapshot, { container });

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('Image export failed: Failed to fetch');
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://cdn.example.com/diagram.png');
    expect(snapshot.warnings).toContain('Failed to fetch');
  });

  it('sanitizes PlantUML SVG before mounting it into the export snapshot', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__xss = true"><script>alert(1)</script><foreignObject><div>bad</div></foreignObject><rect width="120" height="80" /></svg>',
    }), {
      headers: {
        'Content-Type': 'application/json',
      },
      status: 200,
    }));

    const container = document.createElement('div');
    container.innerHTML = '<div class="plantuml-shell" data-plantuml-key="plantuml-1"><pre class="plantuml-source">@startuml\nAlice -&gt; Bob: Hello\n@enduml</pre></div>';
    const snapshot = {
      assets: {},
      warnings: [],
    };

    await resolveExportAssets(snapshot, { container });

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('onload')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('foreignObject')).toBeNull();
    expect(snapshot.warnings).toHaveLength(0);
  });

  it('cleans up export jobs when the popup closes before completion', async () => {
    vi.useFakeTimers();

    const onError = vi.fn();
    const exportWindow = {
      closed: false,
      focus: vi.fn(),
      postMessage: vi.fn(),
    };

    window.open = vi.fn(() => exportWindow);
    initializeExportBridge({ onError });

    const jobId = await exportDocument({
      filePath: 'README.md',
      format: 'pdf',
      markdownText: '# Export',
      title: 'README',
    });

    exportWindow.closed = true;
    vi.advanceTimersByTime(600);

    expect(onError).toHaveBeenCalledWith('Export window was closed before the export completed');

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        jobId,
        source: 'collabmd-export-page',
        type: 'ready',
      },
      origin: window.location.origin,
    }));

    expect(exportWindow.postMessage).not.toHaveBeenCalled();
  });
});
