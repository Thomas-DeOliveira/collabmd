import { createMarkdownStarter, normalizeVaultPathInput } from '../domain/vault-paths.js';
import { resolveWikiTarget } from '../domain/vault-utils.js';

export class WikiLinkFileController {
  constructor({
    getFileList,
    navigation,
    refreshExplorer,
    toastController,
    vaultApiClient,
  }) {
    this.getFileList = getFileList;
    this.navigation = navigation;
    this.refreshExplorer = refreshExplorer;
    this.toastController = toastController;
    this.vaultApiClient = vaultApiClient;
  }

  handleWikiLinkClick(target) {
    const match = resolveWikiTarget(target, this.getFileList());

    if (match) {
      this.navigation.navigateToFile(match);
      return;
    }

    const normalizedPath = this.normalizeNewWikiFilePath(target);
    if (!normalizedPath) {
      this.toastController.show('Cannot create an empty wiki-link target');
      return;
    }

    void this.createAndOpenFile(normalizedPath, target);
  }

  normalizeNewWikiFilePath(target) {
    const normalized = normalizeVaultPathInput(target);

    if (!normalized) {
      return null;
    }

    return normalized.endsWith('.md') ? normalized : `${normalized}.md`;
  }

  async createAndOpenFile(filePath, displayName) {
    try {
      await this.vaultApiClient.createFile({
        content: createMarkdownStarter(displayName || filePath),
        path: filePath,
      });
      await this.refreshExplorer();
      this.navigation.navigateToFile(filePath);
      this.toastController.show(`Created ${displayName}`);
    } catch (error) {
      this.toastController.show(`Failed to create file: ${error.message}`);
    }
  }
}
