const { Notice, Plugin, TFile, TFolder } = require('obsidian');

const SELECTED_CLASS = 'cherrynik-explorer-selected';
const ITEM_SELECTOR = '.nav-file-title, .nav-folder-title';

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
    const item = this.selectedElement();
    const path = this.itemPath(item);
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (!item || (!(file instanceof TFile) && !(file instanceof TFolder))) return;

    const label = item.querySelector('.nav-file-title-content, .nav-folder-title-content');
    if (!label || label.querySelector('input')) return;

    const extension = file instanceof TFile && file.extension ? `.${file.extension}` : '';
    const currentName = file.name.slice(0, file.name.length - extension.length);
    const previousContent = label.textContent;
    const input = document.createElement('input');
    input.className = 'cherrynik-explorer-rename-input';
    input.type = 'text';
    input.value = currentName;
    input.setAttribute('aria-label', `Rename ${file.name}`);
    label.textContent = '';
    label.appendChild(input);
    item.classList.add('cherrynik-explorer-renaming');

    let finished = false;
    const restore = () => {
      if (finished) return;
      finished = true;
      item.classList.remove('cherrynik-explorer-renaming');
      if (label.isConnected) label.textContent = previousContent;
    };
    const submit = async () => {
      if (finished) return;
      const name = input.value.trim();
      if (!name || name.includes('/')) {
        new Notice('Use a non-empty name without slashes.');
        input.focus();
        return;
      }
      const parentPath = file.parent?.path;
      const targetPath = parentPath && parentPath !== '/' ? `${parentPath}/${name}${extension}` : `${name}${extension}`;
      if (targetPath === file.path) return restore();
      if (this.app.vault.getAbstractFileByPath(targetPath)) {
        new Notice('A file or folder with this name already exists.');
        input.focus();
        input.select();
        return;
      }
      finished = true;
      try {
        await this.app.fileManager.renameFile(file, targetPath);
        this.selectedPath = targetPath;
      } catch (error) {
        finished = false;
        new Notice(`Could not rename: ${error?.message || error}`);
        input.focus();
      }
    };

    input.addEventListener('pointerdown', event => event.stopPropagation());
    input.addEventListener('click', event => event.stopPropagation());
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        restore();
      }
    });
    input.addEventListener('blur', () => submit());
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
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
