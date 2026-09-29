const { Notice, Plugin, TFile, TFolder } = require('obsidian');

const SELECTED_CLASS = 'cherrynik-explorer-selected';
const ITEM_SELECTOR = '.nav-file-title, .nav-folder-title';

module.exports = class ExplorerShortcutsPlugin extends Plugin {
  async onload() {
    const data = await this.loadData();
    this.trashHistory = Array.isArray(data?.trashHistory) ? data.trashHistory : [];
    this.renameHistory = Array.isArray(data?.renameHistory) ? data.renameHistory : [];
    this.renameRedoHistory = Array.isArray(data?.renameRedoHistory) ? data.renameRedoHistory : [];
    this.selectedPath = null;
    this.selectionRevision = 0;
    this.explorerActive = false;
    this.awaitingExplorerCreation = false;
    this.registerDomEvent(this.app.workspace.containerEl, 'pointerdown', event => {
      const target = event.target instanceof Element ? event.target : null;
      const item = target?.closest(ITEM_SELECTOR) || null;
      const fileExplorer = target?.closest('.workspace-leaf-content[data-type="file-explorer"], .nav-files-container') || null;
      const controlLabel = target?.closest('[aria-label]')?.getAttribute('aria-label') || '';
      this.awaitingExplorerCreation = fileExplorer && (controlLabel === 'New note' || controlLabel === 'New folder');
      this.explorerActive = Boolean(item || fileExplorer);
      if (item) this.selectElement(item);
      else if (fileExplorer) {
        this.clearSelection();
      } else {
        this.clearSelection();
      }
    }, true);
    this.registerDomEvent(this.app.workspace.containerEl, 'click', event => {
      const target = event.target instanceof Element ? event.target : null;
      const item = target?.closest(ITEM_SELECTOR) || null;
      const path = this.itemPath(item);
      if (!path) return;

      // Obsidian may move focus into the opened leaf after a file row is clicked.
      // Restore focus to the same explorer row once its own click handler has run,
      // so subsequent arrows, Enter and Escape all operate on one selection.
      const restoreExplorerFocus = () => {
        if (!this.explorerActive || this.selectedPath !== path) return;
        const current = this.elementForPath(path);
        if (!current) return;
        this.selectElement(current);
        this.focusElement(current);
      };
      requestAnimationFrame(restoreExplorerFocus);
      window.setTimeout(restoreExplorerFocus, 50);
    });
    this.registerEvent(this.app.vault.on('create', file => this.keepCreatedItemInExplorer(file)));
    // Run before Obsidian's document-level handlers so only one navigation and
    // rename state machine handles each key press.
    this.registerDomEvent(window, 'keydown', event => this.handleKeydown(event), true);
    this.addCommand({ id: 'rename-selected-item', name: 'Rename selected file or folder', callback: () => this.renameSelected() });
    this.addCommand({ id: 'open-selected-item', name: 'Open selected file or folder', callback: () => this.openSelected() });
    this.addCommand({ id: 'move-selected-item-to-trash', name: 'Move selected file or folder to trash', callback: () => this.moveSelectedToTrash() });
    this.addCommand({ id: 'restore-last-trashed-item', name: 'Restore last trashed file or folder', callback: () => this.restoreLastTrashed() });
  }

  getExplorer() {
    return this.app.workspace.containerEl.querySelector('.nav-files-container');
  }

  keepCreatedItemInExplorer(file) {
    if (!this.awaitingExplorerCreation || (!(file instanceof TFile) && !(file instanceof TFolder))) return;
    this.awaitingExplorerCreation = false;
    requestAnimationFrame(() => requestAnimationFrame(() => this.focusExplorerPath(file.path, true)));
  }

  focusExplorerPath(path, reveal = false) {
    this.selectedPath = path;
    this.explorerActive = true;
    let attempts = 0;
    const focusItem = () => {
      const item = this.elementForPath(path);
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && !activeElement.closest('.workspace-leaf-content[data-type="file-explorer"]')) {
        activeElement.blur();
      }
      if (!item) {
        if (attempts++ < 10) window.setTimeout(focusItem, 50);
        return;
      }
      this.selectElement(item);
      if (!item.hasAttribute('tabindex')) item.tabIndex = -1;
      item.focus({ preventScroll: true });
    };
    if (reveal) this.app.commands.executeCommandById('file-explorer:reveal-active-file');
    focusItem();
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

  explorerItemFromEvent(event) {
    const target = event.target instanceof Element ? event.target : null;
    const activeElement = document.activeElement instanceof Element ? document.activeElement : null;
    return this.selectedElement() || activeElement?.closest(ITEM_SELECTOR) || target?.closest(ITEM_SELECTOR) || null;
  }

  isExplorerShortcutContext(event) {
    return Boolean(this.explorerItemFromEvent(event)) || this.explorerActive;
  }

  visibleItems() {
    const explorer = this.getExplorer();
    if (!explorer) return [];
    return [...explorer.querySelectorAll(ITEM_SELECTOR)].filter(item => item.offsetParent !== null);
  }

  itemPath(item) {
    return item?.dataset.path || item?.closest('[data-path]')?.dataset.path || null;
  }

  clearSelection() {
    for (const selected of this.app.workspace.containerEl.querySelectorAll(`.${SELECTED_CLASS}`)) selected.classList.remove(SELECTED_CLASS);
    this.selectedPath = null;
    this.selectionRevision += 1;
  }

  selectedElement() {
    const items = this.visibleItems();
    return items.find(item => this.itemPath(item) === this.selectedPath) || items.find(item => item.classList.contains(SELECTED_CLASS)) || null;
  }

  elementForPath(path) {
    return path ? this.visibleItems().find(item => this.itemPath(item) === path) || null : null;
  }

  selectElement(item) {
    for (const selected of this.app.workspace.containerEl.querySelectorAll(`.${SELECTED_CLASS}`)) {
      if (selected !== item) selected.classList.remove(SELECTED_CLASS);
    }
    item.classList.add(SELECTED_CLASS);
    this.selectedPath = this.itemPath(item);
    this.selectionRevision += 1;
    item.scrollIntoView({ block: 'nearest' });
  }

  focusElement(item) {
    if (!item) return;
    if (!item.hasAttribute('tabindex')) item.tabIndex = -1;
    item.focus({ preventScroll: true });
  }

  moveSelection(delta) {
    const items = this.visibleItems();
    if (!items.length) return;
    const current = this.selectedElement();
    const index = current ? items.indexOf(current) : (delta > 0 ? -1 : items.length);
    const nextItem = items[Math.max(0, Math.min(items.length - 1, index + delta))];
    this.selectElement(nextItem);
    this.focusElement(nextItem);
  }

  async openSelected() {
    const item = this.selectedElement();
    const path = this.itemPath(item);
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
    else if (file instanceof TFolder) item?.click();
  }

  async saveHistory() {
    await this.saveData({
      trashHistory: this.trashHistory.slice(-100),
      renameHistory: this.renameHistory.slice(-100),
      renameRedoHistory: this.renameRedoHistory.slice(-100)
    });
  }

  async ensureFolder(path) {
    if (!path || path === '/') return;
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (await this.app.vault.adapter.exists(current)) continue;
      await this.app.vault.adapter.mkdir(current);
    }
  }

  async uniqueTrashPath(originalPath) {
    const directPath = `.trash/${originalPath}`;
    if (!(await this.app.vault.adapter.exists(directPath))) return directPath;
    const slash = originalPath.lastIndexOf('/');
    const parent = slash >= 0 ? originalPath.slice(0, slash + 1) : '';
    const name = slash >= 0 ? originalPath.slice(slash + 1) : originalPath;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    let candidate = `.trash/${parent}${stem} — deleted ${timestamp}${extension}`;
    let suffix = 2;
    while (await this.app.vault.adapter.exists(candidate)) {
      candidate = `.trash/${parent}${stem} — deleted ${timestamp} (${suffix})${extension}`;
      suffix += 1;
    }
    return candidate;
  }

  async moveSelectedToTrash(preferredItem = null) {
    const item = preferredItem || this.selectedElement();
    const activeFile = this.explorerActive ? this.app.workspace.getActiveFile() : null;
    const originalPath = this.itemPath(item) || activeFile?.path || null;
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
    const trashPath = await this.uniqueTrashPath(originalPath);
    const trashParent = trashPath.includes('/') ? trashPath.slice(0, trashPath.lastIndexOf('/')) : '';

    try {
      await this.ensureFolder(trashParent);
      await this.app.vault.adapter.rename(originalPath, trashPath);
      this.trashHistory.push({ originalPath, trashPath, deletedAt: Date.now() });
      await this.saveHistory();
      this.explorerActive = true;
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
    while (historyIndex >= 0) {
      entry = this.trashHistory[historyIndex];
      if (await this.app.vault.adapter.exists(entry.trashPath)) break;
      this.trashHistory.splice(historyIndex, 1);
      historyIndex -= 1;
    }
    if (!entry || !(await this.app.vault.adapter.exists(entry.trashPath))) {
      await this.saveHistory();
      new Notice('Nothing to restore from Trash.');
      return;
    }
    if (await this.app.vault.adapter.exists(entry.originalPath)) {
      new Notice(`Cannot restore: ${entry.originalPath} already exists.`);
      return;
    }

    const originalParent = entry.originalPath.includes('/') ? entry.originalPath.slice(0, entry.originalPath.lastIndexOf('/')) : '';
    try {
      await this.ensureFolder(originalParent);
      await this.app.vault.adapter.rename(entry.trashPath, entry.originalPath);
      this.trashHistory.splice(historyIndex, 1);
      await this.saveHistory();
      this.selectedPath = entry.originalPath;
      this.explorerActive = true;
      requestAnimationFrame(() => {
        const restored = this.elementForPath(entry.originalPath);
        if (restored) this.selectElement(restored);
      });
      new Notice(`${entry.originalPath} restored.`);
    } catch (error) {
      new Notice(`Could not restore: ${error?.message || error}`);
    }
  }

  async undoLastRename() {
    const entry = this.renameHistory.at(-1);
    if (!entry) return false;
    const file = this.app.vault.getAbstractFileByPath(entry.toPath);
    if (!(file instanceof TFile) && !(file instanceof TFolder)) return false;
    if (this.app.vault.getAbstractFileByPath(entry.fromPath)) {
      new Notice(`Cannot undo rename: ${entry.fromPath} already exists.`);
      return true;
    }
    try {
      await this.app.fileManager.renameFile(file, entry.fromPath);
      this.renameHistory.pop();
      this.renameRedoHistory.push(entry);
      await this.saveHistory();
      this.focusExplorerPath(entry.fromPath, false);
      return true;
    } catch (error) {
      new Notice(`Could not undo rename: ${error?.message || error}`);
      return true;
    }
  }

  async redoLastRename() {
    const entry = this.renameRedoHistory.at(-1);
    if (!entry) return false;
    const file = this.app.vault.getAbstractFileByPath(entry.fromPath);
    if (!(file instanceof TFile) && !(file instanceof TFolder)) return false;
    if (this.app.vault.getAbstractFileByPath(entry.toPath)) {
      new Notice(`Cannot redo rename: ${entry.toPath} already exists.`);
      return true;
    }
    try {
      await this.app.fileManager.renameFile(file, entry.toPath);
      this.renameRedoHistory.pop();
      this.renameHistory.push(entry);
      await this.saveHistory();
      this.focusExplorerPath(entry.toPath, false);
      return true;
    } catch (error) {
      new Notice(`Could not redo rename: ${error?.message || error}`);
      return true;
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
      const restoreRevision = this.selectionRevision;
      finished = true;
      stopEditing();
      if (label.isConnected) label.textContent = previousContent;
      requestAnimationFrame(() => {
        if (this.selectionRevision !== restoreRevision) return;
        this.focusExplorerPath(file.path, false);
      });
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
      const renameRevision = this.selectionRevision;
      try {
        const sourcePath = file.path;
        await this.app.fileManager.renameFile(file, targetPath);
        this.renameHistory.push({ fromPath: sourcePath, toPath: targetPath, renamedAt: Date.now() });
        this.renameRedoHistory = [];
        await this.saveHistory();
        requestAnimationFrame(() => {
          if (this.selectionRevision !== renameRevision) return;
          this.focusExplorerPath(targetPath, false);
        });
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
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        restore();
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.selectElement(item);
        label.focus({ preventScroll: true });
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

  folderElement(item) {
    return item?.classList.contains('nav-folder-title') ? item.closest('.nav-folder') : null;
  }

  parentFolderTitle(item) {
    const path = this.itemPath(item);
    const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    const parentPath = file?.parent?.path;
    return parentPath && parentPath !== '/' ? this.elementForPath(parentPath) : null;
  }

  firstFolderChild(item) {
    const folderPath = this.itemPath(item);
    if (!folderPath) return null;
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) return null;
    const childPaths = new Set(folder.children.map(child => child.path));
    return this.visibleItems().find(candidate => childPaths.has(this.itemPath(candidate))) || null;
  }

  navigateRight() {
    const item = this.selectedElement();
    const folder = this.folderElement(item);
    if (!item || !folder) return;
    const child = this.firstFolderChild(item);
    if (!child) {
      const path = this.itemPath(item);
      item.click();
      requestAnimationFrame(() => {
        const current = this.elementForPath(path);
        if (current) {
          this.selectElement(current);
          this.focusElement(current);
        }
      });
      return;
    }
    this.selectElement(child);
    this.focusElement(child);
  }

  navigateLeft() {
    const item = this.selectedElement();
    if (!item) return;
    const folder = this.folderElement(item);
    if (folder && this.firstFolderChild(item)) {
      const path = this.itemPath(item);
      item.click();
      requestAnimationFrame(() => {
        const current = this.elementForPath(path);
        if (current) {
          this.selectElement(current);
          this.focusElement(current);
        }
      });
      return;
    }
    const parent = this.parentFolderTitle(item);
    if (parent) {
      this.selectElement(parent);
      this.focusElement(parent);
    }
  }

  handleKeydown(event) {
    const primaryModifier = event.metaKey || event.ctrlKey;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.cherrynik-explorer-renaming, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
    const explorerShortcutContext = this.isExplorerShortcutContext(event);
    if (explorerShortcutContext && primaryModifier && !event.altKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.shiftKey) void this.redoLastRename();
      else void this.undoLastRename().then(handled => { if (!handled) void this.restoreLastTrashed(); });
      return;
    }
    if (explorerShortcutContext && ((event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.key === 'Backspace') ||
        (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.key === 'Delete'))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.moveSelectedToTrash(this.explorerItemFromEvent(event));
      return;
    }
    if (!this.isExplorerEvent(event)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.moveSelection(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.navigateRight();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.navigateLeft();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.renameSelected();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const selected = this.selectedElement();
      if (selected) {
        this.selectElement(selected);
        this.focusElement(selected);
      }
    } else if (event.key === ' ') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.openSelected();
    }
  }
};
