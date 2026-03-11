import test from 'node:test';
import assert from 'node:assert/strict';

import { EditorSession } from '../../src/client/infrastructure/editor-session.js';

test('EditorSession preserves collaboration compatibility getters', () => {
  const session = new EditorSession({
    editorContainer: null,
    initialTheme: 'light',
    lineInfoElement: null,
    localUser: null,
    onAwarenessChange: () => {},
    onCommentsChange: () => {},
    onConnectionChange: () => {},
    onContentChange: () => {},
    preferredUserName: 'Tester',
  });

  const awareness = { getStates: () => new Map() };
  const provider = { connected: true, destroy() {}, disconnect() {} };
  const ydoc = { clientID: 1, destroy() {} };
  const ytext = { toString: () => '' };

  session.collaborationClient.awareness = awareness;
  session.collaborationClient.provider = provider;
  session.collaborationClient.ydoc = ydoc;
  session.collaborationClient.ytext = ytext;

  assert.equal(session.awareness, awareness);
  assert.equal(session.provider, provider);
  assert.equal(session.ydoc, ydoc);
  assert.equal(session.ytext, ytext);

  session.destroy();
});
