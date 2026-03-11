import {
  getVaultFileExtension,
  stripVaultFileExtension,
} from '../../domain/file-kind.js';
import {
  composeVaultChildPath,
  createMarkdownStarter,
  createMermaidStarter,
  createPlantUmlStarter,
  ensureVaultExtension,
  normalizeVaultPathInput,
} from '../domain/vault-paths.js';

function getPathLeaf(path) {
  return String(path ?? '')
    .replace(/\/+$/u, '')
    .split('/')
    .filter(Boolean)
    .pop() || '';
}

function createEmptyExcalidrawScene() {
  return JSON.stringify({
    type: 'excalidraw',
    version: 2,
    source: 'collabmd',
    elements: [],
    appState: { viewBackgroundColor: '#ffffff', gridSize: null },
    files: {},
  });
}

export class FileActionController {
  constructor({
    onFileDelete,
    onFileSelect,
    state,
    toastController,
    vaultClient,
    view,
    refresh,
  }) {
    this.onFileDelete = onFileDelete;
    this.onFileSelect = onFileSelect;
    this.state = state;
    this.toastController = toastController;
    this.vaultClient = vaultClient;
    this.view = view;
    this.refresh = refresh;
    this.newFileButton = document.getElementById('newFileBtn');
    this.newDrawingButton = document.getElementById('newDrawingBtn');
    this.newMermaidButton = document.getElementById('newMermaidBtn');
    this.newPlantumlButton = document.getElementById('newPlantumlBtn');
    this.newFolderButton = document.getElementById('newFolderBtn');
    this.refreshButton = document.getElementById('refreshFilesBtn');
    this.actionDialog = document.getElementById('fileActionDialog');
    this.actionForm = document.getElementById('fileActionForm');
    this.actionTitle = document.getElementById('fileActionTitle');
    this.actionCopy = document.getElementById('fileActionCopy');
    this.actionField = document.getElementById('fileActionField');
    this.actionLabel = document.getElementById('fileActionLabel');
    this.actionInput = document.getElementById('fileActionInput');
    this.actionHint = document.getElementById('fileActionHint');
    this.actionNote = document.getElementById('fileActionNote');
    this.actionCancelButton = document.getElementById('fileActionCancel');
    this.actionSubmitButton = document.getElementById('fileActionSubmit');
    this.pendingAction = null;
    this.actionBusy = false;
  }

  initialize() {
    this.newFileButton?.addEventListener('click', () => this.handleNewFile());
    this.newDrawingButton?.addEventListener('click', () => this.handleNewDrawing());
    this.newMermaidButton?.addEventListener('click', () => this.handleNewMermaid());
    this.newPlantumlButton?.addEventListener('click', () => this.handleNewPlantUml());
    this.newFolderButton?.addEventListener('click', () => this.handleNewFolder());
    this.refreshButton?.addEventListener('click', () => this.refresh());
    this.actionCancelButton?.addEventListener('click', () => this.closeActionDialog());
    this.actionForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.handleActionSubmit();
    });
    this.actionDialog?.addEventListener('close', () => this.resetActionDialog());
  }

  createContextMenuItems(parentDir = '') {
    return [
      {
        label: 'New markdown file',
        onSelect: () => this.handleNewFile({ parentDir }),
      },
      {
        label: 'New Excalidraw drawing',
        onSelect: () => this.handleNewDrawing({ parentDir }),
      },
      {
        label: 'New Mermaid diagram',
        onSelect: () => this.handleNewMermaid({ parentDir }),
      },
      {
        label: 'New PlantUML diagram',
        onSelect: () => this.handleNewPlantUml({ parentDir }),
      },
      {
        label: 'New folder',
        onSelect: () => this.handleNewFolder({ parentDir }),
      },
    ];
  }

  getFileContextMenuItems(filePath) {
    return [
      {
        label: 'Rename',
        onSelect: () => this.handleRename(filePath),
      },
      {
        label: 'Delete',
        danger: true,
        onSelect: () => this.handleDelete(filePath),
      },
    ];
  }

  showToast(message) {
    if (message) {
      this.toastController?.show(String(message));
    }
  }

  showError(message, error) {
    this.showToast(error?.message ? `${message}: ${error.message}` : message);
  }

  ensureExtension(pathValue, extension) {
    return ensureVaultExtension(pathValue, extension);
  }

  openActionDialog({
    title,
    copy,
    label = 'Path',
    hint = '',
    note = '',
    placeholder = '',
    value = '',
    submitLabel = 'Save',
    destructive = false,
    requiresInput = true,
    emptyMessage = 'A value is required',
    onSubmit,
  }) {
    if (!this.actionDialog || !this.actionTitle || !this.actionCopy || !this.actionSubmitButton || !this.actionCancelButton) {
      return;
    }

    if (requiresInput && !this.actionInput) {
      return;
    }

    if (this.actionDialog.open) {
      if (typeof this.actionDialog.close === 'function') {
        this.actionDialog.close();
      } else {
        this.actionDialog.removeAttribute('open');
        this.resetActionDialog();
      }
    }

    this.pendingAction = { requiresInput, emptyMessage, onSubmit };
    this.view?.removeContextMenu?.();

    this.actionTitle.textContent = title;
    this.actionCopy.textContent = copy;

    if (this.actionField) {
      this.actionField.hidden = !requiresInput;
    }
    if (this.actionLabel) {
      this.actionLabel.textContent = label;
    }
    if (this.actionInput) {
      this.actionInput.value = value;
      this.actionInput.placeholder = placeholder;
      this.actionInput.required = requiresInput;
      this.actionInput.disabled = false;
    }
    if (this.actionHint) {
      this.actionHint.textContent = hint;
      this.actionHint.hidden = !requiresInput || !hint;
    }
    if (this.actionNote) {
      this.actionNote.textContent = note;
      this.actionNote.hidden = !note;
      this.actionNote.classList.toggle('is-danger', destructive);
    }

    this.actionSubmitButton.textContent = submitLabel;
    this.actionSubmitButton.disabled = false;
    this.actionSubmitButton.classList.toggle('btn-primary', !destructive);
    this.actionSubmitButton.classList.toggle('btn-danger', destructive);
    this.actionCancelButton.disabled = false;

    if (typeof this.actionDialog.showModal === 'function') {
      this.actionDialog.showModal();
    } else {
      this.actionDialog.setAttribute('open', 'true');
    }

    requestAnimationFrame(() => {
      if (!requiresInput || !this.actionInput) {
        this.actionSubmitButton.focus();
        return;
      }

      this.actionInput.focus();
      if (value) {
        this.actionInput.select();
      }
    });
  }

  resetActionDialog() {
    this.pendingAction = null;
    this.actionBusy = false;

    if (this.actionField) {
      this.actionField.hidden = false;
    }
    if (this.actionLabel) {
      this.actionLabel.textContent = 'Path';
    }
    if (this.actionInput) {
      this.actionInput.value = '';
      this.actionInput.placeholder = '';
      this.actionInput.required = true;
      this.actionInput.disabled = false;
    }
    if (this.actionHint) {
      this.actionHint.textContent = '';
      this.actionHint.hidden = true;
    }
    if (this.actionNote) {
      this.actionNote.textContent = '';
      this.actionNote.hidden = true;
      this.actionNote.classList.remove('is-danger');
    }
    if (this.actionSubmitButton) {
      this.actionSubmitButton.textContent = 'Save';
      this.actionSubmitButton.disabled = false;
      this.actionSubmitButton.classList.add('btn-primary');
      this.actionSubmitButton.classList.remove('btn-danger');
    }
    if (this.actionCancelButton) {
      this.actionCancelButton.disabled = false;
    }
  }

  closeActionDialog() {
    if (!this.actionDialog) {
      return;
    }

    if (this.actionDialog.open && typeof this.actionDialog.close === 'function') {
      this.actionDialog.close();
      return;
    }

    this.actionDialog.removeAttribute('open');
    this.resetActionDialog();
  }

  setActionDialogBusy(isBusy) {
    this.actionBusy = isBusy;

    if (this.actionInput) {
      this.actionInput.disabled = isBusy || !(this.pendingAction?.requiresInput ?? true);
    }
    if (this.actionCancelButton) {
      this.actionCancelButton.disabled = isBusy;
    }
    if (this.actionSubmitButton) {
      this.actionSubmitButton.disabled = isBusy;
    }
  }

  async handleActionSubmit() {
    if (!this.pendingAction?.onSubmit || this.actionBusy) {
      return;
    }

    const requiresInput = this.pendingAction.requiresInput;
    const rawValue = requiresInput ? this.actionInput?.value.trim() ?? '' : undefined;

    if (requiresInput && !rawValue) {
      this.showToast(this.pendingAction.emptyMessage);
      this.actionInput?.focus();
      return;
    }

    this.setActionDialogBusy(true);

    let shouldClose = false;
    try {
      shouldClose = await this.pendingAction.onSubmit(rawValue);
    } catch (error) {
      shouldClose = false;
      this.showError('Failed to complete action', error);
    }

    this.setActionDialogBusy(false);

    if (shouldClose !== false) {
      this.closeActionDialog();
      return;
    }

    if (requiresInput && this.actionInput) {
      this.actionInput.focus();
      this.actionInput.select();
    }
  }

  async createVaultFile(filePath, content, { openAfterCreate = false, errorMessage = 'Failed to create file' } = {}) {
    try {
      await this.vaultClient.createFile({ content, path: filePath });
      this.state.expandDirectoryPath(filePath, { includeLeaf: false });
      await this.refresh();

      if (openAfterCreate) {
        this.onFileSelect?.(filePath);
      }

      return true;
    } catch (error) {
      this.showToast(error?.message || errorMessage);
      return false;
    }
  }

  async createDirectory(pathValue) {
    const directoryPath = normalizeVaultPathInput(pathValue);
    if (!directoryPath) {
      this.showToast('Folder path is required');
      return false;
    }

    try {
      await this.vaultClient.createDirectory(directoryPath);
      this.state.expandDirectoryPath(directoryPath);
      await this.refresh();
      return true;
    } catch (error) {
      this.showToast(error?.message || 'Failed to create folder');
      return false;
    }
  }

  async renameVaultFile(filePath, nextName, extension) {
    const normalizedName = String(nextName ?? '').trim();
    if (!normalizedName) {
      this.showToast('File name is required');
      return false;
    }

    if (/[\\/]/u.test(normalizedName)) {
      this.showToast('Rename only supports the file name right now');
      return false;
    }

    const baseName = stripVaultFileExtension(normalizedName).trim();
    if (!baseName) {
      this.showToast('File name is required');
      return false;
    }

    const dir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/') + 1) : '';
    const newPath = `${dir}${baseName}${extension}`;

    if (newPath === filePath) {
      return true;
    }

    try {
      await this.vaultClient.renameFile({ newPath, oldPath: filePath });
      this.state.expandDirectoryPath(newPath, { includeLeaf: false });
      await this.refresh();

      if (this.state.activeFilePath === filePath) {
        this.state.activeFilePath = newPath;
        this.onFileSelect?.(newPath);
      }

      return true;
    } catch (error) {
      this.showToast(error?.message || 'Failed to rename');
      return false;
    }
  }

  async deleteVaultFile(filePath) {
    try {
      await this.vaultClient.deleteFile(filePath);
      await this.refresh();

      if (this.state.activeFilePath === filePath) {
        this.state.activeFilePath = null;
        this.onFileDelete?.(filePath);
      }

      return true;
    } catch (error) {
      this.showToast(error?.message || 'Failed to delete');
      return false;
    }
  }

  getCreateContext(parentDir = '') {
    const normalizedParentDir = normalizeVaultPathInput(parentDir);

    return {
      hintPrefix: normalizedParentDir
        ? 'Use "/" to create nested items under this folder.'
        : 'Use "/" to place it inside a folder.',
      inputLabelSuffix: normalizedParentDir ? 'name or path' : 'path',
      note: normalizedParentDir ? `Parent folder: ${normalizedParentDir}` : '',
      normalizedParentDir,
    };
  }

  handleNewFile({ parentDir = '' } = {}) {
    const context = this.getCreateContext(parentDir);

    this.openActionDialog({
      title: 'Create markdown file',
      copy: context.normalizedParentDir
        ? 'Add a new note inside the selected folder. It opens immediately after creation.'
        : 'Add a new note to the vault. It opens immediately after creation.',
      label: `File ${context.inputLabelSuffix}`,
      hint: `${context.hintPrefix} ".md" is added automatically.`,
      note: context.note,
      placeholder: context.normalizedParentDir ? 'my-note' : 'notes/my-note',
      submitLabel: 'Create file',
      emptyMessage: 'File path is required',
      onSubmit: (value) => {
        const normalizedPath = normalizeVaultPathInput(value);
        if (!normalizedPath) {
          this.showToast('File path is required');
          return false;
        }

        const filePath = this.ensureExtension(composeVaultChildPath(context.normalizedParentDir, normalizedPath), '.md');
        return this.createVaultFile(filePath, createMarkdownStarter(filePath), {
          errorMessage: 'Failed to create file',
          openAfterCreate: true,
        });
      },
    });
  }

  handleNewFolder({ parentDir = '' } = {}) {
    const context = this.getCreateContext(parentDir);

    this.openActionDialog({
      title: 'Create folder',
      copy: context.normalizedParentDir
        ? 'Add a new folder inside the selected folder.'
        : 'Add a new folder to organize notes and diagrams.',
      label: `Folder ${context.inputLabelSuffix}`,
      hint: context.hintPrefix,
      note: context.note,
      placeholder: context.normalizedParentDir ? 'archive' : 'notes/archive',
      submitLabel: 'Create folder',
      emptyMessage: 'Folder path is required',
      onSubmit: (value) => this.createDirectory(composeVaultChildPath(context.normalizedParentDir, value)),
    });
  }

  handleNewDrawing({ parentDir = '' } = {}) {
    const context = this.getCreateContext(parentDir);

    this.openActionDialog({
      title: 'Create Excalidraw drawing',
      copy: context.normalizedParentDir
        ? 'Start a new drawing inside the selected folder.'
        : 'Start a new drawing file in the vault.',
      label: `Drawing ${context.inputLabelSuffix}`,
      hint: `${context.hintPrefix} ".excalidraw" is added automatically.`,
      note: context.note,
      placeholder: context.normalizedParentDir ? 'architecture' : 'diagrams/architecture',
      submitLabel: 'Create drawing',
      emptyMessage: 'Drawing path is required',
      onSubmit: (value) => {
        const normalizedPath = normalizeVaultPathInput(value);
        if (!normalizedPath) {
          this.showToast('Drawing path is required');
          return false;
        }

        const filePath = this.ensureExtension(composeVaultChildPath(context.normalizedParentDir, normalizedPath), '.excalidraw');
        return this.createVaultFile(filePath, createEmptyExcalidrawScene(), {
          errorMessage: 'Failed to create drawing',
          openAfterCreate: true,
        });
      },
    });
  }

  handleNewMermaid({ parentDir = '' } = {}) {
    const context = this.getCreateContext(parentDir);

    this.openActionDialog({
      title: 'Create Mermaid diagram',
      copy: context.normalizedParentDir
        ? 'Create a new `.mmd` or `.mermaid` file inside the selected folder.'
        : 'Create a new `.mmd` or `.mermaid` file with starter diagram content.',
      label: `Diagram ${context.inputLabelSuffix}`,
      hint: `${context.hintPrefix} ".mmd" is added automatically unless you enter ".mermaid".`,
      note: context.note,
      placeholder: context.normalizedParentDir ? 'flow' : 'diagrams/flow',
      submitLabel: 'Create diagram',
      emptyMessage: 'Diagram path is required',
      onSubmit: (value) => {
        const normalizedPath = normalizeVaultPathInput(value);
        if (!normalizedPath) {
          this.showToast('Diagram path is required');
          return false;
        }

        const starter = createMermaidStarter(composeVaultChildPath(context.normalizedParentDir, normalizedPath));
        return this.createVaultFile(starter.path, starter.content, {
          errorMessage: 'Failed to create Mermaid diagram',
          openAfterCreate: true,
        });
      },
    });
  }

  handleNewPlantUml({ parentDir = '' } = {}) {
    const context = this.getCreateContext(parentDir);

    this.openActionDialog({
      title: 'Create PlantUML diagram',
      copy: context.normalizedParentDir
        ? 'Create a new `.puml` or `.plantuml` file inside the selected folder.'
        : 'Create a new `.puml` or `.plantuml` file with starter diagram content.',
      label: `Diagram ${context.inputLabelSuffix}`,
      hint: `${context.hintPrefix} ".puml" is added automatically unless you enter ".plantuml".`,
      note: context.note,
      placeholder: context.normalizedParentDir ? 'sequence-flow' : 'diagrams/sequence-flow',
      submitLabel: 'Create diagram',
      emptyMessage: 'Diagram path is required',
      onSubmit: (value) => {
        const normalizedPath = normalizeVaultPathInput(value);
        if (!normalizedPath) {
          this.showToast('Diagram path is required');
          return false;
        }

        const starter = createPlantUmlStarter(composeVaultChildPath(context.normalizedParentDir, normalizedPath));
        return this.createVaultFile(starter.path, starter.content, {
          errorMessage: 'Failed to create PlantUML diagram',
          openAfterCreate: true,
        });
      },
    });
  }

  handleRename(filePath) {
    const currentName = getPathLeaf(filePath);
    const extension = getVaultFileExtension(currentName) ?? '.md';

    this.openActionDialog({
      title: 'Rename file',
      copy: 'Update the file name without changing its current type.',
      label: 'Name',
      hint: `${extension} is kept automatically.`,
      value: stripVaultFileExtension(currentName),
      submitLabel: 'Rename file',
      emptyMessage: 'File name is required',
      onSubmit: (value) => this.renameVaultFile(filePath, value, extension),
    });
  }

  handleDelete(filePath) {
    this.openActionDialog({
      title: 'Delete file',
      copy: 'This permanently removes the file from the vault.',
      note: filePath,
      submitLabel: 'Delete file',
      destructive: true,
      requiresInput: false,
      onSubmit: () => this.deleteVaultFile(filePath),
    });
  }
}
