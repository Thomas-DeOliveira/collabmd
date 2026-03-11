export class FileOpenLifecycle {
  constructor({
    attachEditorScroller,
    createEditorSession,
    loadEditorSessionClass,
    scrollContainerForSession,
  }) {
    this.attachEditorScroller = attachEditorScroller;
    this.createEditorSession = createEditorSession;
    this.loadEditorSessionClass = loadEditorSessionClass;
    this.scrollContainerForSession = scrollContainerForSession;
  }

  async createSession(options) {
    const EditorSession = await this.loadEditorSessionClass();
    return this.createEditorSession(EditorSession, options);
  }

  attachSessionScroller(session) {
    this.attachEditorScroller(this.scrollContainerForSession(session));
  }

  clearSessionScroller() {
    this.attachEditorScroller(null);
  }
}
