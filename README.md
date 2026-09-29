# CherryNIK Explorer Shortcuts

A small Obsidian plugin that adds Finder-style keyboard controls to the built-in Files panel without replacing its interface.

- `Arrow Up` / `Arrow Down`: move the selection
- `Arrow Right` / `Arrow Left`: expand or collapse folders
- `Space`: open the selected file
- `Enter`: rename the selected file or folder directly in the Files row
- `Left` / `Right` while renaming: move the text cursor without navigating the tree
- `Cmd+Backspace` on macOS or `Delete` on Windows: move the selected item to the vault's `.trash` folder
- `Cmd+Z` on macOS or `Ctrl+Z` on Windows: restore the last item deleted through this plugin

Delete and undo also work immediately after creating a file from the Files panel.

Creating a note or folder from the Files toolbar leaves the new item selected in the sidebar. Press `Enter` to start inline rename; click the editor content to move keyboard focus into the note.

The commands can also be assigned through Obsidian's **Hotkeys** settings. The plugin keeps the last 100 deletion records across app restarts so undo remains available after reopening Obsidian.

## BRAT installation

Add `cherrynik/obsidian-explorer-shortcuts` in BRAT after the first GitHub release is published.

## License

MIT
