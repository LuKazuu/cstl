# CSTL-NEXT

Original by Atho64
Fork by Aera

[https://lukazuu.github.io/cstl/](https://lukazuu.github.io/cstl/)

## What this is

CSTL-NEXT is a browser based tool for translating visual novel text or anything (up to you) with the help of an AI model. You import the original text, work through it in an editor built for line by line translation, copy batches of lines out to paste into whatever AI chat you use, paste the result back in, and export the finished translation in the same format you imported. Everything runs locally in the browser. There is no server component and no account system, all your projects live in the browser's own storage.

## Core workflow

1. **Import** a script. Supported inputs are `.json` and `.epub` files (single file, a folder of files, or a `.zip` of files), plus anything a plugin adds support for.
2. **Translate.** Select a range of lines, hit Copy for AI, and the tool formats those lines into a prompt block ready to paste into an AI chat window.
3. **Apply.** Paste the AI's reply back into the result box and apply it. The tool matches the reply back to the right lines and fills in the translation column.
4. **Repeat** through the rest of the script, using search, bookmarks, and the glossary to stay consistent.
5. **Export** the finished translation, either back into the original file format or as a full project backup.

### Copy for AI / Apply

This is the heart of the tool. Copy for AI bundles the selected lines into a single block of text with a system prompt in front of it, so you can paste the whole thing into an AI chat in one go. The default prompt asks for a plain English translation with formatting and line numbering preserved, and the block is fenced so the model's reply is easy to extract. Apply takes the model's reply back out of the paste box, matches it against the lines you had selected, and writes the result into your project.

### Context and running summary

Long scripts lose continuity once you're translating them a batch at a time, an AI model has no memory of a character introduced 200 lines ago. The Context panel lets you keep a running summary of characters and plot that gets folded into future prompts, so continuity survives across many separate AI conversations. This is optional and off by default.

### Glossary

A per project name glossary keeps character and term translations consistent across the whole script. Names can be added by hand, or pulled automatically from [VNDB](https://vndb.org) if you give the tool a VNDB character or visual novel ID, useful for keeping official romanizations consistent without typing them all in yourself.

### Proofreading

A find and replace pass across the whole project, with case sensitivity, whole word matching, regex, and a toggle to search only translated lines. Useful for a final consistency pass after a glossary term changes partway through a project.

### Undo, redo, bookmarks

Standard undo/redo history while editing. Bookmarks let you flag specific lines to jump back to later, handy for marking spots that need a second look.

## Projects and storage

Everything is stored in the browser's Origin Private File System (OPFS), which is private, sandboxed storage per site, not visible in a normal Downloads folder and not synced anywhere unless you export it yourself.

```
OPFS root
├── app/
│   ├── shortcuts.json         keyboard shortcut bindings
│   └── plugin-settings.json   global plugin settings (project-scoped plugin settings live in each project)
├── plugins/
│   ├── index.json             installed plugin list (cache, rebuildable)
│   └── <pluginId>/
│       ├── manifest.json      extracted plugin manifest
│       ├── plugin.js          extracted plugin entry code
│       └── assets/...         any other files the plugin shipped
└── projects/
    ├── index.json              project index (cache, rebuildable)
    └── <projectId>/            one self-contained folder per project
        ├── project.json        the project data (lines, settings, etc.)
        ├── media/               binary assets (EPUB binary, plugin-extracted images)
        └── data/                per-project plugin data storage
            └── <pluginId>/
                └── <key>
```

Each project is fully self-contained. Back it up by zipping the project folder, restore by unzipping into a new project ID, delete by removing the folder. There are no orphan files left behind by normal use.

`project.json` carries an internal schema version. If a future update changes that schema, older projects are migrated automatically the next time they're opened; a project newer than the running app (e.g. after rolling back to an older CSTL build) is refused with a clear message instead of being read incorrectly.

A built-in OPFS explorer lets you browse this storage directly from the app, and a full backup/restore flow (`.cstl` files) covers a single project or everything at once, including installed plugins and the contents of `app/` (keyboard shortcuts and global plugin settings).

### Export options

You're not locked into one output. You can export just the translation, just the untranslated lines, just the original text, the whole project as a portable backup, or push through whatever custom export a plugin defines.

## Settings worth knowing about

These are per-project settings, saved into each project's `project.json`, so each project keeps its own copy. Changing them in one project doesn't affect any other.

- **Increment numbering.** Optionally auto-number export filenames or line IDs by a fixed step (default 100), leaving room to insert lines later without renumbering everything.
- **Jump to context.** Automatically opens the context panel when you open a line, if you rely on the running summary feature.
- **Ignore name column.** Lets you exclude the character name field from AI prompts and matching, for scripts that don't separate names from dialogue.
- **Hide tools.** Collapses the toolbar for a cleaner, distraction-free editing view.
- **EPUB tags.** Which HTML tags inside an EPUB are treated as translatable text (defaults to paragraph tags).

## Keyboard shortcuts

All shortcuts are rebindable from the Shortcuts panel. Defaults while a project is open:

| Shortcut | Action |
|---|---|
| Alt+E | Export project |
| Alt+R | Open find & replace |
| Alt+G | Open glossary |
| Alt+X | Open context |
| Alt+S | Open project settings |
| Alt+T | Show/hide toolbar |
| Alt+B | Back to dashboard |
| Alt+A | Select all lines |
| Alt+Q | Clear selection |
| Alt+L | Select line range |
| Alt+C | Copy for AI |
| Alt+V | Focus AI result box |
| Ctrl+Enter | Apply translation |
| Alt+Z / Alt+Y | Undo / redo |
| Alt+M | Open bookmark panel |

## Plugin System

Plugins run directly in the main document with full access to DOM, network, storage, and browser APIs. There is no sandbox, no iframe, no consent prompts, no permission gates, and no rate limits. A plugin can do anything the app itself can do.

This is a deliberate tradeoff: it's what makes it possible for a plugin to add support for a new file format, run a WASM based text decoder, call out to any API, or draw a custom UI panel, without CSTL-NEXT needing to anticipate every use case in advance. It also means you should only install plugins you trust, the same way you'd only install a browser extension you trust.

### Package format

A plugin is uploaded as a `.zip` file. At install time the zip is extracted to `plugins/<id>/` and the original zip is discarded. The plugin folder becomes:

```
plugins/<pluginId>/
├── manifest.json
├── plugin.js
└── assets/         optional
```

### manifest.json

```json
{
  "manifest_version": 1,
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "What it does",
  "extensions": [".txt"],
  "magic": [{"hex": "504b0304", "offset": 0}],
  "ui": {"title": "Panel Title", "height": 300},
  "settings": {
    "global": [{"key": "foo", "label": "Foo", "type": "string", "default": "bar"}],
    "project": [{"key": "count", "label": "Count", "type": "number", "default": 0}]
  }
}
```

`manifest_version`, `id`, `name`, and `version` are required. Everything else is optional. `manifest_version` is the plugin contract version the plugin was authored against (manifest schema + API surface combined into one number). Older versions keep working after the host updates. A plugin declaring a `manifest_version` *newer* than the host supports is rejected at install time with a message telling the user to update CSTL. `version` is the plugin's own release version (semver recommended). `extensions` and `magic` are how a plugin claims files, by file extension and/or by byte signature (magic bytes), so the app knows which plugin should handle a given import.

### plugin.js

```js
module.exports = {
  activate(api) {},
  deactivate() {},
  panel(rootEl, api) {},
  extract({ fileName, buffer, settings, globalSettings, api }) { return { lines: [...] }; },
  pack({ lines, sourceMap, projectName, settings, globalSettings, api }) { return { blob, filename }; },
  onCopy(text, ctx) { return text; },
  onApply(text, ctx) { return text; },
  onSettings({ settings, globalSettings }) {},
};
```

`extract` and `pack` are the two most important hooks for adding a new file format: extract turns a raw imported file into translation lines, pack turns edited lines back into an exportable file. `onCopy` and `onApply` let a plugin transform text on its way out to the AI prompt or on its way back in, useful for stripping or restoring formatting the model shouldn't see directly. `sourceMap` in `pack` is the plugin's own per-project saved data (the same shape `extract` may return under a `sourceMap` key and what `api.saveData` writes), letting a plugin round-trip format-specific metadata through the project lifecycle.

### Plugin API

Available in `activate(api)`, `panel(root, api)`, `extract({api})`, `pack({api})`:

| Method | Description |
|---|---|
| `api.version` | Host's current plugin contract version |
| `api.pluginId` | Plugin ID |
| `api.settings` | Project-scoped settings |
| `api.globalSettings` | Global settings |
| `api.getProject()` | Active project info |
| `api.getLines()` | All translation lines |
| `api.getSelection()` | Selected line numbers |
| `api.selectRange(from, to)` | Select line range |
| `api.clearSelection()` | Clear selection |
| `api.copySelection()` | Trigger copy for AI |
| `api.listAssets()` | List plugin asset paths |
| `api.asset(path)` | Read asset as Uint8Array |
| `api.assetText(path)` | Read asset as string |
| `api.toast(msg)` | Show toast |
| `api.copy(text)` | Copy to clipboard |
| `api.pickFile(accept)` | Pick file (returns `{name, buffer}`) |
| `api.download(data, filename)` | Download file |
| `api.fetch(url, opts)` | HTTP fetch, no restrictions |
| `api.JSZip` | JSZip library |
| `api.gpu` | navigator.gpu (WebGPU) |
| `api.wasm(source, imports)` | Instantiate WASM (returns `{ instance, module }`) |
| `api.saveData(key, data)` | Save per-project data |
| `api.loadData(key)` | Load per-project data |
| `api.deleteData(key)` | Delete per-project data |
| `api.listData()` | List per-project data keys |
| `api.dataExists(key)` | Check data existence |
| `api.decode(buf, encodings?)` | Decode bytes with auto-detection |
| `api.on(event, handler)` | Subscribe to event |
| `api.off(token)` | Unsubscribe |
| `api.emit(event, payload)` | Emit a custom event other plugins can hear |
| `api.abort()` | Abort all in-flight operations |
| `api.addMenuItem(menu, label, onClick)` | Add a button to the Import or Export dropdown menu |
| `api.removeMenuItem(handle)` | Remove a menu item added earlier |
| `api.addSettingsSection(target, title, hooks)` | Add a card to the Settings, Glossary, or Context (Summary) modal |
| `api.removeSettingsSection(handle)` | Remove a settings section added earlier |
| `api.ui(name)` | Get the real DOM element for a named part of the app's UI |
| `api.hook(name, fn)` | Register a hook handler (returns token) |
| `api.unhook(token)` | Unregister a hook handler |
| `api.registerImporter(name, handler)` | Register a custom importer shown in the Import menu |
| `api.unregisterImporter(name)` | Remove a registered importer |
| `api.registerExporter(name, handler)` | Register a custom exporter shown in the Export menu |
| `api.unregisterExporter(name)` | Remove a registered exporter |
| `api.registerShortcut(id, label, combo, handler, opts)` | Register a keyboard shortcut |
| `api.unregisterShortcut(id)` | Remove a registered shortcut |
| `api.addToolbarButton(label, onClick, opts)` | Add a button to the workspace toolbar |
| `api.removeToolbarButton(btn)` | Remove a toolbar button |
| `api.createModal(title, bodyHtml, opts)` | Create and show a custom modal dialog |
| `api.closeModal(modal)` | Close a modal created with `createModal` |
| `api.addDashboardCard(cardEl)` | Add a card to the project dashboard |
| `api.removeDashboardCard(cardEl)` | Remove a dashboard card |
| `api.setTheme(vars)` | Override CSS variables (e.g. `{ '--accent': '#ff6fae' }`) |
| `api.injectStyle(css, id)` | Inject a `<style>` element into the document head |
| `api.removeStyle(id)` | Remove an injected style |
| `api.getState()` | Get a read-only snapshot of the app state |
| `api.getStorage()` | Get the OPFS root directory handle |
| `api.getPluginMeta()` | Get this plugin's own manifest metadata |
| `api.getLine(num)` | Get a single translation line by number |
| `api.updateLine(num, changes)` | Update fields on a line (message, name, trans_message, trans_name, is_translated) |
| `api.addLine(line)` | Add a new line to the project |
| `api.removeLine(num)` | Remove a line from the project |
| `api.markTranslated(num, transMsg, transName)` | Mark a line as translated |
| `api.prompt(title, def)` | Show a custom prompt modal (returns Promise<string|null>) |
| `api.confirm(title, body)` | Show a custom confirm modal (returns Promise<boolean\|null>) |
| `api.alert(title, body)` | Show an in-app alert toast (returns Promise) |

### Changing the app's own UI

Plugins already have unrestricted `document` access, covered above, so there was never a hard limit on what a plugin could touch. What was missing was a stable way to find the right element without guessing at internal ids and classes that could change on any update. `api.ui(name)` closes that gap: it hands back the actual live element for a documented set of names, so a plugin can read it, restyle it, replace its contents, attach new event listeners, or remove it outright, same as any other DOM node, just without having to reverse engineer the markup first.

| Name | What it points to |
|---|---|
| `importMenu` | The Import dropdown menu |
| `exportMenu` | The Export dropdown menu |
| `settingsModal` | The main Settings modal |
| `glossaryModal` | The Glossary modal |
| `summaryModal` | The Context (Summary) modal |
| `toolsPanel` | The right hand Tools panel |
| `textPanel` | The left hand Text panel |
| `previewContainer` | The scrollable list of translation lines inside the Text panel |
| `toolbar` | The workspace toolbar |
| `toolbarActions` | The toolbar actions group (where import/export buttons live) |
| `pluginPanels` | The container plugin panels get appended into |
| `dashboard` | The project dashboard view |
| `dashboardContent` | The dashboard content area (parent of the project list) |
| `lineEditorModal` | The line editor modal |
| `lineEditorBody` | The body of the line editor modal |
| `proofreadModal` | The Search & Replace modal |
| `proofreadContainer` | The results list inside the Search & Replace modal |
| `namePanel` | The name list table wrapper |
| `pasteArea` | The AI result textarea |
| `progressOverlay` | The busy/progress overlay |
| `progressText` | The progress text in the Text panel header |
| `heroBar` | The dashboard hero bar |
| `bookmarkPanel` | The bookmark side panel |
| `bookmarkList` | The bookmark list inside the panel |
| `selectionRange` | The select-by-line row |
| `shortcutsModal` | The keyboard shortcuts modal |
| `dashboardSettingsModal` | The dashboard settings modal |
| `pluginManagerModal` | The plugin manager modal |
| `opfsExplorerModal` | The OPFS file explorer modal |

```js
activate(api) {
  const panel = api.ui('toolsPanel');
  panel.style.setProperty('--accent', '#ff6fae');

  api.ui('previewContainer').addEventListener('dblclick', e => {
    if (e.target.closest('.preview-row')) api.toast('Double clicked a line.');
  });
}
```

`addMenuItem` and `addSettingsSection` are the higher level, structured versions of the same idea, for the two most common cases: adding a button to a menu, or adding a whole settings card. `target` for `addSettingsSection` is `'settings'`, `'glossary'`, or `'summary'`. Both are registered against the plugin instance and torn down automatically when the plugin is disabled, unlike anything a plugin attaches by hand through `api.ui()`, which the plugin is responsible for cleaning up itself in `deactivate()` if it shouldn't outlive the plugin being turned off.

```js
activate(api) {
  api.addMenuItem('export', 'Export My Format', () => {
    api.download('hello', 'output.txt');
  });

  api.addSettingsSection('summary', 'My Plugin', {
    async render(container) {
      const saved = await api.loadData('myFlag').catch(() => false);
      container.innerHTML = '<label class="check-line"><input id="myFlag" type="checkbox" />Enable thing</label>';
      container.querySelector('#myFlag').checked = !!saved;
    },
    onSave() {
      api.saveData('myFlag', document.getElementById('myFlag').checked);
    }
  });
}
```

`render(container)` is called with an empty container every time that modal is opened, so it should rebuild its contents from scratch rather than assuming they're already there. `onSave()` runs when the user clicks that modal's own save button, alongside the app's own built-in fields for that same modal.

### Direct global access

Plugins run via `new Function('module', 'exports', 'CSTL', 'document', 'window', code)` in the main document scope. The following are all directly accessible as globals, no need to go through `api`:

- `document`, `window`: full DOM access
- `navigator`, `location`, `history`: browser APIs
- `console`, `crypto`, `fetch`: platform APIs
- `Worker`, `SharedWorker`, `BroadcastChannel`: concurrency
- `WebAssembly`, `SharedArrayBuffer`: WASM support, including threaded/pthreads builds
- `URL`, `Blob`, `File`, `FormData`, `FileReader`: data types
- `TextEncoder`, `TextDecoder`: text codecs
- `HTMLElement`, `SVGElement`, `customElements`: DOM constructors
- `Math`, `Date`, `JSON`, `Promise`, `Array`, `Object`, `Map`, `Set`: JS builtins
- `ArrayBuffer`, `Uint8Array`, `DataView`, and friends: typed arrays
- `indexedDB`, `localStorage`, `sessionStorage`: storage
- `requestAnimationFrame`, `requestIdleCallback`: scheduling
- `CSS`, `getComputedStyle`: CSS APIs
- `MutationObserver`, `IntersectionObserver`, `ResizeObserver`: observers

Nothing here is filtered or wrapped. `api` exists purely to expose things a plugin has no other way of reaching, like the app's in-memory project state and its OPFS-backed per-plugin storage. It is not a permission layer.

### Events

Subscribe with `api.on(event, handler)`:

- `projectOpen`: project opened
- `projectClose`: project closed
- `import`: file imported
- `export`: file exported
- `copy`: copy triggered
- `apply`: apply triggered

### Hooks

Hooks let a plugin intercept and transform data as it flows through the app. Register with `api.hook(name, fn)` (returns a token), remove with `api.unhook(token)`. A hook handler receives the current value (and extra context) and may return a replacement value, which becomes the input to the next hook and the final value the app uses.

Sync hooks (return a value directly):

| Hook | When | Args |
|---|---|---|
| `formatLine(text, line)` | When formatting a line for the preview list | `text` so far, the line object |
| `formatLineForAi(text, line)` | When formatting a line for the AI prompt | `text` so far, the line object |
| `lineCreate(rowEl)` | When a new preview row element is created | the row DOM element |
| `lineRender(rowEl, line)` | After a line is rendered into a row | the row DOM element, the line object |
| `lineOpen(num, line)` | When the line editor opens | line number, line object |
| `lineSave(num, line, before)` | After a line is saved in the editor | line number, line object, previous values |
| `settingsChange(changes)` | After settings are saved | object of changed keys → new values |

Async hooks (may return a Promise):

| Hook | When | Args |
|---|---|---|
| `beforeImport(ctx)` | Before any import starts | `{ isZip, startNum }` |
| `afterImport(ctx)` | After an import completes | `{ lineCount, fileCount, cancelled }` |
| `beforeExport(ctx)` | Before an export starts | `{ projectType, cancel }` — set `ctx.cancel = true` to abort |
| `afterExport(ctx)` | After an export completes | `{ projectType }` |
| `beforeCopy(ctx)` | Before copy-for-AI assembles text | `{ lines, count }` |
| `afterCopy(ctx)` | After text is copied | `{ lines, count, text }` |
| `beforeApply(ctx)` | Before AI result is applied | `{ raw, selected }` |
| `afterApply(ctx)` | After translations are applied | `{ count, lines }` |
| `beforeSave(data)` | Before project data is persisted | the data object (mutable) |
| `afterSave(data)` | After project data is persisted | the data object |
| `projectCreate(ctx)` | When a new project is created | `{ name, cancel }` — set `ctx.cancel = true` to abort |
| `beforeRestore(ctx)` | Before a backup archive is restored | `{ fileName }` |
| `afterRestore(ctx)` | After a backup restore completes | `{ fileName, ok, single }` |
| `beforeOpfsDelete(ctx)` | Before a file/folder is deleted from OPFS | `{ path, name, isDir, kind }` |
| `afterOpfsDelete(ctx)` | After an OPFS file/folder is deleted | `{ path, name, isDir, kind }` |
| `afterOpfsDownload(ctx)` | After a file is downloaded from OPFS | `{ path, name, size }` |

```js
activate(api) {
  api.hook('formatLineForAi', (text, line) => {
    return text.replace(/\[ruby=([^\]]+)\]([^[]+)\[\/ruby\]/g, '$2($1)');
  });

  api.hook('lineRender', (row, line) => {
    if (line.message.includes('TODO')) row.classList.add('row-flagged');
  });

  api.hook('beforeExport', ctx => {
    if (ctx.projectType === 'json') api.toast('Exporting JSON…');
  });
}
```

### Custom importers and exporters

A plugin can register named import/export flows that appear in the Import and Export dropdowns, no manifest `extensions` or `magic` needed. The handler receives `{ api, state, lines? }` and is free to do whatever it wants (read a file, transform lines, call a server, etc.).

```js
activate(api) {
  api.registerImporter('Import from Clipboard', async ({ api }) => {
    const text = await navigator.clipboard.readText();
    const lines = text.split('\n').filter(Boolean).map((message, i) => ({ message, file: 'clipboard' }));
    lines.forEach(l => api.addLine(l));
  });

  api.registerExporter('Export as TXT', async ({ api, lines }) => {
    const text = lines.map(l => l.is_translated ? l.trans_message : l.message).join('\n');
    api.download(text, 'export.txt');
  });
}
```

### Custom toolbar buttons, modals, dashboard cards, theme, and styles

```js
activate(api) {
  api.addToolbarButton('Run Check', () => api.toast('Checked!'), { title: 'Run a consistency check' });

  api.createModal('Plugin Report', '<p>Everything looks good.</p>', { wide: true });

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = '<h3>Stats</h3><p>0 lines today</p>';
  api.addDashboardCard(card);

  api.setTheme({ '--accent': '#ff6fae', '--bg': '#1a0a14' });
  api.injectStyle('.preview-row.row-flagged { outline: 1px solid var(--danger); }', 'flag-style');
}
```

### Direct state and line manipulation

```js
activate(api) {
  const state = api.getState();
  console.log(state.projectName, state.lineCount, state.translatedCount);

  const line = api.getLine(42);
  api.updateLine(42, { trans_message: 'Hello', is_translated: true });
  api.markTranslated(42, 'Hello', 'Speaker');
  api.addLine({ message: 'New line', name: 'Narrator', file: 'extra.json' });
  api.removeLine(99);
}
```

### Settings types

`string`, `number`, `boolean`, `select`, `textarea`. Settings can be scoped globally (applies everywhere) or per project, and each field supports an optional description shown under its label in the plugin's own settings panel.

### Backup format

A single project backup is a `.cstl` file containing a zip whose `project/` entry holds the contents of the project folder, plus a small `backup.json` manifest at the zip root. A full backup additionally includes `app/` and `plugins/`, with each project stored at `projects/<id>/`. Restoring a backup unzips the folder into a fresh project ID, so restoring the same backup multiple times creates multiple distinct projects with no collision.

### Content Security Policy

The app CSP allows `unsafe-inline`, `unsafe-eval`, and `wasm-unsafe-eval` scripts, `blob:` workers, and any HTTP/HTTPS/WebSocket connections. There is no `frame-src` since nothing needs iframes. `unsafe-eval` and `wasm-unsafe-eval` are what let plugin code and WASM modules actually run at all, they aren't there by accident.

The service worker also serves the app cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`), so `SharedArrayBuffer` and threaded WASM are available to plugins. On every visit a full-screen loading screen covers the app while it checks for a newer build; if one is found it downloads and activates behind that screen, and the page reloads once so the new version is live on that same visit. This needs a connection, offline the cached version boots straight away.

### A note on trust

Since plugins run unsandboxed in the main document, a plugin has the same access to your data and browser as the app itself, it can read every project you have stored, make network requests anywhere, and modify the page. This mirrors how browser extensions work: convenient and powerful, but only as safe as the plugin you chose to install. CSTL-NEXT doesn't try to police what a plugin does at runtime; the trust decision happens once, at install time, when you choose which zip to install.
