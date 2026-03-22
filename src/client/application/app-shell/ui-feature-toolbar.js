import { isMarkdownFilePath } from '../../../domain/file-kind.js';

const IMAGE_FILE_PICKER_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml';

/**
 * @typedef {object} UiToolbarContext
 * @property {string | null} currentFilePath
 * @property {Document} document
 * @property {{ refresh(): Promise<void> }} fileExplorer
 * @property {{ show(message: string): void }} toastController
 * @property {{ uploadImageAttachment(payload: { file: File, fileName: string, sourcePath: string }): Promise<{ markdown?: string, path?: string }>} } vaultApiClient
 * @property {{ applyMarkdownToolbarAction(action: string): boolean, insertText(text: string): void } | null} session
 * @property {() => Promise<File | null>} pickImageFile
 * @property {(file: File) => Promise<boolean>} handleEditorImageInsert
 * @property {() => Promise<void>} handleToolbarImageInsert
 */

/** @this {UiToolbarContext} */
function applyMarkdownToolbarAction(action) {
  if (!this.session || !isMarkdownFilePath(this.currentFilePath)) {
    return;
  }

  if (action === 'image') {
    void this.handleToolbarImageInsert();
    return;
  }

  const applied = this.session.applyMarkdownToolbarAction(action);
  if (!applied) {
    this.toastController.show('Formatting action is unavailable');
  }
}

/** @this {UiToolbarContext} */
async function handleToolbarImageInsert() {
  const file = await this.pickImageFile();
  if (!file) {
    return;
  }

  await this.handleEditorImageInsert(file);
}

/** @this {UiToolbarContext} */
function pickImageFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = IMAGE_FILE_PICKER_ACCEPT;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    document.body.appendChild(input);
    let settled = false;
    let focusTimer = null;

    const cleanup = (value) => {
      if (settled) {
        return;
      }

      settled = true;
      if (focusTimer) {
        window.clearTimeout(focusTimer);
      }
      window.removeEventListener('focus', handleWindowFocus);
      input.remove();
      resolve(value);
    };

    const handleWindowFocus = () => {
      focusTimer = window.setTimeout(() => {
        if (settled || input.files?.length) {
          return;
        }

        cleanup(null);
      }, 250);
    };

    input.addEventListener('change', () => {
      cleanup(input.files?.[0] ?? null);
    }, { once: true });

    input.addEventListener('cancel', () => {
      cleanup(null);
    }, { once: true });

    window.addEventListener('focus', handleWindowFocus, { once: true });
    input.click();
  });
}

/** @this {UiToolbarContext} */
async function handleEditorImageInsert(file) {
  if (!this.session || !isMarkdownFilePath(this.currentFilePath)) {
    console.warn('[ui] Ignoring image insert because there is no active markdown session.', {
      currentFilePath: this.currentFilePath,
      hasSession: Boolean(this.session),
    });
    return false;
  }

  const activeFilePath = this.currentFilePath;
  const activeSession = this.session;

  try {
    console.debug('[ui] Uploading image attachment.', {
      fileName: file?.name || '',
      size: file?.size ?? null,
      sourcePath: activeFilePath,
      type: file?.type || '',
    });
    const result = await this.vaultApiClient.uploadImageAttachment({
      file,
      fileName: file?.name || '',
      sourcePath: activeFilePath,
    });

    await this.fileExplorer.refresh();

    if (
      this.currentFilePath === activeFilePath
      && this.session
      && this.session === activeSession
      && typeof result?.markdown === 'string'
    ) {
      console.debug('[ui] Inserting uploaded image markdown into the editor.', {
        sourcePath: activeFilePath,
        storedPath: result.path ?? '',
      });
      this.session.insertText(result.markdown);
    }

    return true;
  } catch (error) {
    console.error('[ui] Failed to insert image attachment:', error);
    this.toastController.show(error.message || 'Failed to upload image');
    return false;
  }
}

/** @this {UiToolbarContext} */
async function copyCurrentLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    this.toastController.show('Link copied');
  } catch {
    this.toastController.show('Failed to copy link');
  }
}

export const uiFeatureToolbarMethods = {
  applyMarkdownToolbarAction,
  copyCurrentLink,
  handleEditorImageInsert,
  handleToolbarImageInsert,
  pickImageFile,
};
