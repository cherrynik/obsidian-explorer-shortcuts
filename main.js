const { Notice, Plugin, TFile, TFolder } = require('obsidian');

const SELECTED_CLASS = 'cherrynik-explorer-selected';
const ITEM_SELECTOR = '.nav-file-title, .nav-folder-title';

module.exports = class ExplorerShortcutsPlugin extends Plugin {
  async onload() {
    const data = await this.loadData();
    this.trashHistory = Array.isArray(data?.trashHistory) ? data.trashHistory : [];
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
    this.addCommand({ id: 'move-selected-item-to-trash', name: 'Move selected file or folder to trash', callback: () => this.moveSelectedToTrash() });
    this.addCommand({ id: 'restore-last-trashed-item', name: 'Restore last trashed file or folder', callback: () => this.restoreLastTrashed() });
  }

  getExplorer() {
    return this.app.workspace.containerEl.querySelector('.nav-files-container');
  }

  isExplorerEvent(event) {
    const target = event.target;
    if (!this.explorerActive || !(target instanceof Node)) return false;
    const activeElement = document.activeElement;
    if (activeElement instanceof Element && activeElement.closest('.cherrynik-explorer-renaming')) return false;
    const element = target instanceof Element ? target : target.parentElement;
    if (element?.closest('[contenteditable="true"], [contenteditable="plaintext-only"], .cherrynik-explorer-renaming')) return false;
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

  elementForPath(path) {
    return path ? this.visibleItems().find(item => this.itemPath(item) === path) || null : null;
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

  async saveTrashHistory() {
    await this.saveData({ trashHistory: this.trashHistory.slice(-100) });
  }

  async ensureFolder(path) {
    if (!path || path === '/') return;
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`${current} already exists and is not a folder`);
      await this.app.vault.createFolder(current);
    }
  }

  uniqueTrashPath(originalPath) {
    const directPath = `.trash/${originalPath}`;
    if (!this.app.vault.getAbstractFileByPath(directPath)) return directPath;
    const slash = originalPath.lastIndexOf('/');
    const parent = slash >= 0 ? originalPath.slice(0, slash + 1) : '';
    const name = slash >= 0 ? originalPath.slice(slash + 1) : originalPath;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `.trash/${parent}${stem} — deleted ${timestamp}${extension}`;
  }

  async moveSelectedToTrash() {
    const item = this.selectedElement();
    const originalPath = this.itemPath(item);
    const file = originalPath ? this.app.vault.getAbstractFileByPath(originalPath) : null;
    if (!(file instanceof TFile) && !(file instanceof TFolder)) return;
    if (originalPath === '.trash' || originalPath.startsWith('.trash/')) {
      new Notice('This item is already in Trash.');
      return;
    }

    const items = this.visibleItems();
    const selectedIndex = item ? items.indexOf(item) : -1;
    const fallbackPath = this.itemPath(items[selectedIndex + 1]) || this.itemPath(items[selectedIndex - 1]);
    const displayName = file.name;
    const trashPath = this.uniqueTrashPath(originalPath);
    const trashParent = trashPath.includes('/') ? trashPath.slice(0, trashPath.lastIndexOf('/')) : '';

    try {
      await this.ensureFolder(trashParent);
      await this.app.fileManager.renameFile(file, trashPath);
      this.trashHistory.push({ originalPath, trashPath, deletedAt: Date.now() });
      await this.saveTrashHistory();
      this.selectedPath = fallbackPath || null;
      requestAnimationFrame(() => {
        const fallback = this.elementForPath(fallbackPath);
        if (fallback) this.selectElement(fallback);
      });
      new Notice(`${displayName} moved to Trash. Press Cmd/Ctrl+Z to restore.`);
    } catch (error) {
      new Notice(`Could not move to Trash: ${error?.message || error}`);
    }
  }

  async restoreLastTrashed() {
    let historyIndex = this.trashHistory.length - 1;
    let entry = null;
    let file = null;
    while (historyIndex >= 0) {
      entry = this.trashHistory[historyIndex];
      file = this.app.vault.getAbstractFileByPath(entry.trashPath);
      if (file instanceof TFile || file instanceof TFolder) break;
      this.trashHistory.splice(historyIndex, 1);
      historyIndex -= 1;
    }
    if (!entry || (!(file instanceof TFile) && !(file instanceof TFolder))) {
      await this.saveTrashHistory();
      new Notice('Nothing to restore from Trash.');
      return;
    }
    if (this.app.vault.getAbstractFileByPath(entry.originalPath)) {
      new Notice(`Cannot restore: ${entry.originalPath} already exists.`);
      return;
    }

    const originalParent = entry.originalPath.includes('/') ? entry.originalPath.slice(0, entry.originalPath.lastIndexOf('/')) : '';
    try {
      await this.ensureFolder(originalParent);
      await this.app.fileManager.renameFile(file, entry.originalPath);
      this.trashHistory.splice(historyIndex, 1);
      await this.saveTrashHistory();
      this.selectedPath = entry.originalPath;
      requestAnimationFrame(() => {
        const restored = this.elementForPath(entry.originalPath);
        if (restored) this.selectElement(restored);
      });
      new Notice(`${entry.originalPath} restored.`);
    } catch (error) {
      new Notice(`Could not restore: ${error?.message || error}`);
    }
  }

  renameSelected() {
    const item = this.selectedElement();
    const path = this.itemPath(item);
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (!item || (!(file instanceof TFile) && !(file instanceof TFolder))) return;

    const label = item.querySelector('.nav-file-title-content, .nav-folder-title-content');
    if (!label || label.isContentEditable) return;

    const extension = file instanceof TFile && file.extension ? `.${file.extension}` : '';
    const currentName = file.name.slice(0, file.name.length - extension.length);
    const previousContent = label.textContent;
    label.textContent = currentName;
    label.contentEditable = 'true';
    label.spellcheck = false;
    label.setAttribute('role', 'textbox');
    label.setAttribute('aria-label', `Rename ${file.name}`);
    item.classList.add('cherrynik-explorer-renaming');

    let finished = false;
    const stopEditing = () => {
      item.classList.remove('cherrynik-explorer-renaming');
      label.removeAttribute('contenteditable');
      label.removeAttribute('spellcheck');
      label.removeAttribute('role');
      label.removeAttribute('aria-label');
    };
    const selectName = () => {
      const range = document.createRange();
      range.selectNodeContents(label);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    };
    const restore = () => {
      if (finished) return;
      finished = true;
      stopEditing();
      if (label.isConnected) label.textContent = previousContent;
    };
    const submit = async () => {
      if (finished) return;
      const name = label.textContent.replace(/[\r\n]+/g, ' ').trim();
      if (!name || name.includes('/')) {
        new Notice('Use a non-empty name without slashes.');
        label.focus();
        selectName();
        return;
      }
      const parentPath = file.parent?.path;
      const targetPath = parentPath && parentPath !== '/' ? `${parentPath}/${name}${extension}` : `${name}${extension}`;
      if (targetPath === file.path) return restore();
      if (this.app.vault.getAbstractFileByPath(targetPath)) {
        new Notice('A file or folder with this name already exists.');
        label.focus();
        selectName();
        return;
      }
      finished = true;
      stopEditing();
      label.textContent = name;
      try {
        await this.app.fileManager.renameFile(file, targetPath);
        this.selectedPath = targetPath;
      } catch (error) {
        finished = false;
        new Notice(`Could not rename: ${error?.message || error}`);
        label.contentEditable = 'true';
        item.classList.add('cherrynik-explorer-renaming');
        label.focus();
        selectName();
      }
    };

    label.addEventListener('pointerdown', event => event.stopPropagation(), { once: true });
    label.addEventListener('keydown', event => {
      event.stopPropagation();
      if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        const textNode = label.firstChild;
        if (!textNode) return;
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        if (!range.collapsed && !event.shiftKey) {
          const offset = direction < 0 ? 0 : textNode.textContent.length;
          range.setStart(textNode, offset);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
        } else if (selection.modify) {
          selection.modify(event.shiftKey ? 'extend' : 'move', direction < 0 ? 'backward' : 'forward', 'character');
        }
      } else if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        restore();
      }
    });
    label.addEventListener('blur', () => submit(), { once: true });
    label.addEventListener('paste', event => {
      event.preventDefault();
      document.execCommand('insertText', false, event.clipboardData?.getData('text/plain').replace(/[\r\n]+/g, ' ') || '');
    });
    requestAnimationFrame(() => {
      label.focus();
      selectName();
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
    if (!this.isExplorerEvent(event)) return;
    const primaryModifier = event.metaKey || event.ctrlKey;
    if (primaryModifier && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      this.restoreLastTrashed();
      return;
    }
    if ((event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.key === 'Backspace') ||
        (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.key === 'Delete')) {
      event.preventDefault();
      this.moveSelectedToTrash();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
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
