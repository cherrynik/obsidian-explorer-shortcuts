const { Modal, Notice, Plugin, Setting, TFile, TFolder } = require('obsidian');

const SELECTED_CLASS = 'cherrynik-explorer-selected';
const ITEM_SELECTOR = '.nav-file-title, .nav-folder-title';

class RenameModal extends Modal {
  constructor(app, file, onRename) {
    super(app);
    this.file = file;
    this.onRename = onRename;
  }

  onOpen() {
    this.titleEl.setText('Rename');
    const extension = this.file instanceof TFile && this.file.extension ? `.${this.file.extension}` : '';
    const currentName = this.file.name.slice(0, this.file.name.length - extension.length);
    let input;
    new Setting(this.contentEl)
      .setName('Name')
      .addText(text => {
        input = text.inputEl;
        text.setValue(currentName);
        text.inputEl.addEventListener('keydown', event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            this.submit(text.getValue(), extension);
          }
        });
      });
    new Setting(this.contentEl)
      .addButton(button => button.setButtonText('Rename').setCta().onClick(() => this.submit(input.value, extension)));
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  async submit(rawName, extension) {
    const name = rawName.trim();
    if (!name || name.includes('/')) {
      new Notice('Use a non-empty name without slashes.');
      return;
    }
    const parentPath = this.file.parent?.path;
    const targetPath = parentPath && parentPath !== '/' ? `${parentPath}/${name}${extension}` : `${name}${extension}`;
    if (targetPath === this.file.path) {
      this.close();
      return;
    }
    if (this.app.vault.getAbstractFileByPath(targetPath)) {
      new Notice('A file or folder with this name already exists.');
      return;
    }
    await this.onRename(targetPath);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}

module.exports = class ExplorerShortcutsPlugin extends Plugin {
  async onload() {
    this.selectedPath = null;
    this.explorerActive = false;
    this.registerDomEvent(this.app.workspace.containerEl, 'pointerdown', event => {
      const item = event.target instanceof Element ? event.target.closest(ITEM_SELECTOR) : null;
      this.explorerActive = Boolean(item);
      if (item) this.selectElement(item);
    }, true);
    this.registerDomEvent(document, 'keydown', event => this.handleKeydown(event), true);
    this.addCommand({ id: 'rename-selected-item', name: 'Rename selected file or folder', callback: () => this.renameSelected() });
    this.addCommand({ id: 'open-selected-item', name: 'Open selected file or folder', callback: () => this.openSelected() });
  }

  getExplorer() {
    return this.app.workspace.containerEl.querySelector('.nav-files-container');
  }

  isExplorerEvent(event) {
    const target = event.target;
    if (!this.explorerActive || !(target instanceof Node)) return false;
    return !(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement) && !target.isContentEditable;
  }

  visibleItems() {
    const explorer = this.getExplorer();
    if (!explorer) return [];
    return [...explorer.querySelectorAll(ITEM_SELECTOR)].filter(item => item.offsetParent !== null);
  }

  itemPath(item) {
    return item?.dataset.path || item?.closest('[data-path]')?.dataset.path || null;
  }

  selectedElement() {
    const items = this.visibleItems();
    return items.find(item => this.itemPath(item) === this.selectedPath) || items.find(item => item.classList.contains(SELECTED_CLASS)) || null;
  }

  selectElement(item) {
    for (const selected of this.app.workspace.containerEl.querySelectorAll(`.${SELECTED_CLASS}`)) selected.classList.remove(SELECTED_CLASS);
    item.classList.add(SELECTED_CLASS);
    this.selectedPath = this.itemPath(item);
    item.scrollIntoView({ block: 'nearest' });
  }

  moveSelection(delta) {
    const items = this.visibleItems();
    if (!items.length) return;
    const current = this.selectedElement();
    const index = current ? items.indexOf(current) : (delta > 0 ? -1 : items.length);
    this.selectElement(items[Math.max(0, Math.min(items.length - 1, index + delta))]);
  }

  async openSelected() {
    const item = this.selectedElement();
    const path = this.itemPath(item);
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
    else if (file instanceof TFolder) item?.click();
  }

  renameSelected() {
    const path = this.itemPath(this.selectedElement());
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (!(file instanceof TFile) && !(file instanceof TFolder)) return;
    new RenameModal(this.app, file, async targetPath => {
      await this.app.fileManager.renameFile(file, targetPath);
      this.selectedPath = targetPath;
    }).open();
  }

  toggleFolder(expand) {
    const item = this.selectedElement();
    if (!item?.classList.contains('nav-folder-title')) return false;
    const folder = item.closest('.nav-folder');
    const collapsed = folder?.classList.contains('is-collapsed');
    if ((expand && collapsed) || (!expand && !collapsed)) item.click();
    return true;
  }

  handleKeydown(event) {
    if (!this.isExplorerEvent(event) || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveSelection(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (!this.toggleFolder(true)) this.openSelected();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.toggleFolder(false);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.renameSelected();
    } else if (event.key === ' ') {
      event.preventDefault();
      this.openSelected();
    }
  }
};
