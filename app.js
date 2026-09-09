(() => {
'use strict';

const VERSION = 1;
const PROJECT_MIGRATIONS = {};

function migrateProjectData(data) {
  if (!isPlainObject(data)) {
    throw new Error('Project file is corrupted or invalid and cannot be opened.');
  }
  const from = Number(data.version) || 1;
  if (from > VERSION) {
    throw new Error(`This project was created with a newer version of CSTL (v${from}) than this app supports (v${VERSION}). Update CSTL and try again.`);
  }
  let out = data;
  for (let v = from + 1; v <= VERSION; v++) {
    const step = PROJECT_MIGRATIONS[v];
    if (step) out = step(out) || out;
  }
  out.version = VERSION;
  return out;
}

const APP_DIR = 'app';
const PLUGINS_DIR = 'plugins';
const PROJECTS_DIR = 'projects';
const MEDIA_DIR = 'media';
const DATA_DIR = 'data';
const APP_SHORTCUTS_FILE = 'shortcuts.json';
const APP_PLUGIN_SETTINGS_FILE = 'plugin-settings.json';
const BACKUP_FORMAT_PROJECT = 'cstl-project';
const BACKUP_FORMAT_ALL = 'cstl-all';
const BACKUP_VERSION = 1;
const DEFAULT_PROMPT = `Translate entire text to Native English. Euphemism prohibited. Onomatopoeia must be English-based. Result must be inside codeblock. Keep line numbering and format (like code in the middle of the text) intact.`;
const DEFAULT_SUMMARY_PROMPT = `Outside the <translate> and </translate> tags (placed above or below the translated lines), include updated summary of the characters and overall story so far. Any characters and story need to be preserved even though they don't appear again for context.`;
const FIXED_FORMAT_PROMPT = `Format:\n<translate>\ntext\n</translate>`;
const DECODERS = ['utf-8', 'shift_jis', 'windows-31j', 'cp932'];

const CFG = {
  toastTimeoutMs: 3000,
  savedTimeoutMs: 1800,
  dashboardPageSize: 30,
  scroller: {
    overscan: 6,
    defaultH: 80,
    gap: 8,
    topPad: 8,
    botPad: 12,
    headerH: 32,
    maxRenderPasses: 5,
    defaultViewportH: 800,
    recyclePos: -9999,
  },
  delay: {
    repositionMs: 50,
    focusMs: 30,
    reloadMs: 800,
    revokeUrlMs: 10000,
    dashboardSearchMs: 180,
    proofreadDebounceMs: 200,
    storageWatchMs: 4000,
  },
  chunkSize: { importBatch: 50, fileProgressBatch: 10 },
  warningDisplayMax: 10,
  skippedFilesDisplayMax: 5,
  storage: { criticalFreeMb: 10, safeFreeMb: 80 },
  debounceDefaultMs: 200,
};

const SETTINGS_FIELDS = [
  { id: 'settingsIgnoreNameCheck',    key: 'ignoreName',       type: 'check',  def: false, group: 'basic' },
  { id: 'settingsPromptCheck',        key: 'promptEnabled',    type: 'check',  def: true,  group: 'basic' },
  { id: 'settingsJumpToContextCheck', key: 'jumpToContext',    type: 'check',  def: false, group: 'basic' },
  { id: 'settingsHideToolsCheck',     key: 'hideTools',        type: 'check',  def: false, group: 'basic' },
  { id: 'settingsIncrementCheck',     key: 'incrementEnabled', type: 'check',  def: false, group: 'increment' },
  { id: 'settingsIncrementStepInput', key: 'incrementStep',    type: 'number', def: 100,   group: 'increment' },
  { id: 'settingsPromptInput',        key: 'prompt',           type: 'value', def: DEFAULT_PROMPT, group: 'prompt' },
  { id: 'settingsEpubTagsInput',      key: 'epubTags',         type: 'value', def: 'p',   group: 'epub' }
];

const PROOFREAD_FIELDS = [
  { id: 'proofreadScope',               key: 'prScope',          type: 'value', def: 'all'   },
  { id: 'proofreadRegexCheck',          key: 'prRegex',          type: 'check', def: false   },
  { id: 'proofreadCaseCheck',           key: 'prCase',           type: 'check', def: false   },
  { id: 'proofreadExactCheck',          key: 'prExact',          type: 'check', def: false   },
  { id: 'proofreadTranslatedOnlyCheck', key: 'prTranslatedOnly', type: 'check', def: false   }
];

const STATE_SCHEMA = [
  { key: 'projectName',        def: '' },
  { key: 'projectType',        def: 'uninitialized',        coerce: true },
  { key: 'pluginId',           def: null,                   coerce: true },
  { key: 'pluginName',         def: null,                   coerce: true },
  { key: 'pluginData',         def: null,                   coerce: true },
  { key: 'epubTags',           def: 'p',                    coerce: true },
  { key: 'epubSourceId',       def: null,                   coerce: true },
  { key: 'prompt',             def: DEFAULT_PROMPT,         coerce: true, store: 'prompt_header' },
  { key: 'ignoreName',         def: false,                  store: 'ignoreNameTranslation' },
  { key: 'promptEnabled',      def: true },
  { key: 'summaryEnabled',   def: false },
  { key: 'summaryPrompt',    def: DEFAULT_SUMMARY_PROMPT, coerce: true },
  { key: 'summary',          def: '' },
  { key: 'vndbEnabled',        def: false },
  { key: 'vndbId',             def: '' },
  { key: 'vndbGlossary',       def: [],                     coerce: true },
  { key: 'customEnabled',      def: false },
  { key: 'customRaw',          def: '' },
  { key: 'jumpToContext',      def: false },
  { key: 'hideTools',          def: false },
  { key: 'incrementEnabled',   def: false },
  { key: 'incrementStep',      def: 100,                    coerce: true },
  { key: 'pluginSettings',    def: {},                     coerce: true },
  { key: 'prScope',            def: 'all',                  coerce: true, store: 'proofreadScope' },
  { key: 'prRegex',            def: false,                  store: 'proofreadRegex' },
  { key: 'prCase',             def: false,                  store: 'proofreadCaseSensitive' },
  { key: 'prExact',            def: false,                  store: 'proofreadExactMatch' },
  { key: 'prTranslatedOnly',   def: false,                  store: 'proofreadTranslatedOnly' },
  { key: 'bookmarks',          def: [],                     coerce: true },
  { key: 'images',             def: [],                     coerce: true }
];

const DROPDOWNS = [
  { trigger: 'btnImportMain',   panel: 'importDropdown',    group: 'importGroup'    },
  { trigger: 'btnExport',        panel: 'exportDropdown',    group: 'exportGroup'    },
  { trigger: 'btnCopyAllNames',  panel: 'copyNamesDropdown', group: 'copyNamesGroup' }
];

const $ = id => document.getElementById(id);
const { escapeHtml, humanBytes, validDataKey, sanitizeName, stripNewlines, isPlainObject } = CSTL.util;
const baseName = p => String(p || '').replace(/\\/g, '/').split('/').pop();
const fileExt = name => { const bn = baseName(name); const i = bn.lastIndexOf('.'); return i > 0 ? bn.slice(i).toLowerCase() : ''; };
const readHead = async (file, n = 512) => new Uint8Array(await file.slice(0, n).arrayBuffer());
const countFiles = files => (Array.isArray(files) ? files : []).length;
const isTrans = l => !!l.is_translated;
const makeId = () => Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
const makeProjId = () => 'proj_' + makeId();
const MEDIA_EPUB = 'book.epub';
const makeMediaName = (origName) => {
  const base = baseName(origName || 'image');
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : '.bin';
  return `${stem}_${makeId()}${ext}`;
};
const schemaDefault = f => (f.def && typeof f.def === 'object') ? structuredClone(f.def) : f.def;
const snapshot = () => ({ lines: structuredClone(State.lines), selected: new Set(State.selected) });
const assertJsZip = () => { if (typeof JSZip === 'undefined') throw new Error('JSZip is not available.'); };
const yieldToEvent = () => new Promise(r => setTimeout(r, 0));

function normalizeLine(l) {
  if (l._n) return l;
  return {
    line_num: Number(l.line_num),
    file: String(l.file),
    name: l.name == null ? null : String(l.name),
    message: String(l.message || ''),
    trans_name: l.trans_name == null ? null : String(l.trans_name),
    trans_message: l.trans_message == null ? null : String(l.trans_message),
    is_translated: Boolean(l.is_translated),
    _n: 1
  };
}

function lineToStorage(l) {
  return {
    line_num: l.line_num,
    file: l.file,
    is_translated: l.is_translated,
    original: { name: l.name, message: l.message },
    translation: { name: l.trans_name, message: l.trans_message }
  };
}

function lineFromStorage(e) {
  const o = e.original || {};
  const t = e.translation || {};
  return {
    line_num: Number(e.line_num),
    file: String(e.file),
    name: o.name == null ? null : String(o.name),
    message: String(o.message || ''),
    trans_name: t.name == null ? null : String(t.name),
    trans_message: t.message == null ? null : String(t.message),
    is_translated: Boolean(e.is_translated),
    _n: 1
  };
}

function decodeBuffer(buf) {
  for (const enc of DECODERS) {
    try { return new TextDecoder(enc, { fatal: true }).decode(buf); } catch {}
  }
  return new TextDecoder('utf-8').decode(buf);
}

const asciiOf = bytes => { let s = ''; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return s; };
const isZipHead = h => h.length >= 4 && h[0] === 0x50 && h[1] === 0x4b && h[2] === 0x03 && h[3] === 0x04;
const isEpubHead = h => isZipHead(h) && asciiOf(h).includes('application/epub+archive');
const isJsonHead = h => {
  let i = 0;
  if (h.length >= 3 && h[0] === 0xef && h[1] === 0xbb && h[2] === 0xbf) i = 3;
  while (i < h.length && (h[i] === 0x20 || h[i] === 0x09 || h[i] === 0x0a || h[i] === 0x0d)) i++;
  return i < h.length && (h[i] === 0x7b || h[i] === 0x5b);
};

function resolveZipPath(baseDir, rel) {
  if (!rel) return null;
  if (/^(?:[a-z]+:)?\/\//i.test(rel) || /^data:/i.test(rel)) return null;
  rel = rel.split('#')[0].split('?')[0];
  if (!rel) return null;
  const parts = (baseDir + rel).split('/');
  const stack = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  return stack.join('/');
}

function isJapanese(s) {
  return /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(s);
}

function download(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), CFG.delay.revokeUrlMs);
}

function clipboard(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); return Promise.resolve(); }
  catch (e) { return Promise.reject(e); }
  finally { document.body.removeChild(ta); }
}

function debounce(fn, ms = CFG.debounceDefaultMs) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function withBusyCursor(fn) {
  document.body.style.cursor = 'wait';
  return Promise.resolve(fn()).finally(() => { document.body.style.cursor = 'default'; });
}

async function withProgress(title, initialMsg, fn, failMsg) {
  Progress.show(title, initialMsg || '');
  let err = null;
  let result;
  await withBusyCursor(async () => {
    try { result = await fn(); }
    catch (e) { err = e; }
  });
  Progress.hide();
  if (err) {
    els.copyStatus.classList.add('empty');
    const msg = err?.storage ? err.message : (failMsg ? failMsg(err) : err.message);
    App.flash(msg, true, 'error');
    if (err?.storage) App.loadDashboard();
    return undefined;
  }
  return result;
}

function isStorageError(e) {
  const n = e?.name;
  return n === 'NotFoundError' || n === 'SecurityError' || n === 'NotReadableError' ||
    n === 'InvalidStateError' || n === 'InvalidModificationError' ||
    n === 'NoModificationAllowedError' || n === 'DataError';
}

function storageFailure(e, noun) {
  const err = new Error();
  err.storage = true;
  const n = e?.name;
  if (n === 'NotFoundError') {
    err.message = (noun ? 'File ' + noun : 'Data') + ' not found in storage. It may have been deleted or site data was cleared. The list will be reloaded.';
  } else if (n === 'NoModificationAllowedError') {
    err.message = 'File is being used by another process. Wait a moment and try again.';
  } else {
    err.message = 'Storage is currently inaccessible. Close and reopen the app, then try again.';
  }
  return err;
}

function friendlyError(e, prefix) {
  if (e?.storage) return e.message;
  if (isStorageError(e)) return storageFailure(e).message;
  return prefix + (e?.message || e);
}

const Storage = {
  _rootPromise: null,
  root() {
    if (!this._rootPromise) {
      this._rootPromise = Promise.resolve().then(() => navigator.storage.getDirectory());
      this._rootPromise.catch(() => { Storage._rootPromise = null; });
    }
    return this._rootPromise;
  },
  invalidateRoot() {
    const p = Storage._rootPromise;
    Storage._rootPromise = null;
    if (p) p.catch(() => {});
  },
  async _withRootRetry(fn, noun) {
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) Storage.invalidateRoot();
      let root;
      try { root = await Storage.root(); }
      catch (e) {
        lastErr = e;
        if (!isStorageError(e)) throw e;
        continue;
      }
      try { return await fn(root); }
      catch (e) {
        lastErr = e;
        if (!isStorageError(e)) throw e;
      }
    }
    throw storageFailure(lastErr, noun);
  },
  async probe() {
    try {
      const root = await Storage.root();
      await root.entries().next();
      return true;
    } catch {
      Storage.invalidateRoot();
      return false;
    }
  },
  _queue: Promise.resolve(),
  _queued(fn) {
    const run = Storage._queue.then(fn, fn);
    Storage._queue = run.then(() => {}, () => {});
    return run;
  },

  async _writeFile(dir, name, content) {
    const rand = Math.random().toString(36).slice(2, 8);
    const tmpName = '.' + String(name).slice(0, 240) + '.' + rand + '.tmp';
    let tmpHandle = null;
    let w = null;
    try {
      tmpHandle = await dir.getFileHandle(tmpName, { create: true });
      w = await tmpHandle.createWritable();
      await w.write(content);
      await w.close();
      w = null;
      let moved = false;
      if (typeof tmpHandle.move === 'function') {
        try { await tmpHandle.move(name); moved = true; } catch {}
      }
      if (!moved) {
        const finalHandle = await dir.getFileHandle(name, { create: true });
        const w2 = await finalHandle.createWritable();
        try {
          await w2.write(content);
          await w2.close();
        } catch (e) {
          try { await w2.abort(); } catch {}
          throw e;
        }
      }
      App.ensureSW();
    } catch (e) {
      if (w) { try { await w.abort(); } catch {} }
      if (e && /quota/i.test(String(e.name || e.message || ''))) {
        throw new Error('Browser storage is full while saving file. Clean up unnecessary files and try again.');
      }
      throw e;
    } finally {
      if (tmpHandle) { try { await dir.removeEntry(tmpName); } catch {} }
    }
  },

  async _readJson(dir, name) {
    const f = await (await dir.getFileHandle(name)).getFile();
    return JSON.parse(await f.text());
  },

  async _readJsonSafe(dir, name, fallback) {
    try { return await Storage._readJson(dir, name); }
    catch { return fallback; }
  },

  async _ensureAppDir(root) {
    return await root.getDirectoryHandle(APP_DIR, { create: true });
  },
  async _ensurePluginsDir(root) {
    return await root.getDirectoryHandle(PLUGINS_DIR, { create: true });
  },
  async _ensureProjectsDir(root) {
    return await root.getDirectoryHandle(PROJECTS_DIR, { create: true });
  },

  writeAppJson(name, value) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const dir = await Storage._ensureAppDir(root);
      const parts = name.split('/').filter(Boolean);
      let cur = dir;
      for (let i = 0; i < parts.length - 1; i++) {
        cur = await cur.getDirectoryHandle(parts[i], { create: true });
      }
      await Storage._writeFile(cur, parts[parts.length - 1], JSON.stringify(value));
    }));
  },

  async readAppJson(name) {
    try {
      return await Storage._withRootRetry(async root => {
        const dir = await Storage._ensureAppDir(root);
        const parts = name.split('/').filter(Boolean);
        let cur = dir;
        for (let i = 0; i < parts.length - 1; i++) {
          cur = await cur.getDirectoryHandle(parts[i]);
        }
        return await Storage._readJson(cur, parts[parts.length - 1]);
      });
    } catch { return null; }
  },

  removeAppFile(name) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const dir = await Storage._ensureAppDir(root);
      const parts = name.split('/').filter(Boolean);
      let cur = dir;
      for (let i = 0; i < parts.length - 1; i++) {
        cur = await cur.getDirectoryHandle(parts[i]);
      }
      try { await cur.removeEntry(parts[parts.length - 1]); } catch {}
    }));
  },

  async readShortcuts() {
    return Storage.readAppJson(APP_SHORTCUTS_FILE);
  },
  writeShortcuts(value) {
    return Storage.writeAppJson(APP_SHORTCUTS_FILE, value);
  },
  removeShortcuts() {
    return Storage.removeAppFile(APP_SHORTCUTS_FILE);
  },

  async readGlobalPluginSettings() {
    return Storage.readAppJson(APP_PLUGIN_SETTINGS_FILE);
  },
  writeGlobalPluginSettings(value) {
    return Storage.writeAppJson(APP_PLUGIN_SETTINGS_FILE, value);
  },

  async readPluginIndex() {
    try {
      return await Storage._withRootRetry(async root => {
        const dir = await Storage._ensurePluginsDir(root);
        return await Storage._readJsonSafe(dir, 'index.json', []);
      });
    } catch { return []; }
  },
  writePluginIndex(items) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const dir = await Storage._ensurePluginsDir(root);
      await Storage._writeFile(dir, 'index.json', JSON.stringify(items));
    }));
  },

  async _pluginDir(root, pluginId, create) {
    const plugins = await Storage._ensurePluginsDir(root);
    return await plugins.getDirectoryHandle(pluginId, { create: !!create });
  },

  async installPluginFiles(pluginId, manifestJson, pluginCode, assetFiles) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const dir = await Storage._pluginDir(root, pluginId, true);
      await Storage._writeFile(dir, 'manifest.json', manifestJson);
      await Storage._writeFile(dir, 'plugin.js', pluginCode);
      for (const [path, bytes] of assetFiles) {
        const parts = path.split('/').filter(Boolean);
        let cur = dir;
        for (let i = 0; i < parts.length - 1; i++) {
          cur = await cur.getDirectoryHandle(parts[i], { create: true });
        }
        await Storage._writeFile(cur, parts[parts.length - 1], bytes);
      }
    }));
  },

  async readPluginCode(pluginId) {
    return Storage._withRootRetry(async root => {
      const dir = await Storage._pluginDir(root, pluginId, false);
      const f = await (await dir.getFileHandle('plugin.js')).getFile();
      return await f.text();
    });
  },

  async readPluginAssetBytes(pluginId, path) {
    return Storage._withRootRetry(async root => {
      const dir = await Storage._pluginDir(root, pluginId, false);
      const parts = path.split('/').filter(Boolean);
      let cur = dir;
      for (let i = 0; i < parts.length - 1; i++) {
        cur = await cur.getDirectoryHandle(parts[i]);
      }
      const f = await (await cur.getFileHandle(parts[parts.length - 1])).getFile();
      return new Uint8Array(await f.arrayBuffer());
    });
  },

  async readPluginAssetText(pluginId, path) {
    const bytes = await Storage.readPluginAssetBytes(pluginId, path);
    return new TextDecoder().decode(bytes);
  },

  async pluginInstalled(pluginId) {
    try {
      await Storage._withRootRetry(async root => {
        const dir = await Storage._pluginDir(root, pluginId, false);
        await dir.getFileHandle('plugin.js');
        await dir.getFileHandle('manifest.json');
      });
      return true;
    } catch { return false; }
  },

  async deletePlugin(pluginId) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const plugins = await Storage._ensurePluginsDir(root);
      try { await plugins.removeEntry(pluginId, { recursive: true }); }
      catch (e) { if (e?.name !== 'NotFoundError') throw e; }
    }));
  },

  async listInstalledPluginIds() {
    try {
      return await Storage._withRootRetry(async root => {
        const plugins = await Storage._ensurePluginsDir(root);
        const out = [];
        for await (const [name, h] of plugins.entries()) {
          if (h.kind !== 'directory') continue;
          out.push(name);
        }
        return out;
      });
    } catch { return []; }
  },

  async _projectDir(root, projectId, create) {
    const projects = await Storage._ensureProjectsDir(root);
    return await projects.getDirectoryHandle(projectId, { create: !!create });
  },

  async createProjectDir(projectId) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const dir = await Storage._projectDir(root, projectId, true);
      await dir.getDirectoryHandle(MEDIA_DIR, { create: true });
      await dir.getDirectoryHandle(DATA_DIR, { create: true });
    }));
  },

  async saveProject(projectId, data) {
    if (!data.updatedAt) data.updatedAt = Date.now();
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const dir = await Storage._projectDir(root, projectId, true);
      await dir.getDirectoryHandle(MEDIA_DIR, { create: true });
      await dir.getDirectoryHandle(DATA_DIR, { create: true });
      await Storage._writeFile(dir, 'project.json', JSON.stringify(data));
    }));
  },

  async loadProject(projectId) {
    let data;
    try {
      data = await Storage._withRootRetry(async root => {
        const dir = await Storage._projectDir(root, projectId, false);
        return await Storage._readJson(dir, 'project.json');
      }, 'project');
    } catch (e) {
      if (e instanceof SyntaxError) throw new Error('Project file is corrupted or invalid and cannot be opened.');
      throw e;
    }
    return migrateProjectData(data);
  },

  async deleteProject(projectId) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const projects = await Storage._ensureProjectsDir(root);
      try { await projects.removeEntry(projectId, { recursive: true }); }
      catch (e) { if (e?.name !== 'NotFoundError') throw e; }
      await Storage._removeProjectIndexEntry(root, projectId);
    }));
  },

  async writeMediaFile(projectId, relPath, bytes) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const dir = await Storage._projectDir(root, projectId, true);
      const media = await dir.getDirectoryHandle(MEDIA_DIR, { create: true });
      const parts = relPath.split('/').filter(Boolean);
      let cur = media;
      for (let i = 0; i < parts.length - 1; i++) {
        cur = await cur.getDirectoryHandle(parts[i], { create: true });
      }
      await Storage._writeFile(cur, parts[parts.length - 1], bytes);
    }));
  },

  async readMediaFile(projectId, relPath) {
    try {
      return await Storage._withRootRetry(async root => {
        const dir = await Storage._projectDir(root, projectId, false);
        const media = await dir.getDirectoryHandle(MEDIA_DIR);
        const parts = relPath.split('/').filter(Boolean);
        let cur = media;
        for (let i = 0; i < parts.length - 1; i++) {
          cur = await cur.getDirectoryHandle(parts[i]);
        }
        const f = await (await cur.getFileHandle(parts[parts.length - 1])).getFile();
        return await f.arrayBuffer();
      });
    } catch { return null; }
  },

  async writeEpub(projectId, buffer) {
    return Storage.writeMediaFile(projectId, MEDIA_EPUB, buffer);
  },

  async readEpub(projectId) {
    const buf = await Storage.readMediaFile(projectId, MEDIA_EPUB);
    return buf ? new Uint8Array(buf) : null;
  },

  async _pluginDataDir(root, projectId, pluginId, create) {
    const dir = await Storage._projectDir(root, projectId, create);
    const data = await dir.getDirectoryHandle(DATA_DIR, create ? { create: true } : {});
    return await data.getDirectoryHandle(pluginId, create ? { create: true } : {});
  },

  async savePluginData(projectId, pluginId, key, data) {
    if (!validDataKey(key)) throw new Error('Invalid data key.');
    let blob;
    if (data instanceof Blob) blob = data;
    else if (data instanceof ArrayBuffer || data instanceof Uint8Array) blob = new Blob([data], { type: 'application/octet-stream' });
    else if (typeof data === 'string') blob = new Blob([data], { type: 'text/plain' });
    else throw new Error('Invalid data (must be Blob / ArrayBuffer / Uint8Array / string).');
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const dir = await Storage._pluginDataDir(root, projectId, pluginId, true);
      await Storage._writeFile(dir, key, blob);
    }));
  },

  async loadPluginData(projectId, pluginId, key) {
    if (!validDataKey(key)) return null;
    try {
      return await Storage._withRootRetry(async root => {
        const dir = await Storage._pluginDataDir(root, projectId, pluginId, false);
        const fh = await dir.getFileHandle(key);
        return await fh.getFile();
      });
    } catch { return null; }
  },

  async deletePluginData(projectId, pluginId, key) {
    if (!validDataKey(key)) return;
    return Storage._queued(() => Storage._withRootRetry(async root => {
      try {
        const dir = await Storage._pluginDataDir(root, projectId, pluginId, false);
        await dir.removeEntry(key);
      } catch (e) { if (e?.name !== 'NotFoundError') throw e; }
    }));
  },

  async listPluginData(projectId, pluginId) {
    try {
      return await Storage._withRootRetry(async root => {
        const dir = await Storage._pluginDataDir(root, projectId, pluginId, false);
        const keys = [];
        for await (const [name, h] of dir.entries()) {
          if (h.kind !== 'file') continue;
          if (name.startsWith('.') && name.endsWith('.tmp')) continue;
          keys.push(name);
        }
        return keys;
      });
    } catch { return []; }
  },

  async pluginDataExists(projectId, pluginId, key) {
    if (!validDataKey(key)) return false;
    try {
      await Storage._withRootRetry(async root => {
        const dir = await Storage._pluginDataDir(root, projectId, pluginId, false);
        await dir.getFileHandle(key);
      });
      return true;
    } catch { return false; }
  },

  async _readProjectIndex(root) {
    try {
      const dir = await Storage._ensureProjectsDir(root);
      return await Storage._readJsonSafe(dir, 'index.json', []);
    } catch { return []; }
  },

  async _writeProjectIndex(root, items) {
    const dir = await Storage._ensureProjectsDir(root);
    await Storage._writeFile(dir, 'index.json', JSON.stringify(items));
  },

  async _removeProjectIndexEntry(root, projectId) {
    const items = await Storage._readProjectIndex(root);
    const filtered = items.filter(p => p.id !== projectId);
    if (filtered.length !== items.length) await Storage._writeProjectIndex(root, filtered);
  },

  upsertProjectIndexEntry(meta) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const items = await Storage._readProjectIndex(root);
      const i = items.findIndex(p => p.id === meta.id);
      if (i >= 0) items[i] = meta; else items.push(meta);
      items.sort((a, b) => b.updatedAt - a.updatedAt);
      await Storage._writeProjectIndex(root, items);
    }));
  },

  async listProjects() {
    return Storage.reconcileProjectIndex(await Storage._readProjectIndexFromRoot());
  },

  async _readProjectIndexFromRoot() {
    try {
      return await Storage._withRootRetry(root => Storage._readProjectIndex(root));
    } catch { return []; }
  },

  projectIndexEntry(id, data, fallbackModified) {
    return {
      id,
      name: data.projectName || id,
      projectType: data.projectType || 'uninitialized',
      pluginId: data.pluginId || null,
      pluginName: data.pluginName || null,
      updatedAt: data.updatedAt || fallbackModified,
      fileCount: countFiles(data.imported_files),
      lineCount: data.lines?.length || 0,
      translatedCount: data.lines?.reduce((n, l) => n + (l.is_translated ? 1 : 0), 0) || 0
    };
  },

  reconcileProjectIndex(items) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const saved = Array.isArray(items) ? items : [];
      const byId = new Map(saved.map(p => [p.id, p]));
      const found = [];
      let changed = false;
      const projects = await Storage._ensureProjectsDir(root);
      for await (const [name, h] of projects.entries()) {
        if (h.kind !== 'directory') continue;
        const meta = byId.get(name);
        if (meta) {
          byId.delete(name);
          found.push(meta);
          continue;
        }
        const data = await Storage._readJson(h, 'project.json');
        found.push(Storage.projectIndexEntry(name, data, Date.now()));
        changed = true;
      }
      if (byId.size) changed = true;
      found.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (changed) await Storage._writeProjectIndex(root, found);
      return found;
    }));
  },

  async wipeAll(onProgress) {
    return Storage._queued(() => Storage._withRootRetry(async root => {
      const names = [];
      for await (const [name] of root.entries()) names.push(name);
      let done = 0;
      for (const name of names) {
        try { await root.removeEntry(name, { recursive: true }); } catch {}
        done++;
        if (onProgress) { try { onProgress(done, names.length); } catch {} }
      }
    }));
  },

  async sweepTemp() {
    const stale = Date.now() - 3600000;
    const sweepDir = async dir => {
      const staleNames = [];
      for await (const [name, h] of dir.entries()) {
        if (h.kind !== 'file' || !name.startsWith('.') || !name.endsWith('.tmp')) continue;
        try {
          const f = await h.getFile();
          if (f.lastModified < stale) staleNames.push(name);
        } catch {}
      }
      for (const name of staleNames) {
        try { await dir.removeEntry(name); } catch {}
      }
    };
    const sweepTree = async dir => {
      await sweepDir(dir);
      for await (const [, h] of dir.entries()) {
        if (h.kind !== 'directory') continue;
        await sweepTree(h);
      }
    };
    try { await Storage._withRootRetry(root => sweepTree(root)); } catch {}
  }
};

const OpfsExplorer = {
  path: [],
  classify(name, isDir) {
    if (isDir) {
      if (this.path.length === 0) {
        if (name === APP_DIR) return 'app';
        if (name === PLUGINS_DIR) return 'plugins';
        if (name === PROJECTS_DIR) return 'projects';
      }
      return 'folder';
    }
    if (name === 'index.json') return 'index';
    if (name === 'manifest.json') return 'manifest';
    if (name === 'plugin.js') return 'plugin-code';
    if (name === 'project.json') return 'project';
    if (name === 'book.epub') return 'epub';
    if (name.startsWith('.') && name.endsWith('.tmp')) return 'tmp';
    if (/\.(epub|epub3)$/i.test(name)) return 'epub';
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)) return 'image';
    if (/\.(js|json|txt|xhtml|html)$/i.test(name)) return 'other';
    return 'other';
  },
  kindLabel(kind) {
    return ({
      app: 'App Data',
      plugins: 'Plugins',
      projects: 'Projects',
      folder: 'Folder',
      project: 'Project',
      epub: 'EPUB',
      image: 'Image',
      manifest: 'Manifest',
      'plugin-code': 'Plugin Code',
      index: 'Index',
      tmp: 'Tmp',
      other: 'File'
    })[kind] || 'File';
  },
  kindIconSvg(kind, isDir) {
    const SVG = (path) => '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>';
    const M = {
      folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
      app: '<path d="M12 2a10 10 0 1 0 10 10H12V2z"/><path d="M12 2a10 10 0 0 0 0 20z"/>',
      plugins: '<path d="M5 5h4.5a2.5 2.5 0 1 1 5 0H19v4.5a2.5 2.5 0 1 1 0 5V19h-4.5a2.5 2.5 0 1 0-5 0H5v-4.5a2.5 2.5 0 1 0 0-5z"/>',
      projects: '<path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-3H5a2 2 0 0 0-2 2z"/>',
      project: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>',
      epub: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
      image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
      manifest: '<path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4"/><path d="M9 3v4h6V3"/><path d="M9 12h6"/><path d="M9 16h3"/>',
      'plugin-code': '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
      index: '<path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>',
      tmp: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
      other: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>'
    };
    return SVG(M[isDir ? 'folder' : kind] || M.other);
  },
  formatDate(ms) {
    if (!ms) return '';
    try {
      const d = new Date(ms);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return ''; }
  },
  async dirHandle(path) {
    let dir = await navigator.storage.getDirectory();
    for (const part of path) dir = await dir.getDirectoryHandle(part);
    return dir;
  },
  async listDir() {
    if (!navigator.storage?.getDirectory) return [];
    const dir = await this.dirHandle(this.path);
    const out = [];
    for await (const [name, handle] of dir.entries()) {
      const isDir = handle.kind === 'directory';
      const item = { name, isDir, kind: this.classify(name, isDir), size: null, lastModified: 0, count: null };
      if (isDir) {
        try {
          let n = 0;
          for await (const _ of handle.entries()) n++;
          item.count = n;
        } catch {}
      } else {
        try {
          const file = await handle.getFile();
          item.size = file.size;
          item.lastModified = file.lastModified;
        } catch {}
      }
      out.push(item);
    }
    const kindPriority = { projects: 0, app: 1, plugins: 2, project: 3, epub: 4, image: 5, manifest: 6, 'plugin-code': 7, other: 8, index: 9, tmp: 10 };
    out.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (a.isDir) {
        const pa = kindPriority[a.kind] ?? 5;
        const pb = kindPriority[b.kind] ?? 5;
        if (pa !== pb) return pa - pb;
        return a.name.localeCompare(b.name);
      }
      const p = (kindPriority[a.kind] ?? 5) - (kindPriority[b.kind] ?? 5);
      if (p !== 0) return p;
      return a.name.localeCompare(b.name);
    });
    return out;
  },
  _showLoading(show) {
    els.opfsLoading.hidden = !show;
  },
  _showEmpty(show) {
    if (show) {
      els.opfsEmptyText.textContent = this.path.length ? 'This folder is empty.' : 'No files in OPFS yet.';
    }
    els.opfsEmpty.hidden = !show;
  },
  _renderCrumbs() {
    els.opfsCrumbs.hidden = !this.path.length;
    els.opfsCrumbs.innerHTML = '';
    if (!this.path.length) return;
    const frag = document.createDocumentFragment();
    const mkCrumb = (label, depth) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opfs-crumb' + (depth === this.path.length ? ' current' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        this.path = this.path.slice(0, depth);
        this.refresh();
      });
      return b;
    };
    frag.appendChild(mkCrumb('OPFS', 0));
    this.path.forEach((seg, i) => {
      const sep = document.createElement('span');
      sep.className = 'opfs-crumb-sep';
      sep.textContent = '/';
      frag.appendChild(sep);
      frag.appendChild(mkCrumb(seg, i + 1));
    });
    els.opfsCrumbs.appendChild(frag);
  },
  async refresh() {
    if (!navigator.storage?.getDirectory) {
      els.opfsList.innerHTML = '';
      this._showEmpty(false);
      this._showLoading(false);
      const notice = document.createElement('div');
      notice.className = 'opfs-empty';
      notice.style.color = 'var(--danger)';
      notice.textContent = "Browser doesn't support OPFS.";
      els.opfsList.appendChild(notice);
      return;
    }
    this._showLoading(true);
    this._showEmpty(false);
    els.opfsList.innerHTML = '';
    try {
      const items = await this.listDir();
      this._showLoading(false);
      this._renderCrumbs();
      if (!items.length) {
        this._showEmpty(true);
        return;
      }
      const frag = document.createDocumentFragment();
      for (const item of items) {
        frag.appendChild(this._renderItem(item));
      }
      els.opfsList.appendChild(frag);
    } catch (e) {
      this._showLoading(false);
      els.opfsList.innerHTML = '';
      if (e?.name === 'NotFoundError') {
        this.path = [];
        els.opfsCrumbs.hidden = true;
      }
      const notice = document.createElement('div');
      notice.className = 'opfs-error';
      notice.style.color = 'var(--danger)';
      const msg = document.createElement('div');
      msg.textContent = e?.name === 'NotFoundError'
        ? 'Folder not found. It may have been deleted. Return to OPFS root.'
        : friendlyError(e, "Couldn't load file list: ");
      notice.appendChild(msg);
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'btn btn-ghost btn-xs';
      retryBtn.style.marginTop = '8px';
      retryBtn.textContent = 'Try Again';
      retryBtn.addEventListener('click', () => OpfsExplorer.refresh());
      notice.appendChild(retryBtn);
      els.opfsList.appendChild(notice);
    }
  },
  _renderItem(item) {
    const row = document.createElement('div');
    row.className = 'opfs-item' + (item.isDir ? ' is-dir' : '');
    row.setAttribute('role', 'listitem');
    row.dataset.name = item.name;
    row.dataset.kind = item.kind;
    row.dataset.dir = item.isDir ? '1' : '0';
    const downloadTitle = item.isDir
      ? 'Folder cannot be downloaded'
      : item.kind === 'tmp'
        ? 'Tmp file may be incomplete. Download with caution'
        : 'Download file';
    const itemCount = item.count ?? 0;
    const sizeLabel = item.isDir ? `${itemCount} item${itemCount === 1 ? '' : 's'}` : humanBytes(item.size);
    row.innerHTML = `
      <div class="opfs-item-icon kind-${item.isDir ? 'folder' : item.kind}" aria-hidden="true">${this.kindIconSvg(item.kind, item.isDir)}</div>
      <div class="opfs-item-info"${item.isDir ? ' data-action="open" title="Open folder"' : ''}>
        <span class="opfs-item-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <div class="opfs-item-meta">
          <span class="opfs-tag kind-${item.kind}">${this.kindLabel(item.kind)}</span>
          <span class="opfs-meta-size">${sizeLabel}</span>
          ${item.lastModified ? `<span class="opfs-meta-date" title="Last modified">${this.formatDate(item.lastModified)}</span>` : ''}
        </div>
      </div>
      <div class="opfs-item-actions">
        <button type="button" class="opfs-item-btn opfs-download" aria-label="Download ${escapeHtml(item.name)}" title="${downloadTitle}" data-action="download"${item.isDir ? ' disabled' : ''}>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </button>
        <button type="button" class="opfs-item-btn danger opfs-delete" aria-label="Delete ${escapeHtml(item.name)}" title="${item.isDir ? 'Delete folder' : 'Delete file'}" data-action="delete">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    `;
    return row;
  },
  async download(name) {
    try {
      const dir = await this.dirHandle(this.path);
      const handle = await dir.getFileHandle(name);
      const file = await handle.getFile();
      const url = URL.createObjectURL(file);
      download(url, name);
      await CSTL.plugins.runHooks('afterOpfsDownload', { path: this.path.slice(), name, size: file.size });
    } catch (e) {
      App.flash(friendlyError(e, 'Couldn\'t download "' + name + '": '), true, 'error');
    }
  },
  async remove(name, isDir) {
    const kind = this.classify(name, isDir);
    const atProjectsRoot = this.path.length === 1 && this.path[0] === PROJECTS_DIR;
    const atPluginsRoot = this.path.length === 1 && this.path[0] === PLUGINS_DIR;
    const warnings = {
      projects: 'This is a project folder. The project will disappear from the dashboard after deletion.',
      plugins: 'This is a plugin folder. The plugin will be removed from the plugin list.',
      project: 'This is the project data file. The project may break after deletion.',
      epub: 'This is an EPUB used by the project. Image previews will no longer display.',
      manifest: 'This is the plugin manifest. The plugin may not load correctly.',
      'plugin-code': 'This is the plugin entry file. The plugin will no longer load.',
      index: 'This is an internal index file. The app will rebuild it automatically.',
      tmp: 'This is a temporary file from a failed write. Safe to delete.',
      folder: 'This folder and all its contents will be deleted.',
      other: 'This file is unrecognized. Delete if you are sure.'
    };
    let warning = warnings[kind] || warnings.other;
    if (atProjectsRoot && isDir) warning = warnings.projects;
    else if (atPluginsRoot && isDir) warning = warnings.plugins;
    if (!await App.dialogConfirm(
      `Delete "${name}" from OPFS?`,
      `${warning}\n\nThis action cannot be undone.`
    )) return;
    await CSTL.plugins.runHooks('beforeOpfsDelete', { path: this.path.slice(), name, isDir, kind });
    try {
      const dir = await this.dirHandle(this.path);
      await dir.removeEntry(name, { recursive: !!isDir });
      const row = [...els.opfsList.children].find(el => el.dataset.name === name);
      if (row) {
        row.classList.add('is-removing');
        setTimeout(() => {
          row.remove();
          if (!els.opfsList.children.length) this._showEmpty(true);
        }, 280);
      } else if (!els.opfsList.children.length) {
        this._showEmpty(true);
      }
      if (atPluginsRoot && isDir) await CSTL.plugins.sync();
      if (atProjectsRoot && isDir) App.loadDashboard();
      if (kind === 'index' && this.path.length === 1 && this.path[0] === PLUGINS_DIR) await CSTL.plugins.sync();
      if (kind === 'index' && this.path.length === 1 && this.path[0] === PROJECTS_DIR) App.loadDashboard();
      await CSTL.plugins.runHooks('afterOpfsDelete', { path: this.path.slice(), name, isDir, kind });
    } catch (e) {
      App.flash(friendlyError(e, 'Couldn\'t delete "' + name + '": '), true, 'error');
      if (e?.storage) this.refresh();
    }
  },
  open(name) {
    this.path.push(name);
    this.refresh();
  },
  handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('.opfs-item');
    if (!row) return;
    const name = row.dataset.name;
    if (!name) return;
    const action = btn.dataset.action;
    if (action === 'open') this.open(name);
    else if (action === 'download') this.download(name);
    else if (action === 'delete') this.remove(name, row.dataset.dir === '1');
  }
};

const Html = {
  containerRoot(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const rootFile = doc.querySelector('rootfile');
    const p = rootFile?.getAttribute('full-path');
    if (!p) throw new Error('Invalid EPUB: missing rootfile full-path.');
    return decodeURIComponent(p);
  },
  opfManifest(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const manifest = {};
    const items = Array.from(doc.querySelectorAll('manifest > item'));
    items.forEach(it => {
      const href = it.getAttribute('href');
      if (href != null) manifest[it.getAttribute('id')] = decodeURIComponent(href);
    });
    const spine = Array.from(doc.querySelectorAll('spine > itemref')).map(it => it.getAttribute('idref'));
    let coverId = doc.querySelector('metadata > meta[name="cover"]')?.getAttribute('content') || null;
    if (!coverId) {
      const coverItem = items.find(it => (it.getAttribute('properties') || '').split(/\s+/).includes('cover-image'));
      if (coverItem) coverId = coverItem.getAttribute('id');
    }
    const coverHref = coverId && manifest[coverId] ? manifest[coverId] : null;
    return { manifest, spine, coverHref };
  },
  extractContent(html, isXhtml, tags, baseDir) {
    const doc = new DOMParser().parseFromString(html, isXhtml ? 'application/xhtml+xml' : 'text/html');
    const texts = [];
    const images = [];
    const nodes = doc.querySelectorAll(`${tags}, img, image`);
    nodes.forEach(el => {
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'img' || tag === 'image') {
        const src = el.getAttribute('src') || el.getAttribute('xlink:href') || el.getAttribute('href');
        const zipPath = resolveZipPath(baseDir, src);
        if (zipPath) images.push({ afterIndex: texts.length - 1, zipPath });
      } else {
        const txt = el.textContent.replace(/\r?\n/g, ' ').trim();
        if (txt) texts.push(txt);
      }
    });
    return { texts, images };
  },
  rewriteTags(html, isXhtml, tags, replacements) {
    const doc = new DOMParser().parseFromString(html, isXhtml ? 'application/xhtml+xml' : 'text/html');
    let idx = 0;
    doc.querySelectorAll(tags).forEach(el => {
      if (el.textContent.replace(/\r?\n/g, ' ').trim() === '') return;
      const r = replacements[idx++];
      if (r != null) el.textContent = r;
    });
    return new XMLSerializer().serializeToString(doc);
  }
};

const IMG_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp'
};

const EpubImages = {
  zipCache: null,
  zipLoading: null,
  urlCache: new Map(),
  urlPending: new Map(),
  async getZip(projectId) {
    if (this.zipCache && this.zipCache.projectId === projectId) return this.zipCache.zip;
    if (this.zipLoading && this.zipLoading.projectId === projectId) return this.zipLoading.promise;
    assertJsZip();
    const promise = (async () => {
      const buffer = await Storage.readEpub(projectId);
      if (!buffer) throw new Error('EPUB not found in project.');
      const zip = new JSZip();
      await zip.loadAsync(buffer);
      return zip;
    })();
    this.zipLoading = { projectId, promise };
    try {
      const zip = await promise;
      this.zipCache = { projectId, zip };
      return zip;
    } finally {
      if (this.zipLoading && this.zipLoading.projectId === projectId) this.zipLoading = null;
    }
  },
  preload(projectId) {
    if (!projectId) return;
    this.getZip(projectId).then(zip => {
      const paths = [...new Set((State.images || []).map(im => im.zipPath).filter(Boolean))];
      for (const zipPath of paths) this.getUrl(projectId, zipPath);
    }).catch(() => {});
  },
  peekUrl(projectId, zipPath) {
    if (!projectId || !zipPath) return undefined;
    const key = `${projectId}|${zipPath}`;
    return this.urlCache.has(key) ? this.urlCache.get(key) : undefined;
  },
  async getUrl(projectId, zipPath) {
    if (!projectId || !zipPath) return null;
    const key = `${projectId}|${zipPath}`;
    if (this.urlCache.has(key)) return this.urlCache.get(key);
    if (this.urlPending.has(key)) return this.urlPending.get(key);
    const promise = (async () => {
      try {
        const zip = await this.getZip(projectId);
        const entry = zip?.file(zipPath);
        if (!entry) { this._commitUrl(key, null); return null; }
        const ext = zipPath.split('.').pop().toLowerCase();
        const bytes = await entry.async('uint8array');
        const blob = new Blob([bytes], { type: IMG_MIME[ext] || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        this._commitUrl(key, url);
        return url;
      } catch { this._commitUrl(key, null); return null; }
      finally { this.urlPending.delete(key); }
    })();
    this.urlPending.set(key, promise);
    return promise;
  },
  async getUrlFromMediaPath(projectId, mediaPath) {
    if (!projectId || !mediaPath) return null;
    const key = `${projectId}|${mediaPath}`;
    if (this.urlCache.has(key)) return this.urlCache.get(key);
    if (this.urlPending.has(key)) return this.urlPending.get(key);
    const promise = (async () => {
      try {
        const buf = await Storage.readMediaFile(projectId, mediaPath);
        if (!buf) { this._commitUrl(key, null); return null; }
        const url = URL.createObjectURL(new Blob([buf]));
        this._commitUrl(key, url);
        return url;
      } catch { this._commitUrl(key, null); return null; }
      finally { this.urlPending.delete(key); }
    })();
    this.urlPending.set(key, promise);
    return promise;
  },
  _commitUrl(key, url) {
    if (!this.urlPending.has(key)) {
      if (url) URL.revokeObjectURL(url);
      return;
    }
    this.urlCache.set(key, url);
  },
  clear() {
    for (const url of this.urlCache.values()) { if (url) URL.revokeObjectURL(url); }
    this.urlCache.clear();
    this.urlPending.clear();
    this.zipCache = null;
    this.zipLoading = null;
  }
};

function parseJsonArray(arr, file, start) {
  if (!Array.isArray(arr)) throw new Error(`File ${file} is not a JSON array.`);
  const out = [];
  let skipped = 0;
  let n = start;
  for (const e of arr) {
    if (!e || typeof e !== 'object' || !Object.hasOwn(e, 'message')) { skipped++; continue; }
    out.push({
      line_num: n++,
      file,
      name: stripNewlines(e.name),
      message: String(e.message || '').replace(/\r?\n/g, '\\n').trim(),
      trans_name: null,
      trans_message: null,
      is_translated: false
    });
  }
  return { lines: out, skipped };
}

async function parseFilesList(files, existing, start, onProgress, label = 'file') {
  existing = new Set(existing || []);
  const imported = [];
  const skipped = [];
  let invalidEntries = 0;
  let cur = start;
  const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    const bn = baseName(f.name);
    if (existing.has(bn)) { skipped.push(bn); continue; }
    const arr = JSON.parse(decodeBuffer(f.buffer));
    const parsed = parseJsonArray(arr, bn, cur);
    if (parsed.lines.length) {
      existing.add(bn);
      imported.push(...parsed.lines);
      cur += parsed.lines.length;
    }
    invalidEntries += parsed.skipped;
    onProgress(`${i + 1} / ${sorted.length} ${label}`, ((i + 1) / sorted.length) * 100);
    if (i % CFG.chunkSize.importBatch === 0) await yieldToEvent();
  }
  return { imported, skipped, invalidEntries, nextStart: cur, existing: Array.from(existing) };
}

async function parseZipJson(buffer, existing, start, onProgress) {
  assertJsZip();
  const zip = new JSZip();
  await zip.loadAsync(buffer);
  const files = [];
  for (const name of Object.keys(zip.files).filter(n => n.endsWith('.json') && !zip.files[n].dir)) {
    const entry = zip.file(name);
    if (entry) files.push({ name, buffer: await entry.async('uint8array') });
  }
  return parseFilesList(files, existing, start, onProgress, 'file');
}

const fileKeyOf = name => baseName(name).replace(/\.(json|xhtml|html)$/i, '').toLowerCase();

async function readJsonInputs(files) {
  const out = [];
  for (const f of Array.from(files)) {
    const buf = new Uint8Array(await f.arrayBuffer());
    if (isZipHead(buf)) {
      assertJsZip();
      const zip = new JSZip();
      await zip.loadAsync(buf);
      for (const name of Object.keys(zip.files).filter(n => n.toLowerCase().endsWith('.json') && !zip.files[n].dir)) {
        const entry = zip.file(name);
        if (entry) out.push({ name: baseName(name), buffer: await entry.async('uint8array') });
      }
    } else {
      out.push({ name: baseName(f.name), buffer: buf });
    }
  }
  return out;
}

function parseJsonEntries(arr, file) {
  if (!Array.isArray(arr)) throw new Error(`File ${file} is not a JSON array.`);
  const entries = [];
  for (let i = 0; i < arr.length; i++) {
    const e = arr[i];
    if (!e || typeof e !== 'object' || !Object.hasOwn(e, 'message')) {
      throw new Error(`File ${file}: entry #${i + 1} does not have a "message" field.`);
    }
    entries.push({
      name: e.name == null ? null : String(e.name),
      message: String(e.message ?? '')
    });
  }
  return { entries };
}

function groupLinesByFile(lines) {
  const grouped = new Map();
  for (const l of lines) {
    let arr = grouped.get(l.file);
    if (!arr) { arr = []; grouped.set(l.file, arr); }
    arr.push(l);
  }
  return grouped;
}

function buildFileKeyMap(files) {
  const m = new Map();
  for (const f of files) {
    const key = fileKeyOf(f);
    if (!m.has(key)) m.set(key, f);
  }
  return m;
}

async function parseEpub(buffer, tags, existing, start, projectId, onProgress) {
  assertJsZip();
  existing = new Set(existing || []);
  await Storage.writeEpub(projectId, buffer);
  const zip = new JSZip();
  await zip.loadAsync(buffer);
  const containerEntry = zip.file('META-INF/container.xml');
  if (!containerEntry) throw new Error('Invalid EPUB: missing META-INF/container.xml.');
  const containerXml = await containerEntry.async('text');
  const opfPath = Html.containerRoot(containerXml);
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) + '/' : '';
  const opfEntry = zip.file(opfPath);
  if (!opfEntry) throw new Error(`Invalid EPUB: missing OPF at ${opfPath}.`);
  const opfXml = await opfEntry.async('text');
  const { manifest, spine, coverHref } = Html.opfManifest(opfXml);
  const htmls = spine.map(idref => manifest[idref] ? opfDir + manifest[idref] : null).filter(Boolean);

  const imported = [];
  const skipped = [];
  const images = [];
  if (coverHref) {
    const coverPath = resolveZipPath(opfDir, coverHref);
    if (coverPath && zip.file(coverPath)) {
      images.push({ zipPath: coverPath, file: null, isCover: true, insertAfter: null });
    }
  }
  let cur = start;
  for (let i = 0; i < htmls.length; i++) {
    const path = htmls[i];
    if (existing.has(path)) { skipped.push(path); continue; }
    const entry = zip.file(path);
    if (!entry) continue;
    const html = await entry.async('text');
    const chapterDir = path.includes('/') ? path.substring(0, path.lastIndexOf('/')) + '/' : '';
    const { texts, images: chImages } = Html.extractContent(html, path.endsWith('.xhtml'), tags, chapterDir);
    const startNum = cur;
    for (const txt of texts) {
      imported.push({
        line_num: cur++,
        file: path,
        name: null,
        message: txt,
        trans_name: null,
        trans_message: null,
        is_translated: false
      });
    }
    for (const img of chImages) {
      images.push({
        zipPath: img.zipPath,
        file: path,
        isCover: false,
        insertAfter: img.afterIndex >= 0 ? (startNum + img.afterIndex) : null
      });
    }
    if (texts.length || chImages.length) existing.add(path);
    onProgress(`${i + 1} / ${htmls.length} file`, ((i + 1) / htmls.length) * 100);
    if (i % 20 === 0) await yieldToEvent();
  }
  return { imported, skipped, nextStart: cur, existing: Array.from(existing), images };
}

function lineToJsonEntry(l, forceOriginal) {
  const isT = forceOriginal ? false : !!l.is_translated;
  const name = isT ? (l.trans_name != null ? l.trans_name : l.name) : l.name;
  const msg = isT ? l.trans_message : l.message;
  const entry = {};
  if (name != null) entry.name = name.replace(/\\n/g, '\n');
  entry.message = (msg || '').replace(/\\n/g, '\n');
  return entry;
}

async function buildExportJson(lines, projectName, onProgress, suffix = 'export', forceOriginal = false, keepIf = null) {
  assertJsZip();
  const grouped = groupLinesByFile(lines);
  const entries = Array.from(grouped.entries());
  const results = [];
  for (let i = 0; i < entries.length; i++) {
    const [file, fileLines] = entries[i];
    const kept = keepIf ? fileLines.filter(keepIf) : fileLines;
    if (kept.length) {
      results.push({
        name: `${file.replace(/\.(xhtml|html|json)$/g, '')}.json`,
        content: JSON.stringify(kept.map(l => lineToJsonEntry(l, forceOriginal)), null, 2)
      });
    }
    onProgress(`${i + 1} / ${entries.length} file`, ((i + 1) / entries.length) * 100);
    if (i % CFG.chunkSize.importBatch === 0) await yieldToEvent();
  }
  if (!results.length) throw new Error('No entries to export after filter.');
  if (results.length > 1) {
    onProgress('Compressing ZIP...', 100);
    const zip = new JSZip();
    for (const r of results) zip.file(r.name, r.content);
    const blob = await zip.generateAsync({
      type: 'blob', mimeType: 'application/octet-stream',
      compression: 'DEFLATE', compressionOptions: { level: 9 }
    });
    return { blob, name: `${sanitizeName(projectName)}_${suffix}.zip`, multiple: true };
  }
  const r = results[0];
  const blob = new Blob([r.content], { type: 'application/json' });
  return { blob, name: r.name, multiple: false };
}

async function buildExportEpub(projectId, lines, tags, projectName, onProgress) {
  assertJsZip();
  const buffer = await Storage.readEpub(projectId);
  if (!buffer) throw new Error('EPUB not found in project. Re-import the EPUB to export.');
  const zip = new JSZip();
  await zip.loadAsync(buffer);
  const byFile = {};
  for (const l of lines) (byFile[l.file] ||= []).push(l);
  const paths = Object.keys(byFile);
  for (let pi = 0; pi < paths.length; pi++) {
    const path = paths[pi];
    const entry = zip.file(path);
    if (!entry) continue;
    const html = await entry.async('text');
    const xmlMatch = html.match(/^<\?xml.*?\?>/i);
    const replacements = byFile[path].map(l => (l.is_translated && l.trans_message) ? l.trans_message : null);
    let out = Html.rewriteTags(html, path.endsWith('.xhtml'), tags, replacements);
    if (xmlMatch && !out.startsWith('<?xml')) out = xmlMatch[0] + '\n' + out;
    zip.file(path, out);
    onProgress(`${pi + 1} / ${paths.length} file`, ((pi + 1) / paths.length) * 100);
    if (pi % 20 === 0) await yieldToEvent();
  }
  if (zip.file('mimetype')) {
    zip.file('mimetype', await zip.file('mimetype').async('text'), { compression: 'STORE' });
  }
  onProgress('Compressing EPUB...', 100);
  const blob = await zip.generateAsync({
    type: 'blob', mimeType: 'application/epub+zip',
    compression: 'DEFLATE', compressionOptions: { level: 9 }
  });
  return { blob, name: `${sanitizeName(projectName)}_tl.epub` };
}

async function compressZip(zip, mimeType, level = 9) {
  return await zip.generateAsync({
    type: 'blob', mimeType,
    compression: 'DEFLATE', compressionOptions: { level }
  });
}

async function addProjectDirToZip(zip, projectId, prefix, onProgress, label) {
  const root = await Storage.root();
  const dir = await Storage._projectDir(root, projectId, false);
  const queue = [['', dir]];
  let processed = 0;
  while (queue.length) {
    const [rel, cur] = queue.shift();
    for await (const [name, h] of cur.entries()) {
      const path = rel ? `${rel}/${name}` : name;
      const zipPath = prefix ? `${prefix}/${path}` : path;
      if (h.kind === 'directory') {
        zip.folder(zipPath);
        queue.push([path, h]);
      } else {
        zip.file(zipPath, await h.getFile());
        processed++;
      }
      if (onProgress && processed > 0 && processed % 20 === 0) {
        onProgress(`${label}: ${processed} files`, undefined);
        await yieldToEvent();
      }
    }
  }
}

async function buildProjectBackup(id, name, onProgress) {
  assertJsZip();
  const zip = new JSZip();
  zip.file('backup.json', JSON.stringify({ format: BACKUP_FORMAT_PROJECT, version: BACKUP_VERSION, originalId: id, originalName: name, createdAt: Date.now() }));
  onProgress('Reading project...', 30);
  await addProjectDirToZip(zip, id, 'project', onProgress, 'Backup');
  onProgress('Compressing backup...', 90);
  const blob = await compressZip(zip, 'application/octet-stream');
  return { blob, name: `${sanitizeName(name)}_backup.cstl`, warnings: [] };
}

async function backupAll(onProgress) {
  assertJsZip();
  const items = await Storage.listProjects();
  if (!items.length) throw new Error('No Projects to backup yet.');
  const total = items.length;
  const outer = new JSZip();
  outer.file('backup.json', JSON.stringify({ format: BACKUP_FORMAT_ALL, version: BACKUP_VERSION, createdAt: Date.now() }));
  const warnings = [];
  onProgress(`0 / ${total} project`, 0);
  const root = await Storage.root();

  onProgress('Backing up app data...', 5);
  try {
    const appDir = await root.getDirectoryHandle(APP_DIR);
    await addDirToZip(outer, appDir, 'app');
  } catch (e) { if (e?.name !== 'NotFoundError') warnings.push(`app/: ${e?.message || e}`); }

  onProgress('Backing up plugins...', 10);
  try {
    const pluginsDir = await root.getDirectoryHandle(PLUGINS_DIR);
    await addDirToZip(outer, pluginsDir, 'plugins');
  } catch (e) { if (e?.name !== 'NotFoundError') warnings.push(`plugins/: ${e?.message || e}`); }

  for (let i = 0; i < total; i++) {
    onProgress(`Processing ${i + 1} / ${total} project`, 10 + (i / total) * 85);
    try {
      await addProjectDirToZip(outer, items[i].id, `projects/${items[i].id}`, onProgress, `Project ${i + 1}/${total}`);
    } catch (e) {
      warnings.push(`${items[i].id || items[i].name}: ${e?.message || e}`);
    }
    onProgress(`${i + 1} / ${total} project done`, 10 + ((i + 1) / total) * 85);
    await yieldToEvent();
  }
  onProgress('Compressing main archive...', 98);
  const blob = await compressZip(outer, 'application/octet-stream');
  return { blob, name: `ProjectBackupAll_${new Date().toISOString().slice(0, 10)}.cstl`, warnings };
}

async function addDirToZip(zip, dir, prefix) {
  const queue = [['', dir]];
  while (queue.length) {
    const [rel, cur] = queue.shift();
    for await (const [name, h] of cur.entries()) {
      const path = rel ? `${rel}/${name}` : name;
      const zipPath = `${prefix}/${path}`;
      if (h.kind === 'directory') {
        zip.folder(zipPath);
        queue.push([path, h]);
      } else {
        zip.file(zipPath, await h.getFile());
      }
    }
  }
}

async function writeZipEntriesToDir(zip, prefix, dirHandle, onProgress, label) {
  const entries = Object.values(zip.files).filter(e => !e.dir && e.name.startsWith(prefix));
  let done = 0;
  for (const entry of entries) {
    const relPath = entry.name.slice(prefix.length);
    if (!relPath) continue;
    const parts = relPath.split('/');
    let cur = dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
      cur = await cur.getDirectoryHandle(parts[i], { create: true });
    }
    const bytes = await entry.async('uint8array');
    await Storage._writeFile(cur, parts[parts.length - 1], bytes);
    done++;
    if (onProgress && done % 20 === 0) {
      onProgress(`${label}: ${done} files`, undefined);
      await yieldToEvent();
    }
  }
  return done;
}

async function writeProjectDirFromZip(zip, projectId, onProgress) {
  await Storage.createProjectDir(projectId);
  const root = await Storage.root();
  const projectDir = await Storage._projectDir(root, projectId, true);
  return writeZipEntriesToDir(zip, 'project/', projectDir, onProgress, 'Restoring');
}

async function writeAppDirFromZip(zip) {
  const root = await Storage.root();
  const appDir = await root.getDirectoryHandle(APP_DIR, { create: true });
  await writeZipEntriesToDir(zip, 'app/', appDir);
}

async function writePluginsDirFromZip(zip) {
  const root = await Storage.root();
  const pluginsDir = await root.getDirectoryHandle(PLUGINS_DIR, { create: true });
  await writeZipEntriesToDir(zip, 'plugins/', pluginsDir);
}

async function readBackupMeta(zip) {
  const f = zip.file('backup.json');
  if (!f) return null;
  return JSON.parse(await f.async('text'));
}

function validateBackupMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    throw new Error('Backup is missing or invalid metadata (backup.json).');
  }
  if (typeof meta.version !== 'number') {
    throw new Error('Backup has no version field.');
  }
  if (meta.version > BACKUP_VERSION) {
    throw new Error(`Backup format v${meta.version} is newer than this app supports (v${BACKUP_VERSION}). Update CSTL and try again.`);
  }
  return meta;
}

async function restoreProjectFromZip(zip, fallbackName, onProgress) {
  const meta = validateBackupMeta(await readBackupMeta(zip));
  const projectJsonFile = zip.file('project/project.json');
  if (!projectJsonFile) throw new Error('Project file not found in backup.');
  const data = JSON.parse(await projectJsonFile.async('text'));
  if (!data.projectName) data.projectName = fallbackName || 'Restored Project';
  const newId = makeProjId();
  await writeProjectDirFromZip(zip, newId, onProgress);
  await Storage.upsertProjectIndexEntry(Storage.projectIndexEntry(newId, data, Date.now()));
  return data.projectName;
}

async function restoreAllFromZip(zip, onProgress) {
  const meta = validateBackupMeta(await readBackupMeta(zip));
  const projectPrefixes = new Set();
  for (const name of Object.keys(zip.files)) {
    if (name.startsWith('projects/')) {
      const parts = name.slice('projects/'.length).split('/');
      if (parts.length > 1) projectPrefixes.add(parts[0]);
    }
  }
  if (!projectPrefixes.size) throw new Error('No projects found in backup.');
  await writeAppDirFromZip(zip);
  await writePluginsDirFromZip(zip);
  const total = projectPrefixes.size;
  const errors = [];
  let ok = 0;
  let idx = 0;
  for (const projId of projectPrefixes) {
    idx++;
    onProgress(`Restoring ${idx} / ${total} project`, (idx / total) * 100);
    try {
      const projectJsonFile = zip.file(`projects/${projId}/project.json`);
      if (!projectJsonFile) { errors.push({ name: projId, message: 'project.json missing' }); continue; }
      const data = JSON.parse(await projectJsonFile.async('text'));
      const newId = makeProjId();
      await writeProjectDirFromZipById(zip, projId, newId);
      await Storage.upsertProjectIndexEntry(Storage.projectIndexEntry(newId, data, Date.now()));
      ok++;
    } catch (e) {
      errors.push({ name: projId, message: e?.message || String(e) });
    }
    await yieldToEvent();
  }
  return { single: false, ok, fail: errors.length, errors };
}

async function writeProjectDirFromZipById(zip, srcId, newId) {
  await Storage.createProjectDir(newId);
  const root = await Storage.root();
  const projectDir = await Storage._projectDir(root, newId, true);
  return writeZipEntriesToDir(zip, `projects/${srcId}/`, projectDir);
}

async function parseRestore(buffer, fallbackName, onProgress) {
  assertJsZip();
  const zip = new JSZip();
  await zip.loadAsync(buffer);

  if (zip.file('project/project.json')) {
    onProgress('Reading project...', 0);
    const name = await restoreProjectFromZip(zip, fallbackName, onProgress);
    onProgress('Saving project...', 100);
    return { single: true, name };
  }
  if (zip.file('backup.json')) {
    onProgress('Restoring full backup...', 0);
    return await restoreAllFromZip(zip, onProgress);
  }
  throw new Error('Invalid archive format.');
}

function buildRe(query, regex, exact, caseSensitive) {
  if (!query) return null;
  try {
    let p = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (exact) p = `(?<![\\p{L}\\p{N}_])${p}(?![\\p{L}\\p{N}_])`;
    return new RegExp(p, caseSensitive ? 'gu' : 'giu');
  } catch { return null; }
}

function proofreadSearch(lines, query, regex, exact, caseSensitive, scope, translatedOnly) {
  const re = buildRe(query, regex, exact, caseSensitive);
  const matches = [];
  for (const l of lines) {
    if (translatedOnly && !l.is_translated) continue;
    const on = l.name || '';
    const tn = l.is_translated ? (l.trans_name || '').trim() || l.name : null;
    const msg = translatedOnly ? l.trans_message : l.message;
    const name = translatedOnly ? tn : on;
    if (query && re) {
      let found = false;
      re.lastIndex = 0;
      if ((scope === 'all' || scope === 'message') && msg && re.test(msg)) found = true;
      re.lastIndex = 0;
      if (!found && (scope === 'all' || scope === 'name') && name && re.test(name)) found = true;
      if (!found) continue;
    }
    matches.push({
      num: l.line_num,
      file: l.file,
      origName: l.name || '',
      origMsg: l.message,
      transName: l.is_translated ? (l.trans_name || '').trim() || l.name : null,
      transMsg: l.trans_message,
      isTrans: !!l.is_translated
    });
  }
  return matches;
}

function replaceAll(lines, query, replace, regex, exact, caseSensitive, scope, translatedOnly) {
  const re = buildRe(query, regex, exact, caseSensitive);
  if (!re) return { modified: [], count: 0 };
  const modified = [];
  let count = 0;
  for (const l of lines) {
    if (translatedOnly && !l.is_translated) continue;
    let replaced = false;
    const m = { line_num: l.line_num, message: l.message, trans_message: l.trans_message, name: l.name, trans_name: l.trans_name };
    const msgProp = translatedOnly ? 'trans_message' : 'message';
    const nameProp = translatedOnly ? 'trans_name' : 'name';
    if ((scope === 'all' || scope === 'message') && l[msgProp]) {
      const v = l[msgProp].replace(re, replace);
      if (v !== l[msgProp]) { m[msgProp] = v; replaced = true; }
    }
    if ((scope === 'all' || scope === 'name') && l[nameProp]) {
      const v = l[nameProp].replace(re, replace);
      if (v !== l[nameProp]) { m[nameProp] = v; replaced = true; }
    }
    if (replaced) { modified.push(m); count++; }
  }
  return { modified, count };
}

const Vndb = {
  async fetchCharacters(id) {
    const all = [];
    let page = 1, more = true;
    while (more) {
      const res = await fetch('https://api.vndb.org/kana/character', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: ['vn', '=', ['id', '=', id]],
          fields: 'name, original, aliases',
          results: 100,
          page
        })
      });
      if (!res.ok) throw new Error(`Status: ${res.status}`);
      const data = await res.json();
      if (data.results) all.push(...data.results);
      more = data.more || false;
      page++;
    }
    return all;
  },
  buildGlossary(chars) {
    const map = new Map();
    const add = (jp, en) => {
      jp = (jp || '').trim();
      en = (en || '').trim();
      if (jp && en && isJapanese(jp) && !map.has(jp)) map.set(jp, en);
    };
    for (const c of chars) {
      if (!c.name || !c.original) continue;
      add(c.original, c.name);
      if (c.original.includes(' ') && c.name.includes(' ')) {
        const kana = c.original.split(' '), en = c.name.split(' ');
        if (kana.length === en.length) kana.forEach((k, i) => add(k, en[i]));
      }
      const ja = (c.aliases || []).filter(isJapanese);
      const en = (c.aliases || []).filter(a => !isJapanese(a));
      const fallback = c.name.split(' ').pop() || c.name;
      ja.forEach((j, i) => add(j, en[i] || fallback));
    }
    return Array.from(map.entries()).sort((a, b) => b[0].length - a[0].length);
  }
};

const SHORTCUT_ACTIONS = [
  { id: 'dash.new', label: 'Create New Project', scope: 'dashboard', def: '', run: () => els.btnNewProject.click() },
  { id: 'dash.restore', label: 'Restore Project', scope: 'dashboard', def: '', run: () => els.btnRestoreProject.click() },
  { id: 'dash.settings', label: 'Open Main Settings', scope: 'dashboard', def: '', run: () => els.btnDashboardSettings.click() },
  { id: 'dash.search', label: 'Focus Project Search', scope: 'dashboard', def: '/', run: () => els.projectSearch.focus() },
  { id: 'work.importFile', label: 'Import File', scope: 'workspace', def: '', run: () => { closeDropdowns(); els.importFileInput.click(); } },
  { id: 'work.importFolder', label: 'Import Folder', scope: 'workspace', def: '', run: () => { closeDropdowns(); els.importFolderInput.click(); } },
  { id: 'work.importZip', label: 'Import ZIP', scope: 'workspace', def: '', run: () => { closeDropdowns(); els.importZipInput.click(); } },
  { id: 'work.export', label: 'Export Project', scope: 'workspace', def: 'Alt+E', run: () => Exporter.run() },
  { id: 'work.proofread', label: 'Open Find & Replace', scope: 'workspace', def: 'Alt+R', run: () => els.btnProofread.click() },
  { id: 'work.glossary', label: 'Open Glossary', scope: 'workspace', def: 'Alt+G', run: () => els.btnGlossary.click() },
  { id: 'work.context', label: 'Open Context', scope: 'workspace', def: 'Alt+X', run: () => els.btnContext.click() },
  { id: 'work.settings', label: 'Open Project Settings', scope: 'workspace', def: 'Alt+S', run: () => els.btnSettings.click() },
  { id: 'work.toggleToolbar', label: 'Show/Hide Toolbar', scope: 'workspace', def: 'Alt+T', run: () => els.btnToggleHeader.click() },
  { id: 'work.back', label: 'Back to Dashboard', scope: 'workspace', def: 'Alt+B', run: () => App.closeProject() },
  { id: 'work.selectAll', label: 'Select All Lines', scope: 'workspace', def: 'Alt+A', run: () => els.btnSelectAll.click() },
  { id: 'work.clearSelection', label: 'Clear Selection', scope: 'workspace', def: 'Alt+Q', run: () => els.btnClearSelection.click() },
  { id: 'work.selectRange', label: 'Select Line Range', scope: 'workspace', def: 'Alt+L', run: () => App.selectRange() },
  { id: 'work.copy', label: 'Copy for AI', scope: 'workspace', def: 'Alt+C', run: () => App.copyForAi() },
  { id: 'work.paste', label: 'Focus AI Result Column', scope: 'workspace', def: 'Alt+V', inInputs: true, run: () => els.pasteArea.focus() },
  { id: 'work.apply', label: 'Apply Translation', scope: 'workspace', def: 'Ctrl+Enter', inInputs: true, run: () => App.applyTranslation() },
  { id: 'work.undo', label: 'Undo', scope: 'workspace', def: 'Alt+Z', run: () => App.undo() },
  { id: 'work.redo', label: 'Redo', scope: 'workspace', def: 'Alt+Y', run: () => App.redo() },
  { id: 'work.bookmarks', label: 'Open Bookmark Panel', scope: 'workspace', def: 'Alt+M', run: () => App.toggleBookmarkPanel(!els.bookmarkPanel.classList.contains('show')) }
];

const IGNORED_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified', 'ContextMenu', 'Fn', 'FnLock', 'NumLock', 'ScrollLock', 'Hyper', 'Super', 'Compose', 'Process']);

const CODE_MAP = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Escape', Backspace: 'Backspace',
  Delete: 'Delete', Tab: 'Tab', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert',
  Slash: '/', Period: '.', Comma: ',', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`',
  NumpadDivide: '/', NumpadMultiply: '*', NumpadSubtract: '-', NumpadAdd: '+', NumpadDecimal: '.'
};

function normalizeKey(e) {
  if (IGNORED_KEYS.has(e.key)) return null;
  const code = e.code || '';
  const m = code.match(/^(?:Key([A-Z])|Digit(\d))$/);
  if (m) return m[1] || m[2];
  if (CODE_MAP[code]) return CODE_MAP[code];
  if (/^F\d{1,2}$/.test(code)) return code;
  const k = e.key || '';
  if (k.length === 1) return k.toUpperCase();
  return null;
}

function comboFromEvent(e) {
  const key = normalizeKey(e);
  if (!key) return null;
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

function comboHtml(combo) {
  return combo.split('+').map(p => `<kbd>${escapeHtml(p)}</kbd>`).join('<span class="kbd-plus">+</span>');
}

function isEditableTarget(t) {
  if (!t) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

const Shortcuts = {
  _actions: [],
  _map: new Map(),
  _recording: null,
  _bindings: {},

  async init() {
    Shortcuts._actions = SHORTCUT_ACTIONS.slice();
    document.addEventListener('keydown', e => Shortcuts._onKey(e));
    const raw = await Storage.readShortcuts();
    const b = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
    for (const k of Object.keys(b)) {
      if (typeof b[k] === 'string' && b[k]) Shortcuts._bindings[k] = b[k];
    }
    Shortcuts.rebuild();
  },

  allActions() { return Shortcuts._actions; },

  loadBindings() { return Shortcuts._bindings; },

  saveBindings(b) {
    Shortcuts._bindings = (b && typeof b === 'object' && !Array.isArray(b)) ? b : {};
    if (Object.keys(Shortcuts._bindings).length) {
      Storage.writeShortcuts(Shortcuts._bindings).catch(e => console.error('[shortcuts] save failed:', e));
    } else {
      Storage.removeShortcuts().catch(e => console.error('[shortcuts] remove failed:', e));
    }
  },

  resetBindings() {
    Shortcuts._bindings = {};
    Storage.removeShortcuts().catch(e => console.error('[shortcuts] reset failed:', e));
    Shortcuts.rebuild();
  },

  bindingFor(action) {
    const b = Shortcuts._bindings;
    return action.id in b ? b[action.id] : (action.def || '');
  },

  rebuild() {
    Shortcuts._map = new Map();
    const b = Shortcuts.loadBindings();
    for (const a of Shortcuts.allActions()) {
      const combo = a.id in b ? b[a.id] : (a.def || '');
      if (combo && !Shortcuts._map.has(combo)) Shortcuts._map.set(combo, a.id);
    }
  },

  _onKey(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (Shortcuts._recording) return;
    if (anyModalOpen()) return;
    if (els.busyOverlay.classList.contains('open')) return;
    const combo = comboFromEvent(e);
    if (!combo) return;
    const actionId = Shortcuts._map.get(combo);
    if (actionId) {
      const action = Shortcuts.allActions().find(a => a.id === actionId);
      if (!action) return;
      if (isEditableTarget(e.target) && !action.inInputs) return;
      const dashOpen = els.dashboardView.classList.contains('open');
      if (action.scope === 'dashboard' && !dashOpen) return;
      if (action.scope === 'workspace' && dashOpen) return;
      e.preventDefault();
      try { action.run(); } catch (err) { console.error('[shortcut]', actionId, err); }
      return;
    }
    if (window.CSTL?.plugins) {
      for (const ps of CSTL.plugins.listPluginShortcuts()) {
        if (ps.combo && ps.combo === combo) {
          if (isEditableTarget(e.target) && !ps.opts.inInputs) return;
          const dashOpen = els.dashboardView.classList.contains('open');
          const scope = ps.opts.scope || 'workspace';
          if (scope === 'dashboard' && !dashOpen) continue;
          if (scope === 'workspace' && dashOpen) continue;
          e.preventDefault();
          try { ps.handler(); } catch (err) { console.error('[plugin shortcut]', ps.id, err); }
          return;
        }
      }
    }
  },

  startRecording(action, btn) {
    if (Shortcuts._recording) Shortcuts.stopRecording();
    Shortcuts._recording = { action, btn };
    btn.classList.add('recording');
    btn.textContent = 'Press a key…';
    document.addEventListener('keydown', Shortcuts._handleRecordKey, true);
  },

  stopRecording() {
    if (!Shortcuts._recording) return;
    document.removeEventListener('keydown', Shortcuts._handleRecordKey, true);
    Shortcuts._recording = null;
    App.renderShortcutList();
  },

  _handleRecordKey(e) {
    const rec = Shortcuts._recording;
    if (!rec) return;
    if (!els.shortcutModal.classList.contains('open')) { Shortcuts.stopRecording(); return; }
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { Shortcuts.stopRecording(); return; }
    if (e.key === 'Backspace') { Shortcuts.applyBinding(rec.action, ''); return; }
    const combo = comboFromEvent(e);
    if (!combo) return;
    Shortcuts.applyBinding(rec.action, combo);
  },

  applyBinding(action, combo) {
    Shortcuts.stopRecording();
    if (combo) {
      const owner = Shortcuts.allActions().find(a => a.id !== action.id && Shortcuts.bindingFor(a) === combo);
      if (owner) {
        Shortcuts.showStatus(`"${combo.replace(/\+/g, ' + ')}" is already in use: ${owner.label}`, true);
        return;
      }
    }
    const b = Shortcuts.loadBindings();
    if (combo) b[action.id] = combo; else delete b[action.id];
    Shortcuts.saveBindings(b);
    Shortcuts.rebuild();
    App.renderShortcutList();
    Shortcuts.showStatus(combo ? `Binding saved: ${combo.replace(/\+/g, ' + ')}.` : 'Binding deleted.');
  },

  showStatus(msg, isError = false) {
    const el = els.shortcutStatus;
    if (!el) return;
    clearTimeout(Shortcuts._statusTimer);
    el.textContent = msg;
    el.hidden = false;
    el.classList.toggle('error', isError);
    Shortcuts._statusTimer = setTimeout(() => {
      el.hidden = true;
      el.classList.remove('error');
    }, CFG.toastTimeoutMs);
  }
};

const els = {};

function cacheEls() {
  const ids = [
    'dashboardView', 'workspaceView', 'projectList',
    'projectCount', 'projectSearch', 'projectSearchClear', 'projectSort', 'projectSortBox', 'projectSortTrigger', 'projectSortMenu', 'projectSortLabel',
    'btnNewProject', 'btnRestoreProject', 'btnDashboardSettings', 'btnDashboardSettingsClose',
    'btnBackupAll', 'btnWipeAllData',
    'btnBackToDashboard', 'projectNameDisplay', 'dynamicToolbarWrap',
    'workspaceToolbar', 'btnToggleHeader', 'btnShowHeader',
    'btnImportMain', 'importDropdown',
    'btnImportFile', 'btnImportFolder', 'btnImportZip',
    'btnImportTranslation', 'btnImportUntranslated', 'btnImportOriginal',
    'importFileInput', 'importFolderInput', 'importZipInput',
    'importTranslationInput', 'importUntranslatedInput', 'importOriginalInput',
    'restoreProjectInput',
    'btnExport', 'exportDropdown', 'btnExportProject', 'btnExportTranslation', 'btnExportUntranslated', 'btnExportOriginal',
    'btnProofread', 'btnGlossary', 'btnContext', 'btnSettings',
    'previewViewport', 'previewContainer', 'stickyFileBar', 'stickyFileName', 'stickyFileRange', 'stickyFileCheckbox',
    'progressText',
    'rangeFromInput', 'rangeToInput', 'btnSelectRange', 'btnClearSelection', 'btnSelectAll', 'btnCopyForAi',
    'copyStatus', 'pasteArea', 'btnUndo', 'btnApply', 'btnRedo',
    'nameTotalCount', 'nameTableBody',
    'btnCopyAllNames', 'copyNamesDropdown',
    'btnCopyNamesPlain', 'btnCopyNamesWithGlossary', 'btnCopyNamesMissingGlossary',
    'settingsModal', 'btnSettingsBasicReset', 'settingsIgnoreNameCheck', 'settingsPromptCheck',
    'settingsJumpToContextCheck', 'settingsHideToolsCheck',
    'btnSettingsIncrementReset', 'settingsIncrementCheck', 'incrementStepWrap', 'settingsIncrementStepInput',
    'btnSettingsPromptReset', 'settingsPromptInput', 'btnSettingsEpubReset', 'settingsEpubTagsInput',
    'btnSettingsCancel', 'btnSettingsSave',
    'glossaryModal', 'btnGlossaryVndbReset', 'glossaryVndbCheck', 'glossaryVndbWrap',
    'glossaryVndbIdInput', 'btnGlossaryVndbFetch', 'glossaryVndbStatus', 'glossaryVndbPreviewArea',
    'btnGlossaryCustomReset', 'glossaryCustomCheck', 'glossaryCustomWrap', 'glossaryCustomInput',
    'btnGlossaryCancel', 'btnGlossarySave',
    'contextModal', 'btnSummaryReset', 'summaryEnabledCheck', 'summaryWrap',
    'summaryPromptInput', 'summaryStoredInput', 'btnSummaryPromptReset', 'btnSummaryStoredReset', 'btnContextCancel', 'btnContextSave',
    'lineEditorModal', 'lineEditorTitle', 'lineOriginalView', 'lineNameWrap',
    'lineNameInput', 'lineMessageInput', 'lineTranslatedCheck', 'btnLineCancel', 'btnLineSave',
    'proofreadModal', 'proofreadSearchInput', 'proofreadScope', 'proofreadRegexCheck',
    'proofreadCaseCheck', 'proofreadExactCheck', 'proofreadTranslatedOnlyCheck',
    'btnProofreadReset', 'proofreadReplaceInput', 'btnProofreadReplaceAll',
    'proofreadStatus', 'proofreadContainer', 'btnProofreadClose',
    'dashboardSettingsModal', 'shortcutModal', 'shortcutStatus', 'shortcutList', 'btnShortcutsOpen', 'btnShortcutsClose', 'btnShortcutsResetAll',
    'btnOpenPlugins',
    'pluginPanels',
    'opfsExplorerModal', 'btnOpfsExplorerOpen', 'btnOpfsExplorerClose',
    'opfsList', 'opfsEmpty', 'opfsEmptyText', 'opfsCrumbs', 'opfsLoading', 'btnOpfsRefresh',
    'busyOverlay', 'busyTitle', 'busyMsg', 'busyBarFill', 'busyActions', 'busyCancel',
    'btnBookmarks', 'bookmarkPanel',
    'bookmarkPanelCount', 'bookmarkList', 'btnBookmarkClear'
  ];
  for (const id of ids) els[id] = $(id);
  els.split = document.querySelector('.split');
  els.heroActions = document.querySelector('.hero .actions');
}

const Progress = {
  _onCancel: null,
  _open(title, msg, determinate, onCancel) {
    els.busyTitle.textContent = title;
    els.busyMsg.textContent = msg;
    els.busyBarFill.classList.toggle('determinate', determinate);
    els.busyBarFill.style.width = determinate ? '0%' : '';
    Progress._onCancel = typeof onCancel === 'function' ? onCancel : null;
    els.busyActions.hidden = !Progress._onCancel;
    els.busyCancel.disabled = false;
    els.busyOverlay.classList.add('open');
  },
  show(title, msg = '') { Progress._open(title, msg, false); },
  determinate(title, msg = '') { Progress._open(title, msg, true); },
  cancellableDeterminate(title, msg, onCancel) { Progress._open(title, msg, true, onCancel); },
  update(msg, pct) {
    if (msg !== undefined && typeof msg === 'string') els.busyMsg.textContent = msg;
    if (pct !== undefined && els.busyBarFill.classList.contains('determinate')) {
      els.busyBarFill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    }
  },
  disableCancel() {
    Progress._onCancel = null;
    els.busyActions.hidden = true;
  },
  cancel() {
    const cb = Progress._onCancel;
    Progress.disableCancel();
    if (typeof cb === 'function') {
      try { cb(); } catch (e) { console.error('[progress] onCancel error:', e); }
    }
  },
  hide() {
    Progress.disableCancel();
    els.busyCancel.disabled = false;
    els.busyOverlay.classList.remove('open');
  }
};

const State = {
  projectId: null,
  files: [],
  lines: [],
  rows: [],
  byNum: new Map(),
  fileLines: new Map(),
  headerIdx: [],
  selected: new Set(),
  bookmarkSet: new Set(),
  undoStack: [],
  redoStack: [],
  saveTimer: null,
  contentVersion: 0,
  translatedCount: 0,
  namesDirty: true
};

for (const f of STATE_SCHEMA) State[f.key] = f.def;

State.toData = () => {
  const data = {
    version: VERSION,
    imported_files: State.files,
    lines: State.lines.map(lineToStorage)
  };
  for (const f of STATE_SCHEMA) {
    data[f.store || f.key] = State[f.key];
  }
  return data;
};

State.maxLineNum = () => State.lines.reduce((m, l) => Math.max(m, l.line_num), 0);
State.nextLineNum = () => State.lines.length ? State.maxLineNum() + 1 : 1;
State.indexOfLine = num => State.rows.findIndex(r => r.type === 'line' && r.line.line_num === num);

State.loadFromData = (data) => {
  State.files = data.imported_files || [];
  State.lines = (data.lines || []).map(lineFromStorage);
  for (const f of STATE_SCHEMA) {
    const v = data[f.store || f.key];
    const d = schemaDefault(f);
    State[f.key] = f.coerce ? (v || d) : (v ?? d);
  }
  if (!State.projectName) State.projectName = 'Unknown';
};

State.resetTransient = () => {
  State.projectId = null;
  State.files = [];
  State.lines = [];
  State.rows = [];
  State.headerIdx = [];
  State.byNum.clear();
  State.fileLines.clear();
  State.selected.clear();
  State.undoStack = [];
  State.redoStack = [];
  State.translatedCount = 0;
  State.namesDirty = true;
  for (const f of STATE_SCHEMA) State[f.key] = schemaDefault(f);
};

State.updateCount = () => {
  State.translatedCount = 0;
  const lines = State.lines;
  for (let i = 0, n = lines.length; i < n; i++) if (lines[i].is_translated) State.translatedCount++;
};

State.rebuild = () => {
  State.byNum.clear();
  State.fileLines.clear();
  State.rows = [];
  State.headerIdx = [];
  const files = State.files;
  const grouped = new Array(files.length);
  const fileIdx = new Map();
  for (let i = 0; i < files.length; i++) {
    fileIdx.set(files[i], i);
    grouped[i] = [];
  }
  const lines = State.lines;
  for (let i = 0, n = lines.length; i < n; i++) {
    const l = lines[i];
    State.byNum.set(l.line_num, l);
    const gi = fileIdx.get(l.file);
    if (gi !== undefined) grouped[gi].push(l);
  }

  const coverImages = [];
  const imagesByFile = new Map();
  for (const im of (State.images || [])) {
    if (im.isCover) { coverImages.push(im); continue; }
    let arr = imagesByFile.get(im.file);
    if (!arr) { arr = []; imagesByFile.set(im.file, arr); }
    arr.push(im);
  }
  for (const arr of imagesByFile.values()) {
    arr.sort((a, b) => (a.insertAfter ?? -1) - (b.insertAfter ?? -1));
  }

  for (const im of coverImages) State.rows.push({ type: 'image', img: im });

  for (let i = 0; i < files.length; i++) {
    const fileLines = grouped[i];
    const fileImages = imagesByFile.get(files[i]) || [];
    if (!fileLines.length && !fileImages.length) continue;
    State.fileLines.set(files[i], fileLines);
    State.headerIdx.push(State.rows.length);
    State.rows.push({ type: 'header', file: files[i] });
    let imgPtr = 0;
    while (imgPtr < fileImages.length && fileImages[imgPtr].insertAfter == null) {
      State.rows.push({ type: 'image', img: fileImages[imgPtr] });
      imgPtr++;
    }
    for (let j = 0, m = fileLines.length; j < m; j++) {
      State.rows.push({ type: 'line', line: fileLines[j] });
      while (imgPtr < fileImages.length && fileImages[imgPtr].insertAfter === fileLines[j].line_num) {
        State.rows.push({ type: 'image', img: fileImages[imgPtr] });
        imgPtr++;
      }
    }
    while (imgPtr < fileImages.length) {
      State.rows.push({ type: 'image', img: fileImages[imgPtr] });
      imgPtr++;
    }
  }
  if (State.bookmarks.length) {
    State.bookmarks = State.bookmarks.filter(n => State.byNum.has(n));
  }
  State.bookmarkSet = new Set(State.bookmarks);
};

State.queueSave = () => {
  if (!State.projectId) return;
  clearTimeout(State.saveTimer);
  State.saveTimer = setTimeout(() => {
    requestIdleCallback(async () => {
      if (!State.projectId) return;
      try {
        const data = State.toData();
        if (window.CSTL?.plugins) await CSTL.plugins.runHooks('beforeSave', data);
        await Storage.saveProject(State.projectId, data);
        await Storage.upsertProjectIndexEntry(Storage.projectIndexEntry(State.projectId, data, Date.now()));
        App.flashSaved();
        if (window.CSTL?.plugins) await CSTL.plugins.runHooks('afterSave', data);
      } catch (e) {
        if (e?.storage) { App.flash("Couldn't save: " + e.message, true); }
        else { console.error('[autosave]', e); }
      }
    });
  }, 500);
};

class Scroller {
  constructor(viewport, container, create, update, keyOf) {
    this.vp = viewport;
    this.container = container;
    this.create = create;
    this.update = update;
    this.keyOf = keyOf || ((item, i) => i);
    this.items = [];
    this.keys = [];
    this.heights = [];
    this.pos = [];
    this.els = [];
    this.indices = [];
    this.heightCache = new Map();
    this.measuredKeys = new Set();
    this.defaultH = CFG.scroller.defaultH;
    this.gap = CFG.scroller.gap;
    this.topPad = CFG.scroller.topPad;
    this.botPad = CFG.scroller.botPad;
    this.headerH = CFG.scroller.headerH;
    this.overscan = CFG.scroller.overscan;
    this.recyclePos = CFG.scroller.recyclePos;
    this.maxPasses = CFG.scroller.maxRenderPasses;
    this.defaultVH = CFG.scroller.defaultViewportH;
    this.scrollTop = 0;
    this.totalH = 0;
    this.scheduled = false;
    this.avgHeight = 0;
    this._measuredCount = 0;

    viewport.addEventListener('scroll', () => {
      this.scrollTop = viewport.scrollTop;
      this.schedule();
    }, { passive: true });

    this.lastVpWidth = viewport.clientWidth;
    new ResizeObserver(() => {
      const w = viewport.clientWidth;
      if (w !== this.lastVpWidth && this.lastVpWidth > 0 && w > 0) {
        this.lastVpWidth = w;
        this.heightCache.clear();
        this.measuredKeys.clear();
        this.avgHeight = 0;
        this._measuredCount = 0;
        this.invalidate();
      } else {
        this.lastVpWidth = w;
      }
      this.schedule();
    }).observe(viewport);
  }

  _estHeight(it) {
    if (it?.type === 'header') return this.headerH;
    return this.avgHeight > 0 ? this.avgHeight : this.defaultH;
  }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => { this.scheduled = false; this.render(); });
  }

  setItems(items, keep = false) {
    const prevScroll = keep ? this.vp.scrollTop : 0;
    const prevHeightByKey = keep && this.keys.length === this.heights.length
      ? new Map(this.keys.map((k, i) => [k, this.heights[i]]))
      : null;
    this.items = items;
    this.keys = items.map((it, i) => this.keyOf(it, i));
    if (!keep) {
      this.heightCache.clear();
      this.measuredKeys.clear();
      this.avgHeight = 0;
      this._measuredCount = 0;
      this.heights = items.map(it => this._estHeight(it));
    } else {
      this.heights = items.map((it, i) => {
        const cached = this.heightCache.get(this.keys[i]);
        if (cached !== undefined) return cached;
        const prev = prevHeightByKey?.get(this.keys[i]);
        if (prev !== undefined) return prev;
        return this._estHeight(it);
      });
    }
    this.pos = new Array(items.length);
    this.updatePos();
    this.vp.scrollTop = keep ? Math.min(prevScroll, Math.max(0, this.totalH - this.vp.clientHeight)) : 0;
    this.scrollTop = this.vp.scrollTop;
    this.invalidate();
    this.render();
  }

  invalidateHeights() {
    this.heightCache.clear();
    this.measuredKeys.clear();
    this.avgHeight = 0;
    this._measuredCount = 0;
    this.heights = this.items.map(it => this._estHeight(it));
    this.updatePos();
    const maxScroll = Math.max(0, this.totalH - this.vp.clientHeight);
    if (this.vp.scrollTop > maxScroll) {
      this.vp.scrollTop = maxScroll;
      this.scrollTop = maxScroll;
    }
    this.invalidate();
  }

  invalidateHeight(key) {
    this.heightCache.delete(key);
  }

  invalidate() { this.indices.fill(-1); }

  updatePos() {
    let cur = this.topPad;
    for (let i = 0; i < this.items.length; i++) {
      this.pos[i] = cur;
      cur += this.heights[i];
    }
    this.totalH = cur + this.botPad;
    this.container.style.height = `${this.totalH}px`;
  }

  findStart(scrollTop) {
    const n = this.items.length;
    if (n === 0) return 0;
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.pos[mid] + this.heights[mid] <= scrollTop) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  findEnd(start, vh) {
    let i = start, acc = 0;
    while (i < this.items.length && acc < vh) { acc += this.heights[i]; i++; }
    return i;
  }

  render() {
    let more = true, passes = 0;
    while (more && passes < this.maxPasses) {
      more = this._renderPass();
      passes++;
    }
    if (more) this.schedule();
  }

  _renderPass() {
    if (!this.items.length) {
      for (let i = 0; i < this.els.length; i++) {
        this.els[i].style.transform = `translateY(${this.recyclePos}px)`;
        this.indices[i] = -1;
      }
      this.container.style.height = '0px';
      this.totalH = 0;
      return false;
    }

    const vh = this.vp.clientHeight || this.defaultVH;
    const scrollTop = this.scrollTop;
    const vStart = this.findStart(scrollTop);
    const vEnd = this.findEnd(vStart, vh);
    const rStart = Math.max(0, vStart - this.overscan);
    const rEnd = Math.min(this.items.length, vEnd + this.overscan);
    const need = rEnd - rStart;

    while (this.els.length < need) {
      const el = this.create();
      el.style.transform = `translateY(${this.recyclePos}px)`;
      this.els.push(el);
      this.indices.push(-1);
      this.container.appendChild(el);
    }

    const toMeasure = [];
    for (let i = 0; i < need; i++) {
      const di = rStart + i;
      if (this.indices[i] !== di) {
        this.update(this.els[i], this.items[di], di);
        this.indices[i] = di;
        toMeasure.push(i);
      }
    }

    let heightsChanged = false;
    let adjust = 0;
    for (const i of toMeasure) {
      const di = rStart + i;
      const h = this.els[i].offsetHeight;
      if (h === 0) continue;
      const isHeader = this.items[di]?.type === 'header';
      const total = isHeader ? h : h + this.gap;
      if (Math.abs(total - this.heights[di]) > 1) {
        if (this.pos[di] < scrollTop) adjust += total - this.heights[di];
        if (!isHeader) {
          const pureH = h;
          const wasMeasured = this.measuredKeys.has(this.keys[di]);
          if (wasMeasured) {
            const oldPure = this.heights[di] - this.gap;
            this.avgHeight = this._measuredCount > 0
              ? this.avgHeight + (pureH - oldPure) / this._measuredCount
              : pureH;
          } else {
            this.avgHeight = (this.avgHeight * this._measuredCount + pureH) / (this._measuredCount + 1);
            this._measuredCount++;
            this.measuredKeys.add(this.keys[di]);
          }
        }
        this.heights[di] = total;
        this.heightCache.set(this.keys[di], total);
        heightsChanged = true;
      }
    }

    if (heightsChanged) {
      this.updatePos();
      if (adjust) { this.vp.scrollTop += adjust; this.scrollTop = this.vp.scrollTop; }
    }

    for (let i = 0; i < need; i++) {
      this.els[i].style.transform = `translateY(${this.pos[rStart + i]}px)`;
    }

    for (let i = need; i < this.els.length; i++) {
      if (this.indices[i] !== -1) {
        this.els[i].style.transform = `translateY(${this.recyclePos}px)`;
        this.indices[i] = -1;
      }
    }

    if (heightsChanged) {
      const vBot = this.scrollTop + vh;
      const vTop = this.scrollTop;
      const firstTop = this.pos[rStart];
      const lastBot = rEnd < this.items.length
        ? this.pos[rEnd - 1] + this.heights[rEnd - 1]
        : this.totalH;
      if (lastBot < vBot || firstTop > vTop + 1) return true;
    }
    return false;
  }

  scrollToIndex(idx) {
    if (idx < 0 || idx >= this.items.length) return;
    const vh = this.vp.clientHeight || this.defaultVH;
    const center = (i) => Math.max(0, (this.pos[i] || 0) - (vh / 2) + (this.heights[i] / 2));
    const apply = () => {
      this.vp.scrollTop = center(idx);
      this.scrollTop = this.vp.scrollTop;
      this.render();
    };
    apply();
    requestAnimationFrame(apply);
  }

  forceUpdate() { this.invalidate(); this.render(); }
}

function positionDropdown(panelId) {
  const trigger = els[DROPDOWNS.find(d => d.panel === panelId).trigger];
  const dropdown = els[panelId];
  const r = trigger.getBoundingClientRect();
  if (dropdown.classList.contains('dropdown-right')) {
    dropdown.style.left = '';
    dropdown.style.right = `${Math.round(window.innerWidth - r.right)}px`;
  } else {
    dropdown.style.right = '';
    dropdown.style.left = `${Math.round(r.left)}px`;
  }
  dropdown.style.top = `${Math.round(r.bottom + 4)}px`;
}

function closeDropdowns() {
  for (const { panel } of DROPDOWNS) els[panel].classList.remove('show');
}

function toggleModal(el, show) {
  el.classList.toggle('open', !!show);
}

function anyModalOpen() {
  return document.querySelectorAll('.backdrop.open').length > 0;
}

function topModal() {
  const arr = Array.from(document.querySelectorAll('.backdrop.open'));
  if (!arr.length) return null;
  return arr.sort((a, b) =>
    (parseInt(getComputedStyle(b).zIndex) || 0) - (parseInt(getComputedStyle(a).zIndex) || 0)
  )[0];
}

const Importer = {
  assertProjectType(expected) {
    if (State.projectType !== 'uninitialized' && State.projectType !== expected) {
      App.flash(`This project is already set up as a ${State.projectType.toUpperCase()} project. Can't mix ${expected.toUpperCase()} files.`, true, 'error');
      return false;
    }
    if (State.projectType === 'uninitialized') State.projectType = expected;
    return true;
  },

  assertPluginProjectType(pluginMeta) {
    if (State.projectType !== 'uninitialized' && State.projectType !== 'plugin') {
      App.flash(`This project is already set up as a ${State.projectType.toUpperCase()} project. Can't mix with plugins.`, true, 'error');
      return false;
    }
    if (State.projectType === 'plugin' && State.pluginId && State.pluginId !== pluginMeta.id) {
      App.flash(`This project already uses another plugin. Can't mix plugins.`, true, 'error');
      return false;
    }
    if (State.projectType === 'uninitialized') {
      State.projectType = 'plugin';
      State.pluginId = pluginMeta.id;
      State.pluginName = pluginMeta.name;
    }
    return true;
  },

  async processPlugin(files) {
    const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    const first = sorted[0];
    const meta = CSTL.plugins.resolveByExtension(first.name) || CSTL.plugins.resolveByMagic(await readHead(first));
    if (!meta) throw new Error(`No active plugin handles the file "${first.name}".`);
    if (!Importer.assertPluginProjectType(meta)) return null;
    const settings = CSTL.plugins.projectSettingsFor(meta);
    const startNum = State.nextLineNum();
    const existing = new Set(State.files);
    const imported = [];
    const images = [];
    let cur = startNum;
    const pluginData = State.pluginData && typeof State.pluginData === 'object' ? { ...State.pluginData } : {};
    let cancelled = false;
    Progress.cancellableDeterminate('Plugin: Importing', `0 / ${sorted.length} file`, () => {
      cancelled = true;
      CSTL.plugins.abort(meta);
    });
    for (let i = 0; i < sorted.length; i++) {
      if (cancelled) break;
      const f = sorted[i];
      const bn = baseName(f.name);
      if (existing.has(bn)) continue;
      const buffer = new Uint8Array(await f.arrayBuffer());
      if (cancelled) break;
      let out;
      try {
        out = await CSTL.plugins.callExtract(meta, { fileName: f.name, buffer, settings });
      } catch (e) {
        if (cancelled) break;
        throw new Error(`Plugin "${meta.name}" failed to parse ${bn}: ${e.message}`);
      }
      const lines = CSTL.plugins.normalizePluginLines(out.lines, cur);
      for (const l of lines) l.file = l.file || bn;
      if (lines.length) {
        existing.add(bn);
        for (const l of lines) existing.add(l.file);
        imported.push(...lines);
        cur += lines.length;
      }
      if (out.sourceMap) pluginData[bn] = out.sourceMap;
      if (Array.isArray(out.images)) {
        for (const im of out.images) {
          if (!im) continue;
          let mediaPath = null;
          if (im.blob && State.projectId) {
            const name = makeMediaName(im.file || im.zipPath || im.fileName);
            const bytes = im.blob instanceof Uint8Array ? im.blob
              : im.blob instanceof ArrayBuffer ? new Uint8Array(im.blob)
              : im.blob instanceof Blob ? new Uint8Array(await im.blob.arrayBuffer())
              : null;
            if (bytes) {
              await Storage.writeMediaFile(State.projectId, name, bytes);
              mediaPath = name;
            }
          }
          images.push({
            zipPath: im.zipPath || im.fileName || bn,
            file: im.file || bn,
            isCover: !!im.isCover,
            insertAfter: im.insertAfter == null ? (lines.length ? lines[lines.length - 1].line_num : null) : im.insertAfter,
            mediaPath
          });
        }
      }
      Progress.update(`${i + 1} / ${sorted.length} file`, ((i + 1) / sorted.length) * 100);
      if (i % CFG.chunkSize.fileProgressBatch === 0) await yieldToEvent();
    }
    Progress.disableCancel();
    State.pluginData = pluginData;
    return { imported, skipped: [], existing: Array.from(existing), images, cancelled };
  },

  async process(input, isZip = false) {
    await withProgress('Processing files...', 'Preparing...', async () => {
      const startNum = State.nextLineNum();
      const existing = new Set(State.files);
      let result;
      await CSTL.plugins.runHooks('beforeImport', { isZip, startNum });

      if (isZip && input instanceof File) {
        if (!Importer.assertProjectType('json')) return;
        Progress.determinate('Importing ZIP', `0 file`);
        result = await parseZipJson(await input.arrayBuffer(), Array.from(existing), startNum, Progress.update);
      } else {
        const files = Array.from(input).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        let hasJson = false, pluginMatch = null, epubFile = null, zipFile = null, unknown = null;
        for (const f of files) {
          const n = f.name.toLowerCase();
          if (n.endsWith('.epub')) { epubFile = epubFile || f; continue; }
          if (n.endsWith('.json')) { hasJson = true; continue; }
          const byExt = CSTL.plugins.resolveByExtension(f.name);
          if (byExt) { pluginMatch = pluginMatch || byExt; continue; }
          const head = await readHead(f);
          const byMagic = CSTL.plugins.resolveByMagic(head);
          if (byMagic) { pluginMatch = pluginMatch || byMagic; continue; }
          if (!fileExt(f.name)) {
            if (isEpubHead(head)) { epubFile = epubFile || f; continue; }
            if (isZipHead(head)) { zipFile = zipFile || f; continue; }
            if (isJsonHead(head)) { hasJson = true; continue; }
            unknown = unknown || f.name;
          }
        }

        if (pluginMatch && (epubFile || hasJson || zipFile)) {
          Progress.hide();
          App.flash("Can't mix built-in files (JSON/EPUB) with plugin files in a single import.", true, 'error');
          return;
        }
        if (epubFile && (hasJson || zipFile)) {
          Progress.hide();
          App.flash("Can't mix EPUB and JSON in a single import.", true, 'error');
          return;
        }

        if (pluginMatch) {
          result = await Importer.processPlugin(files);
          if (!result) return;
        } else if (epubFile) {
          if (!Importer.assertProjectType('epub')) return;
          if (State.projectType === 'epub' && State.epubSourceId) {
            Progress.hide();
            App.flash('This project already contains an EPUB.', true, 'error');
            return;
          }
          State.projectType = 'epub';
          State.epubSourceId = MEDIA_EPUB;
          Progress.determinate('Importing EPUB', `0 file`);
          result = await parseEpub(await epubFile.arrayBuffer(), State.epubTags || 'p', Array.from(existing), startNum, State.projectId, Progress.update);
        } else if (zipFile) {
          if (!Importer.assertProjectType('json')) return;
          Progress.determinate('Importing ZIP', `0 file`);
          result = await parseZipJson(await zipFile.arrayBuffer(), Array.from(existing), startNum, Progress.update);
        } else if (unknown) {
          Progress.hide();
          App.flash(`File type "${unknown}" could not be detected. Files without an extension require JSON/EPUB/ZIP format or a plugin with a magic signature.`, true, 'error');
          return;
        } else {
          if (!Importer.assertProjectType('json')) return;
          const fileInputs = [];
          for (const f of files) fileInputs.push({ name: f.name, buffer: await f.arrayBuffer() });
          Progress.determinate('Importing files', `0 / ${fileInputs.length} file`);
          result = await parseFilesList(fileInputs, Array.from(existing), startNum, Progress.update, 'file');
        }
      }

      if (result.imported.length || (result.images && result.images.length)) {
        State.lines.push(...result.imported);
        State.files = Array.from(result.existing || existing);
        if (result.images && result.images.length) {
          const known = new Set(State.images.map(im => `${im.zipPath}|${im.isCover ? 1 : 0}`));
          for (const im of result.images) {
            const key = `${im.zipPath}|${im.isCover ? 1 : 0}`;
            if (!known.has(key)) { known.add(key); State.images.push(im); }
          }
        }
        State.namesDirty = true;
        State.contentVersion++;
        App.refresh(true);
        State.queueSave();
        const invalidNote = result.invalidEntries ? ` (${result.invalidEntries} entries without \`message\` skipped)` : '';
        const skipNote = result.skipped.length ? ` (${result.skipped.length} duplicate files skipped)` : '';
        if (result.cancelled) {
          App.flash(`Import cancelled. ${result.imported.length} lines saved.${skipNote}${invalidNote}`);
        } else {
          App.flash(`Successfully imported ${result.imported.length} lines.${skipNote}${invalidNote}`);
        }
        CSTL.plugins.emit('import', { lineCount: result.imported.length, fileCount: (result.existing || existing).length });
        await CSTL.plugins.runHooks('afterImport', { lineCount: result.imported.length, fileCount: (result.existing || existing).length, cancelled: !!result.cancelled });
      } else if (result.cancelled) {
        App.flash('Import cancelled.');
      } else if (result.skipped.length) {
        els.copyStatus.classList.add('empty');
        App.flash(`Import failed: Duplicate files.\n- ${result.skipped.slice(0, CFG.skippedFilesDisplayMax).join('\n- ')}`, true, 'error');
      } else if (result.invalidEntries) {
        els.copyStatus.classList.add('empty');
        App.flash(`No valid lines could be imported. ${result.invalidEntries} entries do not have a "message" field.`, true, 'error');
      } else {
        App.flash('No valid data.');
      }
    }, e => e?.storage ? e.message : `Error:\n${e?.message || e}`);
  },

  async processReplaceJson(files, mode) {
    await withProgress('Processing files...', 'Preparing...', async () => {
      if (!State.lines.length) { App.flash('No active project. Open or create a project first.', true, 'error'); return; }
      const inputs = await readJsonInputs(files);
      if (!inputs.length) { App.flash('No JSON files found.', true, 'error'); return; }

      const isTransMode = mode === 'translation';
      const isOriginalAllMode = mode === 'original';
      const grouped = groupLinesByFile(State.lines);
      const keyMap = buildFileKeyMap(State.files);

      const plan = [];
      const errors = [];

      for (const inp of inputs) {
        let arr, parsed;
        try {
          arr = JSON.parse(decodeBuffer(inp.buffer));
          parsed = parseJsonEntries(arr, inp.name);
        } catch (e) {
          errors.push(`"${inp.name}": ${e.message}`);
          continue;
        }

        const file = keyMap.get(fileKeyOf(inp.name));
        if (!file) {
          errors.push(`"${inp.name}": file not found in project.`);
          continue;
        }

        const fileLines = grouped.get(file) || [];
        const cntAll = fileLines.length;
        const cntTrans = fileLines.filter(isTrans).length;
        const cntUntrans = cntAll - cntTrans;
        const cntJson = parsed.entries.length;

        if (cntJson === 0) {
          errors.push(`"${inp.name}": no valid entries.`);
          continue;
        }

        let targets;
        if (isOriginalAllMode) {
          if (cntJson !== cntAll) {
            errors.push(`"${inp.name}": count mismatch (entries=${cntJson}, total=${cntAll}). Original mode requires importing all lines.`);
            continue;
          }
          targets = fileLines;
        } else if (cntUntrans > 0 && cntJson === cntUntrans) {
          targets = fileLines.filter(l => !isTrans(l));
        } else if (cntTrans > 0 && cntJson === cntTrans) {
          targets = fileLines.filter(isTrans);
        } else if (cntJson === cntAll) {
          targets = fileLines;
        } else {
          errors.push(`"${inp.name}": count mismatch (entries=${cntJson}, untranslated=${cntUntrans}, translated=${cntTrans}, total=${cntAll}).`);
          continue;
        }

        if (!State.ignoreName) {
          for (let i = 0; i < parsed.entries.length; i++) {
            const e = parsed.entries[i];
            const l = targets[i];
            const hasOn = !!(l.name || '').trim();
            const hasTn = !!(e.name || '').trim();
            if (hasOn && !hasTn) {
              errors.push(`"${inp.name}" line ${l.line_num}: Name removed (original has name, JSON does not).`);
            } else if (!hasOn && hasTn) {
              errors.push(`"${inp.name}" line ${l.line_num}: Narrative but has name (original has no name, JSON does).`);
            }
          }
          if (errors.length) continue;
        }

        plan.push({ entries: parsed.entries, targets });
      }

      if (errors.length) {
        const summary = `Import rejected: ${errors.length} files failed validation. No changes applied.`;
        const shown = errors.slice(0, CFG.warningDisplayMax);
        const more = errors.length > CFG.warningDisplayMax ? `\n+${errors.length - CFG.warningDisplayMax} more notes` : '';
        App.flash(`${summary}\n\nRejected:\n${shown.join('\n')}${more}`, true, 'error');
        return;
      }

      const snapshotLines = snapshot();
      let updated = 0;
      for (const { entries, targets } of plan) {
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          const l = targets[i];
          const msg = e.message.replace(/\r?\n/g, '\\n').trim();
          const nm = e.name == null ? null : stripNewlines(e.name);
          if (isTransMode) {
            l.trans_message = msg;
            l.trans_name = nm;
            l.is_translated = true;
          } else {
            l.message = msg;
            l.name = nm;
          }
          updated++;
        }
      }

      State.undoStack.push(snapshotLines); State.redoStack = [];
      State.namesDirty = true;
      State.contentVersion++;
      App.refresh(true);
      State.queueSave();

      App.flash(`Successfully updated ${updated} lines.`);
      CSTL.plugins.emit('import', { lineCount: updated, fileCount: State.files.length, mode });
    }, e => `Error:\n${e?.message || e}`);
  }
};

const Exporter = {
  async runEpub() {
    await withProgress('Creating EPUB...', 'Loading archive...', async () => {
      Progress.determinate('Creating EPUB', `0 file`);
      const result = await buildExportEpub(State.projectId, State.lines, State.epubTags || 'p', State.projectName, Progress.update);
      download(URL.createObjectURL(result.blob), result.name);
      App.flash('EPUB export successful!');
      CSTL.plugins.emit('export', { filename: result.name });
    }, e => 'EPUB export failed: ' + e.message);
  },

  async runJson() {
    await withProgress('Creating JSON...', 'Grouping lines...', async () => {
      Progress.determinate('Creating JSON', `0 file`);
      const result = await buildExportJson(State.lines, State.projectName, Progress.update, 'export', false);
      download(URL.createObjectURL(result.blob), result.name);
      App.flash('JSON export successful!');
      CSTL.plugins.emit('export', { filename: result.name });
    }, e => 'JSON export failed: ' + e.message);
  },

  async runTranslationJson() {
    if (!State.lines.length) return;
    if (!State.lines.some(isTrans)) { App.flash('No translated lines.', true, 'error'); return; }
    await withProgress('Creating translation JSON...', 'Grouping lines...', async () => {
      Progress.determinate('Creating translation JSON', `0 file`);
      const result = await buildExportJson(State.lines, State.projectName, Progress.update, 'translation', false, isTrans);
      download(URL.createObjectURL(result.blob), result.name);
      App.flash('Translation export successful!');
      CSTL.plugins.emit('export', { filename: result.name, mode: 'translation' });
    }, e => 'JSON export failed: ' + e.message);
  },

  async runUntranslatedJson() {
    if (!State.lines.length) return;
    if (!State.lines.some(l => !isTrans(l))) { App.flash('No untranslated lines.', true, 'error'); return; }
    await withProgress('Creating untranslated JSON...', 'Grouping lines...', async () => {
      Progress.determinate('Creating untranslated JSON', `0 file`);
      const result = await buildExportJson(State.lines, State.projectName, Progress.update, 'untranslated', false, l => !isTrans(l));
      download(URL.createObjectURL(result.blob), result.name);
      App.flash('Untranslated export successful!');
      CSTL.plugins.emit('export', { filename: result.name, mode: 'untranslated' });
    }, e => 'JSON export failed: ' + e.message);
  },

  async runOriginalJson() {
    if (!State.lines.length) return;
    await withProgress('Creating original text JSON...', 'Grouping lines...', async () => {
      Progress.determinate('Creating original text JSON', `0 file`);
      const result = await buildExportJson(State.lines, State.projectName, Progress.update, 'original', true);
      download(URL.createObjectURL(result.blob), result.name);
      App.flash('Original text export successful!');
      CSTL.plugins.emit('export', { filename: result.name, mode: 'original' });
    }, e => 'JSON export failed: ' + e.message);
  },

  async runPlugin() {
    await withProgress('Creating file via plugin...', 'Loading plugin...', async () => {
      const meta = CSTL.plugins.getMeta(State.pluginId);
      if (!meta) throw new Error('The plugin for this project is no longer installed. The project cannot be exported.');
      if (!meta.enabled) throw new Error('This plugin is disabled. Enable it in the Plugin Manager first.');
      const lines = State.lines.map(CSTL.plugins.toPluginLine);
      const pluginData = (State.pluginData && typeof State.pluginData === 'object') ? State.pluginData : {};
      const settings = CSTL.plugins.projectSettingsFor(meta);
      let cancelled = false;
      Progress.cancellableDeterminate('Plugin: Creating output', `0 file`, () => {
        cancelled = true;
        CSTL.plugins.abort(meta);
      });
      let out;
      try {
        out = await CSTL.plugins.callPack(meta, {
          lines,
          sourceMap: pluginData,
          projectName: State.projectName || 'untitled',
          settings
        });
      } catch (e) {
        if (cancelled) { App.flash('Export cancelled.'); return; }
        throw e;
      }
      const filename = out.filename || (sanitizeName(State.projectName) + '_tl' + (meta.extensions[0] || '.bin'));
      download(URL.createObjectURL(out.blob), filename);
      App.flash('Plugin export successful!');
      CSTL.plugins.emit('export', { filename });
    }, e => 'Plugin export failed: ' + e.message);
  },

  async run() {
    if (!State.lines.length) return;
    const ctx = { projectType: State.projectType, cancel: false };
    await CSTL.plugins.runHooks('beforeExport', ctx);
    if (ctx.cancel) return;
    if (State.projectType === 'epub' && State.epubSourceId) await Exporter.runEpub();
    else if (State.projectType === 'plugin' && State.pluginId) await Exporter.runPlugin();
    else await Exporter.runJson();
    await CSTL.plugins.runHooks('afterExport', ctx);
  }
};

const App = {
  main: null,
  pr: null,
  activeLine: null,
  highlightRe: null,
  lastProofreadSig: '',
  lastProofreadContentVer: 0,
  lastFile: null,
  fileCache: null,
  toastToken: 0,
  toastTimer: null,
  savedTimer: 0,
  tmpVndb: [],
  dashboardItems: [],
  dashboardAllItems: [],
  dashboardRendered: 0,
  dashboardObserver: null,
  dashboardSentinel: null,
  dashboardFailed: false,
  swRegistered: false,
  storageCheckBusy: false,
  storageWatchTimer: null,
  healScheduled: false,
  _storageCheckCount: 0,
  _storageCriticalShown: false,

  flash(msg, keep = false, kind = '') {
    const el = els.copyStatus;
    el.textContent = msg;
    el.className = 'toast' + (kind ? ' ' + kind : '');
    const t = ++App.toastToken;
    const timeout = keep ? 6000 : CFG.toastTimeoutMs;
    clearTimeout(App.toastTimer);
    App.toastTimer = setTimeout(() => { if (App.toastToken === t) el.classList.add('empty'); }, timeout);
  },

  flashSaved() {
    const bar = els.progressText;
    if (!bar || !State.projectId) return;
    bar.classList.add('saved');
    clearTimeout(App.savedTimer);
    App.savedTimer = setTimeout(() => bar.classList.remove('saved'), CFG.savedTimeoutMs);
  },

  async init() {
    cacheEls();

    if (!navigator.storage?.getDirectory) {
      els.projectList.innerHTML = `<p class="hint" style="grid-column:1/-1;color:var(--danger);">Browser doesn't support OPFS.</p>`;
      return;
    }

    window.addEventListener('error', e => {
      console.error('[global error]', e.error || e.message);
    });
    window.addEventListener('unhandledrejection', e => {
      const reason = e.reason;
      const msg = reason?.storage ? reason.message : (reason?.message || String(reason));
      console.error('[unhandled rejection]', reason);
      if (reason?.storage) App.flash('Failed: ' + msg, true);
    });

    Storage.sweepTemp();
    await App.ensurePersisted();

    App.main = new Scroller(
      els.previewViewport, els.previewContainer, App.createMainRow, App.updateMainRow,
      (item) => item.type === 'header' ? `h:${item.file}` : item.type === 'image' ? `i:${item.img.file || ''}:${item.img.zipPath}:${item.img.insertAfter ?? 'c'}` : `l:${item.line.line_num}`
    );
    App.pr = new Scroller(
      els.proofreadContainer.closest('.proofread-results-wrap'),
      els.proofreadContainer,
      App.createPrRow,
      App.updatePrRow,
      (item) => `p:${item.num}`
    );

    App.bind();
    await Shortcuts.init();
    CSTL.plugins.attach(PluginHost);
    await CSTL.plugins.init();
    App.syncImportAccept();
    App.renderPluginMenuItems();
    await App.loadDashboard();
    App.startStorageWatch();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') App.checkStorageAlive();
    });
    window.addEventListener('focus', () => App.checkStorageAlive());
    window.addEventListener('pageshow', e => {
      if (e.persisted) App.checkStorageAlive();
    });
  },

  bind() {
    App.bindToolbar();
    App.bindDropdowns();
    App.bindImportExport();
    App.bindSelection();
    App.bindGlossary();
    App.bindSettings();
    App.bindContext();
    App.bindLineEditor();
    App.bindProofread();
    App.bindPreview();
    App.bindNames();
    App.bindBookmarks();
  },

  bindToolbar() {
    els.busyCancel.addEventListener('click', () => Progress.cancel());
    els.btnNewProject.addEventListener('click', App.createProject);
    els.btnBackToDashboard.addEventListener('click', App.closeProject);
    els.btnToggleHeader.addEventListener('click', () => {
      els.workspaceToolbar.classList.add('hidden');
      els.btnShowHeader.classList.add('visible');
    });
    els.btnShowHeader.addEventListener('click', () => {
      els.workspaceToolbar.classList.remove('hidden');
      els.btnShowHeader.classList.remove('visible');
    });
    els.btnRestoreProject.addEventListener('click', () => els.restoreProjectInput.click());
    els.restoreProjectInput.addEventListener('change', App.restoreProject);
    els.btnOpenPlugins.addEventListener('click', () => {
      closeDropdowns();
      document.getElementById('btnPluginManagerOpen').click();
    });

    let searchTimer = null;
    els.projectSearch.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => App.renderDashboardItems(), CFG.delay.dashboardSearchMs);
    });
    els.projectSearchClear.addEventListener('click', () => {
      els.projectSearch.value = '';
      els.projectSearch.focus();
      App.renderDashboardItems();
    });

    App.bindSortDropdown();

    els.btnDashboardSettings.addEventListener('click', () => {
      toggleModal(els.dashboardSettingsModal, true);
    });
    els.btnDashboardSettingsClose.addEventListener('click', () => toggleModal(els.dashboardSettingsModal, false));
    els.btnShortcutsOpen.addEventListener('click', () => {
      App.renderShortcutList();
      toggleModal(els.shortcutModal, true);
    });
    els.btnShortcutsClose.addEventListener('click', () => { Shortcuts.stopRecording(); toggleModal(els.shortcutModal, false); });
    els.btnShortcutsResetAll.addEventListener('click', async () => {
      if (!await App.dialogConfirm('Reset all shortcuts?', 'All custom key bindings will be replaced with defaults.')) return;
      Shortcuts.resetBindings();
      App.renderShortcutList();
    });
    els.btnBackupAll.addEventListener('click', App.backupAll);
    els.btnWipeAllData.addEventListener('click', App.wipeAllData);

    els.btnOpfsExplorerOpen.addEventListener('click', () => {
      toggleModal(els.opfsExplorerModal, true);
      OpfsExplorer.path = [];
      OpfsExplorer.refresh();
    });
    els.btnOpfsExplorerClose.addEventListener('click', () => {
      toggleModal(els.opfsExplorerModal, false);
      App.loadDashboard();
    });
    els.btnOpfsRefresh.addEventListener('click', () => OpfsExplorer.refresh());
    els.opfsList.addEventListener('click', e => OpfsExplorer.handleClick(e));

  },

  bindSortDropdown() {
    const box = els.projectSortBox;
    const trigger = els.projectSortTrigger;
    const menu = els.projectSortMenu;
    const label = els.projectSortLabel;
    const hidden = els.projectSort;

    const labelMap = {};
    menu.querySelectorAll('.sort-menu-item').forEach(item => {
      labelMap[item.dataset.value] = item.querySelector('.sort-menu-text').textContent;
    });

    const closeMenu = () => {
      box.classList.remove('open');
      menu.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    };
    const openMenu = () => {
      box.classList.add('open');
      menu.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      const active = menu.querySelector('.sort-menu-item.active');
      if (active) setTimeout(() => active.focus(), CFG.delay.focusMs);
    };
    const toggleMenu = () => {
      if (box.classList.contains('open')) closeMenu();
      else openMenu();
    };
    const selectValue = (value) => {
      if (!value || !labelMap[value]) return;
      hidden.value = value;
      label.textContent = labelMap[value];
      menu.querySelectorAll('.sort-menu-item').forEach(item => {
        const isActive = item.dataset.value === value;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      App.renderDashboardItems();
      closeMenu();
    };

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMenu();
    });

    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        toggleMenu();
      } else if (e.key === 'Escape' && box.classList.contains('open')) {
        e.preventDefault();
        closeMenu();
        trigger.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!box.classList.contains('open')) openMenu();
        else {
          const active = menu.querySelector('.sort-menu-item.active');
          const next = active ? active.nextElementSibling : menu.querySelector('.sort-menu-item');
          if (next) next.focus();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!box.classList.contains('open')) openMenu();
        else {
          const active = menu.querySelector('.sort-menu-item.active');
          const prev = active ? active.previousElementSibling : null;
          if (prev) prev.focus();
        }
      }
    });

    menu.querySelectorAll('.sort-menu-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        selectValue(item.dataset.value);
      });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          selectValue(e.currentTarget.dataset.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeMenu();
          trigger.focus();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const next = e.currentTarget.nextElementSibling;
          if (next) next.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = e.currentTarget.previousElementSibling;
          if (prev) prev.focus();
        }
      });
    });

    document.addEventListener('click', (e) => {
      if (!box.contains(e.target) && box.classList.contains('open')) {
        closeMenu();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && box.classList.contains('open')) {
        closeMenu();
        trigger.focus();
      }
    });

    const reposition = () => {
      if (!box.classList.contains('open')) return;
      const r = menu.getBoundingClientRect();
      if (r.right > window.innerWidth - 8) {
        menu.style.left = 'auto';
        menu.style.right = '0';
      }
      if (r.left < 8) {
        menu.style.right = 'auto';
        menu.style.left = '0';
      }
    };
    trigger.addEventListener('click', () => setTimeout(reposition, CFG.delay.repositionMs));
    window.addEventListener('resize', reposition);
  },

  bindDropdowns() {
    document.addEventListener('click', e => {
      for (const { trigger, panel } of DROPDOWNS) {
        if (e.target.closest(`#${trigger}`)) {
          e.preventDefault();
          const willShow = !els[panel].classList.contains('show');
          closeDropdowns();
          if (willShow) { positionDropdown(panel); els[panel].classList.add('show'); }
          return;
        }
      }
      if (!DROPDOWNS.some(({ group }) => e.target.closest(`#${group}`))) closeDropdowns();
      const bd = e.target.closest('.backdrop.open');
      if (bd && e.target === bd) toggleModal(bd, false);
    });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (anyModalOpen()) { const m = topModal(); if (m) toggleModal(m, false); }
      else closeDropdowns();
    });

    els.dynamicToolbarWrap.addEventListener('scroll', closeDropdowns, { passive: true });
    window.addEventListener('scroll', closeDropdowns, true);
    window.addEventListener('resize', closeDropdowns);
  },

  bindImportExport() {
    const importInputs = [els.importFileInput, els.importFolderInput, els.importZipInput];
    ['btnImportFile', 'btnImportFolder', 'btnImportZip'].forEach((id, i) => {
      const input = importInputs[i];
      els[id].addEventListener('click', () => { closeDropdowns(); input.click(); });
      input.addEventListener('change', async e => {
        if (!e.target.files.length) return;
        await Importer.process(id === 'btnImportZip' ? e.target.files[0] : e.target.files, id === 'btnImportZip');
        e.target.value = '';
      });
    });

    const replaceBindings = [
      ['btnImportTranslation', 'importTranslationInput', 'translation'],
      ['btnImportUntranslated', 'importUntranslatedInput', 'untranslated'],
      ['btnImportOriginal', 'importOriginalInput', 'original']
    ];
    replaceBindings.forEach(([btnId, inputId, mode]) => {
      els[btnId].addEventListener('click', () => { closeDropdowns(); els[inputId].click(); });
      els[inputId].addEventListener('change', async e => {
        if (!e.target.files.length) return;
        await Importer.processReplaceJson(e.target.files, mode);
        e.target.value = '';
      });
    });

    els.btnExportProject.addEventListener('click', () => { closeDropdowns(); Exporter.run(); });
    els.btnExportTranslation.addEventListener('click', () => { closeDropdowns(); Exporter.runTranslationJson(); });
    els.btnExportUntranslated.addEventListener('click', () => { closeDropdowns(); Exporter.runUntranslatedJson(); });
    els.btnExportOriginal.addEventListener('click', () => { closeDropdowns(); Exporter.runOriginalJson(); });

    els.btnCopyForAi.addEventListener('click', App.copyForAi);
    els.btnApply.addEventListener('click', App.applyTranslation);
    els.btnUndo.addEventListener('click', App.undo);
    els.btnRedo.addEventListener('click', App.redo);
    els.btnProofread.addEventListener('click', App.openProofread);
  },

  bindSelection() {
    els.btnSelectAll.addEventListener('click', () => {
      State.lines.forEach(l => { if (!isTrans(l)) State.selected.add(l.line_num); });
      App.syncCheckboxes();
    });
    els.btnClearSelection.addEventListener('click', () => { State.selected.clear(); App.syncCheckboxes(); });
    els.btnSelectRange.addEventListener('click', App.selectRange);
  },

  bindGlossary() {
    els.btnGlossary.addEventListener('click', () => {
      els.glossaryVndbCheck.checked = State.vndbEnabled;
      els.glossaryVndbIdInput.value = State.vndbId || '';
      App.tmpVndb = [...State.vndbGlossary];
      els.glossaryVndbPreviewArea.value = App.tmpVndb.map(g => `${g[0]}: ${g[1]}`).join('\n');
      els.glossaryVndbWrap.classList.toggle('section-disabled', !State.vndbEnabled);
      els.glossaryVndbIdInput.disabled = els.btnGlossaryVndbFetch.disabled = App.tmpVndb.length > 0;
      els.glossaryCustomCheck.checked = State.customEnabled;
      els.glossaryCustomInput.value = State.customRaw || '';
      els.glossaryCustomWrap.classList.toggle('section-disabled', !State.customEnabled);
      App.renderPluginSections('glossary');
      toggleModal(els.glossaryModal, true);
    });
    els.glossaryVndbCheck.addEventListener('change', e => {
      els.glossaryVndbWrap.classList.toggle('section-disabled', !e.target.checked);
    });
    els.btnGlossaryVndbFetch.addEventListener('click', async () => {
      let id = els.glossaryVndbIdInput.value.trim();
      if (!id) return;
      if (!id.startsWith('v')) id = 'v' + id;
      const status = els.glossaryVndbStatus;
      try {
        els.btnGlossaryVndbFetch.disabled = els.glossaryVndbIdInput.disabled = true;
        status.textContent = 'Fetching data...';
        status.className = 'toast info';
        const chars = await Vndb.fetchCharacters(id);
        if (!chars.length) throw new Error('No characters found.');
        App.tmpVndb = Vndb.buildGlossary(chars);
        els.glossaryVndbPreviewArea.value = App.tmpVndb.map(g => `${g[0]}: ${g[1]}`).join('\n');
        status.textContent = `Found ${App.tmpVndb.length} entries.`;
        status.className = 'toast success';
      } catch (e) {
        status.textContent = e.message;
        status.className = 'toast error';
        els.btnGlossaryVndbFetch.disabled = els.glossaryVndbIdInput.disabled = false;
      }
    });
    els.btnGlossaryVndbReset.addEventListener('click', () => {
      els.glossaryVndbCheck.checked = false;
      els.glossaryVndbIdInput.value = '';
      els.glossaryVndbPreviewArea.value = '';
      App.tmpVndb = [];
      els.glossaryVndbStatus.className = 'toast empty mb-2';
      els.glossaryVndbIdInput.disabled = els.btnGlossaryVndbFetch.disabled = false;
      els.glossaryVndbWrap.classList.add('section-disabled');
    });
    els.glossaryCustomCheck.addEventListener('change', e => {
      els.glossaryCustomWrap.classList.toggle('section-disabled', !e.target.checked);
    });
    els.btnGlossaryCustomReset.addEventListener('click', () => {
      els.glossaryCustomCheck.checked = false;
      els.glossaryCustomInput.value = '';
      els.glossaryCustomWrap.classList.add('section-disabled');
    });
    els.btnGlossaryCancel.addEventListener('click', () => toggleModal(els.glossaryModal, false));
    els.btnGlossarySave.addEventListener('click', () => {
      State.vndbEnabled = els.glossaryVndbCheck.checked;
      State.vndbId = els.glossaryVndbIdInput.value.trim();
      State.vndbGlossary = App.tmpVndb;
      State.customEnabled = els.glossaryCustomCheck.checked;
      State.customRaw = els.glossaryCustomInput.value.trim();
      App.savePluginSections('glossary');
      toggleModal(els.glossaryModal, false);
      State.queueSave();
    });
  },

  bindSettings() {
    els.btnSettings.addEventListener('click', () => {
      App.syncSettingsModal();
      toggleModal(els.settingsModal, true);
    });
    els.btnSettingsBasicReset.addEventListener('click', () => App.resetSettingsModal('basic'));
    els.btnSettingsPromptReset.addEventListener('click', () => { els.settingsPromptInput.value = DEFAULT_PROMPT; });
    els.btnSettingsEpubReset.addEventListener('click', () => { els.settingsEpubTagsInput.value = 'p'; });
    els.btnSettingsIncrementReset.addEventListener('click', () => {
      els.settingsIncrementCheck.checked = false;
      els.settingsIncrementStepInput.value = 100;
      els.incrementStepWrap.classList.add('section-disabled');
    });
    els.settingsIncrementCheck.addEventListener('change', e => {
      els.incrementStepWrap.classList.toggle('section-disabled', !e.target.checked);
    });
    els.btnSettingsCancel.addEventListener('click', () => toggleModal(els.settingsModal, false));
    els.btnSettingsSave.addEventListener('click', () => {
      const prevIncrementEnabled = State.incrementEnabled;
      const changes = {};
      SETTINGS_FIELDS.forEach(({ id, key, type, def }) => {
        const before = State[key];
        if (type === 'check') State[key] = els[id].checked;
        else if (type === 'number') State[key] = Math.max(1, Math.floor(Number(els[id].value) || def));
        else State[key] = els[id].value.trim() || def;
        if (State[key] !== before) changes[key] = State[key];
      });
      App.savePluginSections('settings');
      App.applyHideTools();
      toggleModal(els.settingsModal, false);
      if (State.incrementEnabled && State.projectId && State.lines.length) {
        const from = parseInt(els.rangeFromInput.value, 10);
        const to = parseInt(els.rangeToInput.value, 10);
        const hasRange = from >= 1 && to >= from;
        const justEnabled = !prevIncrementEnabled && State.incrementEnabled;
        if (!hasRange || justEnabled) App.prefillIncrement();
      }
      State.queueSave();
      if (Object.keys(changes).length) CSTL.plugins.runHooksSync('settingsChange', changes);
    });
  },

  bindContext() {
    els.btnContext.addEventListener('click', () => {
      els.summaryEnabledCheck.checked = State.summaryEnabled;
      els.summaryPromptInput.value = State.summaryPrompt || DEFAULT_SUMMARY_PROMPT;
      els.summaryStoredInput.value = State.summary || '';
      els.summaryWrap.classList.toggle('section-disabled', !State.summaryEnabled);
      App.renderPluginSections('summary');
      toggleModal(els.contextModal, true);
    });
    els.summaryEnabledCheck.addEventListener('change', e => {
      els.summaryWrap.classList.toggle('section-disabled', !e.target.checked);
    });
    els.btnSummaryReset.addEventListener('click', () => {
      els.summaryEnabledCheck.checked = false;
      els.summaryPromptInput.value = DEFAULT_SUMMARY_PROMPT;
      els.summaryStoredInput.value = '';
      els.summaryWrap.classList.add('section-disabled');
    });
    els.btnSummaryPromptReset.addEventListener('click', () => {
      els.summaryPromptInput.value = DEFAULT_SUMMARY_PROMPT;
    });
    els.btnSummaryStoredReset.addEventListener('click', () => {
      els.summaryStoredInput.value = '';
    });
    els.btnContextCancel.addEventListener('click', () => toggleModal(els.contextModal, false));
    els.btnContextSave.addEventListener('click', () => {
      State.summaryEnabled = els.summaryEnabledCheck.checked;
      State.summaryPrompt = els.summaryPromptInput.value.trim() || DEFAULT_SUMMARY_PROMPT;
      State.summary = els.summaryStoredInput.value.trim();
      App.savePluginSections('summary');
      toggleModal(els.contextModal, false);
      State.queueSave();
    });
  },

  bindLineEditor() {
    els.btnLineCancel.addEventListener('click', () => toggleModal(els.lineEditorModal, false));
    els.btnLineSave.addEventListener('click', App.saveLineEditor);
  },

  bindProofread() {
    els.btnProofreadClose.addEventListener('click', () => toggleModal(els.proofreadModal, false));
    els.btnProofreadReset.addEventListener('click', () => {
      els.proofreadSearchInput.value = '';
      els.proofreadReplaceInput.value = '';
      PROOFREAD_FIELDS.forEach(({ id, def, type }) => {
        const el = els[id];
        if (type === 'check') el.checked = def; else el.value = def;
      });
      App.syncProofread();
      App.renderProofread();
    });
    els.btnProofreadReplaceAll.addEventListener('click', App.replaceAll);

    const delayedRender = debounce(App.renderProofread, CFG.delay.proofreadDebounceMs);
    els.proofreadSearchInput.addEventListener('input', delayedRender);
    PROOFREAD_FIELDS.forEach(({ id }) => {
      els[id].addEventListener('change', () => { App.syncProofread(); App.renderProofread(); });
    });
  },

  bindPreview() {
    els.previewContainer.addEventListener('change', e => {
      if (e.target.closest('.checkbox-cell') && e.target.type === 'checkbox') {
        const n = Number(e.target.dataset.num);
        if (e.target.checked) State.selected.add(n); else State.selected.delete(n);
        App.syncCheckboxes();
      } else if (e.target.matches('.file-header-inner input[type="checkbox"][data-file]')) {
        App.toggleFileSelection(e.target);
      }
    });
    els.stickyFileCheckbox.addEventListener('change', e => {
      if (e.target.dataset.file) App.toggleFileSelection(e.target);
    });
    els.previewContainer.addEventListener('click', e => {
      if (e.target.matches('input[type="checkbox"]')) return;
      const bmBtn = e.target.closest('.row-bookmark-btn');
      if (bmBtn) {
        e.stopPropagation();
        e.preventDefault();
        const n = Number(bmBtn.dataset.num);
        if (n) App.toggleBookmark(n);
        return;
      }
      const wrap = e.target.closest('.text-content');
      if (!wrap) return;
      const row = wrap.closest('.preview-row');
      if (!row || row.classList.contains('file-header')) return;
      const cb = row.querySelector('input[type="checkbox"]');
      if (cb?.dataset.num) App.openLineEditor(Number(cb.dataset.num));
    });

    let raf = 0;
    els.previewViewport.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; App.updateFileBadge(); });
    }, { passive: true });

    els.proofreadContainer.addEventListener('click', e => {
      const wrap = e.target.closest('.text-content');
      if (!wrap?.dataset.num) return;
      const n = Number(wrap.dataset.num);
      if (State.jumpToContext) {
        toggleModal(els.proofreadModal, false);
        App.scrollToLine(n);
      } else {
        App.openLineEditor(n);
      }
    });
  },

  bindNames() {
    els.nameTableBody.addEventListener('click', async e => {
      if (e.target.tagName !== 'TD') return;
      try { await clipboard(e.target.textContent); App.flash('Name copied!'); }
      catch { App.flash('Copy failed.', true, 'error'); }
    });
    els.btnCopyNamesPlain.addEventListener('click', () => App.copyAllNames('plain'));
    els.btnCopyNamesWithGlossary.addEventListener('click', () => App.copyAllNames('glossary'));
    els.btnCopyNamesMissingGlossary.addEventListener('click', () => App.copyAllNames('missing'));
  },

  bindBookmarks() {
    els.btnBookmarks.addEventListener('click', () => {
      const panel = els.bookmarkPanel;
      const willShow = !panel.classList.contains('show');
      App.toggleBookmarkPanel(willShow);
    });

    els.bookmarkList.addEventListener('click', e => {
      const del = e.target.closest('.bookmark-item-del');
      if (del) {
        e.stopPropagation();
        const item = del.closest('.bookmark-item');
        const n = Number(item?.dataset.num);
        if (n) {
          if (item) item.classList.add('is-removing');
          setTimeout(() => App.toggleBookmark(n, false), 220);
        }
        return;
      }
      const item = e.target.closest('.bookmark-item');
      if (!item) return;
      const n = Number(item.dataset.num);
      if (!n) return;
      App.scrollToLine(n);
      App.toggleBookmarkPanel(false);
    });

    els.btnBookmarkClear.addEventListener('click', async () => {
      if (!State.bookmarks.length) return;
      if (!await App.dialogConfirm('Delete all bookmarks?', 'This action cannot be undone.')) return;
      State.bookmarks = [];
      State.bookmarkSet = new Set();
      App.syncBookmarkUI();
      App.main.forceUpdate();
      App.renderBookmarkList();
      State.queueSave();
    });

    document.addEventListener('click', e => {
      if (!els.bookmarkPanel.classList.contains('show')) return;
      if (e.target.closest('.bookmark-dock')) return;
      App.toggleBookmarkPanel(false);
    });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (els.bookmarkPanel.classList.contains('show')) {
        App.toggleBookmarkPanel(false);
      }
    });

    window.addEventListener('blur', () => App.toggleBookmarkPanel(false));
  },

  toggleBookmarkPanel(show) {
    els.bookmarkPanel.classList.toggle('show', show);
    els.btnBookmarks.classList.toggle('active', show);
    els.btnBookmarks.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) App.renderBookmarkList();
  },

  toggleBookmark(num, force) {
    if (!num) return;
    const has = State.bookmarkSet.has(num);
    const next = force === undefined ? !has : force;
    if (next && !has) { State.bookmarks.push(num); State.bookmarkSet.add(num); }
    else if (!next && has) {
      const idx = State.bookmarks.indexOf(num);
      State.bookmarks.splice(idx, 1);
      State.bookmarkSet.delete(num);
    }
    else return;
    App.syncBookmarkUI();
    App.main.forceUpdate();
    if (els.bookmarkPanel.classList.contains('show')) App.renderBookmarkList();
    State.queueSave();
  },

  syncBookmarkUI() {
    const count = State.bookmarks.length;
    els.bookmarkPanelCount.textContent = `(${count})`;
    els.btnBookmarks.disabled = !State.lines.length;
    els.btnBookmarkClear.disabled = count === 0;
  },

  renderBookmarkList() {
    const list = els.bookmarkList;
    list.replaceChildren();
    const nums = [...State.bookmarks].sort((a, b) => a - b);
    if (!nums.length) return;
    const frag = document.createDocumentFragment();
    for (const num of nums) {
      const l = State.byNum.get(num);
      if (!l) continue;
      const item = document.createElement('div');
      item.className = 'bookmark-item';
      item.dataset.num = num;

      const numEl = document.createElement('span');
      numEl.className = 'bookmark-item-num';
      numEl.textContent = num;

      const meta = document.createElement('div');
      meta.className = 'bookmark-item-meta';
      const fileEl = document.createElement('span');
      fileEl.className = 'bookmark-item-file';
      fileEl.textContent = baseName(l.file);
      fileEl.title = l.file;
      const textEl = document.createElement('span');
      textEl.className = 'bookmark-item-text';
      const preview = l.message || (l.name ? `${l.name}: ` : '');
      textEl.textContent = preview || '(empty)';
      textEl.title = preview;
      meta.append(fileEl, textEl);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'bookmark-item-del';
      del.setAttribute('aria-label', `Delete bookmark for line ${num}`);
      del.tabIndex = -1;
      del.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

      item.append(numEl, meta, del);
      frag.appendChild(item);
    }
    list.appendChild(frag);
  },

  scrollToLine(num) {
    const idx = State.indexOfLine(num);
    if (idx !== -1) App.main.scrollToIndex(idx);
  },

  syncSettingsModal() {
    SETTINGS_FIELDS.forEach(({ id, key, type, def }) => {
      const v = State[key] ?? def;
      if (type === 'check') els[id].checked = v; else els[id].value = v;
    });
    els.incrementStepWrap.classList.toggle('section-disabled', !State.incrementEnabled);
    App.renderPluginSections('settings');
  },

  _pluginSections: { settings: [], glossary: [], summary: [] },
  _pluginSectionModal: {
    settings: () => els.settingsModal,
    glossary: () => els.glossaryModal,
    summary: () => els.contextModal
  },
  _pluginRegions: {
    importMenu: () => els.importDropdown,
    exportMenu: () => els.exportDropdown,
    settingsModal: () => els.settingsModal,
    glossaryModal: () => els.glossaryModal,
    summaryModal: () => els.contextModal,
    toolsPanel: () => document.querySelector('.panel-right'),
    textPanel: () => document.querySelector('.panel-left'),
    previewContainer: () => els.previewContainer,
    toolbar: () => els.workspaceToolbar,
    toolbarActions: () => document.querySelector('.toolbar-actions'),
    pluginPanels: () => els.pluginPanels,
    dashboard: () => els.dashboardView,
    dashboardContent: () => els.projectList.parentElement,
    lineEditorModal: () => els.lineEditorModal,
    lineEditorBody: () => els.lineEditorModal?.querySelector('.modal-body'),
    proofreadModal: () => els.proofreadModal,
    proofreadContainer: () => els.proofreadContainer,
    namePanel: () => document.querySelector('.name-table-wrap'),
    pasteArea: () => els.pasteArea,
    progressOverlay: () => els.busyOverlay,
    progressText: () => els.progressText,
    heroBar: () => document.querySelector('.hero-bar'),
    bookmarkPanel: () => els.bookmarkPanel,
    bookmarkList: () => els.bookmarkList,
    selectionRange: () => document.querySelector('.panel-right .card .row'),
    shortcutsModal: () => els.shortcutModal,
    dashboardSettingsModal: () => els.dashboardSettingsModal,
    pluginManagerModal: () => document.getElementById('pluginManagerModal'),
    opfsExplorerModal: () => els.opfsExplorerModal
  },

  pluginRegion(name) {
    const fn = App._pluginRegions[name];
    if (!fn) throw new Error(`Unknown UI region "${name}". See README for the supported list.`);
    const el = fn();
    if (!el) throw new Error(`UI region "${name}" isn't available right now.`);
    return el;
  },

  renderPluginSections(target) {
    for (const s of App._pluginSections[target]) {
      s.body.innerHTML = '';
      try { s.hooks.render && s.hooks.render(s.body); } catch (e) { console.error('[plugin settings]', e); }
    }
  },

  savePluginSections(target) {
    for (const s of App._pluginSections[target]) {
      try { s.hooks.onSave && s.hooks.onSave(); } catch (e) { console.error('[plugin settings]', e); }
    }
  },

  addPluginMenuItem(menu, label, onClick) {
    const dropdown = menu === 'import' ? els.importDropdown : menu === 'export' ? els.exportDropdown : null;
    if (!dropdown) throw new Error('addMenuItem: menu must be "import" or "export".');
    const btn = document.createElement('button');
    btn.className = 'dropdown-item';
    btn.textContent = String(label ?? '');
    btn.addEventListener('click', () => {
      closeDropdowns();
      try { onClick && onClick(); } catch (e) { App.flash(String(e?.message || e)); }
    });
    dropdown.appendChild(btn);
    return btn;
  },

  removePluginMenuItem(btn) {
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
  },

  addPluginSettingsSection(target, title, hooks) {
    const modalFn = App._pluginSectionModal[target];
    if (!modalFn) throw new Error('addSettingsSection: target must be "settings", "glossary", or "summary".');
    const modal = modalFn();
    const card = document.createElement('div');
    card.className = 'card mb-2 mt-3';
    const head = document.createElement('div');
    head.className = 'row between mb-1';
    const label = document.createElement('div');
    label.className = 'section-label-lg m-0';
    label.textContent = String(title ?? '');
    head.appendChild(label);
    const body = document.createElement('div');
    card.append(head, body);
    const actions = modal.querySelector('.modal-actions');
    actions.parentNode.insertBefore(card, actions);
    const entry = { target, card, body, hooks: hooks || {} };
    App._pluginSections[target].push(entry);
    return entry;
  },

  removePluginSettingsSection(entry) {
    if (!entry) return;
    const list = App._pluginSections[entry.target];
    const i = list ? list.indexOf(entry) : -1;
    if (i >= 0) list.splice(i, 1);
    if (entry.card.parentNode) entry.card.parentNode.removeChild(entry.card);
  },

  resetSettingsModal(group) {
    const filter = group ? f => f.group === group : null;
    if (!filter) return;
    SETTINGS_FIELDS.filter(filter).forEach(({ id, def, type }) => {
      const el = els[id];
      if (type === 'check') el.checked = def;
      else el.value = def;
    });
  },

  async createProject() {
    const name = (await App.dialogPrompt('New project name:'))?.trim();
    if (!name) return;
    const ctx = { name, cancel: false };
    await CSTL.plugins.runHooks('projectCreate', ctx);
    if (ctx.cancel) return;
    const id = makeProjId();
    State.resetTransient();
    State.projectId = id;
    State.projectName = ctx.name || name;
    try {
      await Storage.createProjectDir(id);
      const data = State.toData();
      await Storage.saveProject(id, data);
      await Storage.upsertProjectIndexEntry(Storage.projectIndexEntry(id, data, Date.now()));
      App.open(id, data);
    } catch (e) {
      App.flash(friendlyError(e, "Couldn't create project: "), true, 'error');
    }
  },

  open(id, data) {
    EpubImages.clear();
    State.loadFromData(data);
    State.projectId = id;
    State.selected.clear();
    State.undoStack = [];
    State.redoStack = [];
    State.namesDirty = true;
    els.rangeFromInput.value = '';
    els.rangeToInput.value = '';

    Storage.upsertProjectIndexEntry(Storage.projectIndexEntry(id, data, Date.now())).catch(e => console.error('[index] upsert failed:', e));
    if (data.projectType === 'epub' && data.epubSourceId) EpubImages.preload(id);

    if (App.dashboardObserver) { App.dashboardObserver.disconnect(); App.dashboardObserver = null; }
    App.stopStorageWatch();

    els.projectNameDisplay.textContent = State.projectName;
    els.dashboardView.classList.remove('open');
    els.workspaceView.hidden = false;
    CSTL.plugins.onProjectOpened();
    App.applyHideTools();
    App.refresh(false);
    App.syncBookmarkUI();
    App.toggleBookmarkPanel(false);
  },

  closeProject() {
    if (State.saveTimer) {
      clearTimeout(State.saveTimer);
      State.saveTimer = null;
      const id = State.projectId;
      const data = State.toData();
      (async () => {
        try {
          if (window.CSTL?.plugins) await CSTL.plugins.runHooks('beforeSave', data);
          await Storage.saveProject(id, data);
          await Storage.upsertProjectIndexEntry(Storage.projectIndexEntry(id, data, Date.now()));
          if (window.CSTL?.plugins) await CSTL.plugins.runHooks('afterSave', data);
        } catch (e) {
          App.flash(friendlyError(e, "Couldn't save latest changes: "), true, 'error');
        }
        App.finishClose();
      })();
    } else App.finishClose();
  },

  finishClose() {
    CSTL.plugins.onProjectClosed();
    EpubImages.clear();
    State.resetTransient();
    App.syncImportAccept();
    App.main.setItems([], false);
    App.pr.setItems([], false);
    els.nameTableBody.replaceChildren();
    els.pasteArea.value = '';
    els.rangeFromInput.value = '';
    els.rangeToInput.value = '';
    els.copyStatus.classList.add('empty');
    els.progressText.textContent = '0/0 (0%)';
    els.progressText.classList.remove('saved');
    els.stickyFileName.textContent = '';
    els.stickyFileName.title = '';
    els.stickyFileRange.textContent = '';
    els.stickyFileBar.classList.remove('show');
    els.stickyFileCheckbox.checked = false;
    els.stickyFileCheckbox.disabled = true;
    delete els.stickyFileCheckbox.dataset.file;
    App.lastFile = null;
    App.fileCache = null;
    App.toggleBookmarkPanel(false);
    els.bookmarkList.replaceChildren();
    App.syncBookmarkUI();
    els.workspaceView.hidden = true;
    els.split.classList.remove('hide-tools');
    els.workspaceToolbar.classList.remove('hidden');
    els.btnShowHeader.classList.remove('visible');
    els.dashboardView.classList.add('open');
    App.startStorageWatch();
    App.loadDashboard();
  },

  applyHideTools() {
    els.split.classList.toggle('hide-tools', State.hideTools);
    requestAnimationFrame(() => App.main.forceUpdate());
  },

  syncImportAccept() {
    const info = CSTL.plugins.activeParserInfo();
    const accept = info.magic ? '' : Array.from(info.extensions).join(',');
    els.importFileInput.accept = accept;
    els.importFolderInput.accept = accept;
  },

  renderShortcutList() {
    const wrap = els.shortcutList;
    const bindings = Shortcuts.loadBindings();
    wrap.replaceChildren();
    const groups = [
      { label: 'Dashboard', actions: Shortcuts._actions.filter(a => a.scope === 'dashboard') },
      { label: 'Workspace', actions: Shortcuts._actions.filter(a => a.scope === 'workspace') }
    ];
    for (const g of groups) {
      if (!g.actions.length) continue;
      const head = document.createElement('div');
      head.className = 'shortcut-group';
      head.textContent = g.label;
      wrap.appendChild(head);
      for (const a of g.actions) wrap.appendChild(App.buildShortcutRow(a, bindings));
    }
  },

  buildShortcutRow(action, bindings) {
    const row = document.createElement('div');
    row.className = 'shortcut-row';
    const label = document.createElement('span');
    label.className = 'shortcut-label';
    label.textContent = action.label;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shortcut-key';
    const cur = action.id in bindings ? bindings[action.id] : (action.def || '');
    btn.innerHTML = cur ? comboHtml(cur) : '<span class="shortcut-none">Not set</span>';
    btn.title = 'Click then press a key combination (Backspace deletes, Escape cancels)';
    btn.addEventListener('click', () => Shortcuts.startRecording(action, btn));
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'shortcut-reset';
    reset.title = 'Reset to default';
    reset.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/></svg>';
    const isCustom = (action.id in bindings) && bindings[action.id] !== (action.def || '');
    reset.hidden = !isCustom;
    reset.addEventListener('click', () => {
      const b = Shortcuts.loadBindings();
      delete b[action.id];
      Shortcuts.saveBindings(b);
      Shortcuts.rebuild();
      App.renderShortcutList();
    });
    row.append(label, btn, reset);
    return row;
  },

  async wipeAllData() {
    if (!await App.dialogConfirm('Wipe all data?', 'All projects and data will be permanently deleted. This action cannot be undone.')) return;
    if (State.saveTimer) {
      clearTimeout(State.saveTimer);
      State.saveTimer = null;
    }
    State.projectId = null;
    Progress.determinate('Deleting all data...', 'Preparing...');
    let wipeError = null;
    try {
      await Storage.wipeAll((done, total) => {
        Progress.update(total ? `Deleting item ${done}/${total}...` : 'Deleting...', total ? Math.round(done / total * 100) : 100);
      });
    } catch (e) { wipeError = e; }
    try { for (const k of await caches.keys()) await caches.delete(k); } catch (e) { console.error('[wipe] caches clear failed:', e); }
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    } catch (e) { console.error('[wipe] SW unregister failed:', e); }
    Progress.hide();
    if (wipeError) {
      App.flash('Failed to delete all data: ' + (wipeError.message || wipeError) + '\n\nSome data may remain.', true, 'error');
      return;
    }
    location.reload();
  },

  ensureSW() {
    if (App.swRegistered) return;
    App.swRegistered = true;
    navigator.serviceWorker.register('./sw.js').catch(() => { App.swRegistered = false; });
  },

  checkStorageAlive() {
    if (!els.dashboardView.classList.contains('open')) return;
    if (App.storageCheckBusy) return;
    App.storageCheckBusy = true;
    const done = () => { App.storageCheckBusy = false; };
    if (App.dashboardFailed) {
      Promise.resolve(App.loadDashboard()).then(done, done);
      return;
    }
    Storage.probe()
      .then(ok => { if (!ok) return App.loadDashboard(); })
      .catch(e => console.error('[storage] probe failed:', e))
      .then(() => App.maybePersistAndCheckQuota())
      .then(done, done);
  },

  async maybePersistAndCheckQuota() {
    await App.ensurePersisted();
    App._storageCheckCount++;
    if (App._storageCheckCount % 8 !== 0) return;
    const est = await navigator.storage.estimate();
    if (!est || !est.quota) return;
    const free = (est.quota || 0) - (est.usage || 0);
    const freeMb = free / (1024 * 1024);
    if (freeMb < CFG.storage.criticalFreeMb) {
      if (!App._storageCriticalShown) {
        App._storageCriticalShown = true;
        App.flash(`Storage critical (${freeMb.toFixed(0)} MB free). Some writes may fail to save. Export your project as a backup.`);
      }
    } else if (freeMb >= CFG.storage.safeFreeMb) {
      App._storageCriticalShown = false;
    }
  },

  ensurePersisted() {
    return navigator.storage.persisted().then(already => already ? null : navigator.storage.persist().catch(() => {}));
  },

  startStorageWatch() {
    App.stopStorageWatch();
    App.storageWatchTimer = setInterval(() => {
      if (document.hidden) return;
      App.checkStorageAlive();
    }, CFG.delay.storageWatchMs);
  },

  stopStorageWatch() {
    clearInterval(App.storageWatchTimer);
    App.storageWatchTimer = null;
  },

  scheduleStorageHeal() {
    if (App.healScheduled) return;
    App.healScheduled = true;
    Storage.probe().then(ok => {
      if (ok) return;
      if (/[?&]heal=1/.test(location.search)) return;
      history.replaceState(null, '', location.pathname + (location.search || '') + (location.search ? '&' : '?') + 'heal=1');
      setTimeout(() => location.reload(), CFG.delay.reloadMs);
    }).catch(e => console.error('[storage] heal probe failed:', e));
  },

  async loadDashboard() {
    const list = els.projectList;
    const content = list.parentElement;
    const countBadge = els.projectCount;

    if (App.dashboardObserver) { App.dashboardObserver.disconnect(); App.dashboardObserver = null; }
    App.dashboardSentinel = null;
    App.dashboardItems = [];
    App.dashboardAllItems = [];
    App.dashboardRendered = 0;
    list.innerHTML = '';

    try {
      const items = await Storage.listProjects();
      App.dashboardFailed = false;
      App.healScheduled = false;
      if (location.search) history.replaceState(null, '', location.pathname);
      App.dashboardAllItems = items;

      countBadge.textContent = items.length;
      countBadge.hidden = false;
      els.heroActions.style.display = items.length ? '' : 'none';
      if (!items.length) {
        content.classList.add('is-empty');
        list.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
            </div>
            <h3 class="empty-state-title">No projects yet</h3>
            <p class="empty-state-desc">Start by creating a new project, or restore from an existing backup file.</p>
            <div class="empty-state-actions">
              <button type="button" class="btn btn-primary btn-sm" data-action="new">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
                Create Project
              </button>
              <button type="button" class="btn btn-ghost btn-sm" data-action="restore">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v5h-5"/></svg>
                Restore Project
              </button>
            </div>
          </div>
        `;
        list.querySelector('.empty-state [data-action="new"]').addEventListener('click', () => els.btnNewProject.click());
        list.querySelector('.empty-state [data-action="restore"]').addEventListener('click', () => els.btnRestoreProject.click());
        return;
      }
      content.classList.remove('is-empty');
      App.renderDashboardItems();
    } catch {
      App.dashboardFailed = true;
      Storage.invalidateRoot();
      App.scheduleStorageHeal();
      countBadge.hidden = true;
      content.classList.remove('is-empty');
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="var(--danger)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <h3 class="empty-state-title">Couldn't access storage</h3>
          <p class="empty-state-desc">The browser denied storage access, usually because site data was just cleared. The list will try to reload automatically; if it still fails, close and reopen the app.</p>
        </div>
      `;
    }
  },

  renderDashboardItems() {
    const list = els.projectList;
    if (App.dashboardObserver) { App.dashboardObserver.disconnect(); App.dashboardObserver = null; }
    App.dashboardSentinel = null;
    App.dashboardRendered = 0;
    list.innerHTML = '';

    const searchInput = els.projectSearch;
    const sortSelect = els.projectSort;
    const clearBtn = els.projectSearchClear;

    const query = (searchInput.value || '').trim().toLowerCase();
    const sortMode = sortSelect.value || 'newest';
    clearBtn.hidden = !query;

    let items = App.dashboardAllItems.slice();

    if (query) {
      items = items.filter(p => (p.name || '').toLowerCase().includes(query));
    }

    items.sort((a, b) => {
      switch (sortMode) {
        case 'oldest':
          return (a.updatedAt || 0) - (b.updatedAt || 0);
        case 'name-asc':
          return (a.name || '').localeCompare(b.name || '', 'en');
        case 'name-desc':
          return (b.name || '').localeCompare(a.name || '', 'en');
        case 'progress-desc': {
          const pa = a.lineCount ? a.translatedCount / a.lineCount : 0;
          const pb = b.lineCount ? b.translatedCount / b.lineCount : 0;
          return pb - pa || (b.updatedAt || 0) - (a.updatedAt || 0);
        }
        case 'progress-asc': {
          const pa = a.lineCount ? a.translatedCount / a.lineCount : 0;
          const pb = b.lineCount ? b.translatedCount / b.lineCount : 0;
          return pa - pb || (b.updatedAt || 0) - (a.updatedAt || 0);
        }
        case 'newest':
        default:
          return (b.updatedAt || 0) - (a.updatedAt || 0);
      }
    });

    App.dashboardItems = items;

    if (!items.length) {
      list.innerHTML = `
        <div class="no-results">
          <div class="no-results-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          </div>
          <h3 class="no-results-title">No matching projects</h3>
          <p class="no-results-desc">${query ? `No projects found with keyword "<strong>${escapeHtml(query)}</strong>". Try another keyword or clear the search filter.` : 'No projects to display.'}</p>
        </div>
      `;
      return;
    }

    const sentinel = document.createElement('div');
    sentinel.className = 'dashboard-sentinel';
    list.appendChild(sentinel);
    App.dashboardSentinel = sentinel;

    App.dashboardObserver = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && App.dashboardRendered < App.dashboardItems.length) {
        App.renderDashboardPage();
      }
    }, { rootMargin: '300px' });
    App.dashboardObserver.observe(sentinel);

    App.renderDashboardPage();
  },

  renderDashboardPage() {
    const list = els.projectList;
    const sentinel = App.dashboardSentinel;
    if (!sentinel) return;

    const start = App.dashboardRendered;
    const end = Math.min(start + CFG.dashboardPageSize, App.dashboardItems.length);
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      frag.appendChild(App.buildProjectCard(App.dashboardItems[i]));
    }
    App.dashboardRendered = end;
    list.insertBefore(frag, sentinel);

    if (App.dashboardRendered >= App.dashboardItems.length) {
      App.dashboardObserver?.disconnect();
      App.dashboardObserver = null;
      sentinel.remove();
      App.dashboardSentinel = null;
    }
  },

  buildProjectCard(p) {
    const card = document.createElement('div');
    card.className = 'project-card';

    const hasData = p.fileCount || p.lineCount;
    let badge = '';
    let typeClass = '';
    if (hasData) {
      if (p.projectType === 'epub') {
        badge = '<span class="badge badge-epub">EPUB</span>';
        typeClass = 'is-epub';
      } else if (p.projectType === 'json') {
        badge = '<span class="badge badge-json">JSON-VNTP</span>';
        typeClass = 'is-json';
      } else if (p.projectType === 'plugin') {
        const pluginMissing = p.pluginId && !CSTL.plugins.getMeta(p.pluginId);
        badge = pluginMissing
          ? `<span class="badge badge-plugin is-missing" title="Plugin ${escapeHtml(p.pluginName || p.pluginId)} isn't installed">PLUGIN REQUIRED</span>`
          : '<span class="badge badge-plugin">PLUGIN</span>';
      }
    }
    if (typeClass) card.classList.add(typeClass);

    const pct = p.lineCount ? Math.min(100, Math.floor(p.translatedCount / p.lineCount * 100)) : 0;
    const isComplete = pct >= 100 && p.lineCount > 0;
    const fillClass = isComplete ? 'project-progress-fill is-complete' : 'project-progress-fill';
    const updatedStr = new Date(p.updatedAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    const updatedTime = new Date(p.updatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    card.innerHTML = `
      <div class="project-card-main">
        <div class="project-card-head">
          <h3>${escapeHtml(p.name)}</h3>
          ${badge}
        </div>
        ${p.lineCount > 0 ? `
        <div class="project-progress">
          <div class="project-progress-bar">
            <div class="${fillClass}" style="width:${pct}%"></div>
          </div>
          <div class="project-progress-text">
            <span>${p.translatedCount}/${p.lineCount} lines</span>
            <span class="pct">${pct}%</span>
          </div>
        </div>
        ` : ''}
        <div class="project-meta">
          <div class="project-meta-item">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <span>${updatedStr} · ${updatedTime}</span>
          </div>
          <div class="project-meta-item">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span>${p.fileCount} file</span>
          </div>
        </div>
      </div>
      <div class="project-actions">
        <button class="btn btn-primary btn-sm btn-open">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>
          Open Project
        </button>
        <div class="project-actions-row">
          <button class="btn btn-ghost btn-rename" title="Rename">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Rename
          </button>
          <button class="btn btn-ghost btn-backup" title="Backup">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Backup
          </button>
          <button class="btn btn-ghost btn-delete" title="Delete">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1.4 14.1A2 2 0 0 1 15.6 22H8.4a2 2 0 0 1-2-1.9L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
            Delete
          </button>
        </div>
      </div>
    `;
    card.querySelector('.btn-open').addEventListener('click', async () => {
      try {
        const data = await Storage.loadProject(p.id);
        if (data.projectType === 'plugin' && data.pluginId && !CSTL.plugins.getMeta(data.pluginId)) {
          App.flash(`This project requires the plugin "${data.pluginName || data.pluginId}" to be opened.\nInstall the plugin first via Settings → Open Plugin Manager, then reopen this project.`, true, 'info');
          return;
        }
        App.open(p.id, data);
      } catch (e) {
        App.flash(friendlyError(e, "Couldn't open project: "), true, 'error');
        if (e?.storage) App.loadDashboard();
      }
    });
    card.querySelector('.btn-rename').addEventListener('click', async () => {
      const name = await App.dialogPrompt({ title: 'New name:', value: p.name });
      if (!name?.trim() || name === p.name) return;
      try {
        const data = await Storage.loadProject(p.id);
        data.projectName = name.trim();
        await Storage.saveProject(p.id, data);
        await Storage.upsertProjectIndexEntry(Storage.projectIndexEntry(p.id, data, Date.now()));
        App.loadDashboard();
      } catch (e) {
        App.flash(friendlyError(e, "Couldn't rename: "), true, 'error');
        if (e?.storage) App.loadDashboard();
      }
    });
    card.querySelector('.btn-backup').addEventListener('click', async () => {
      App.backup({ id: p.id, name: p.name });
    });
    card.querySelector('.btn-delete').addEventListener('click', async () => {
      if (!await App.dialogConfirm(`Delete "${p.name}"?`, 'This project and all its data will be permanently deleted.')) return;
      try {
        await Storage.deleteProject(p.id);
        card.classList.add('is-removing');
        setTimeout(() => App.loadDashboard(), 280);
      } catch (e) {
        App.flash(friendlyError(e, "Couldn't delete: "), true, 'error');
        if (e?.storage) App.loadDashboard();
      }
    });
    return card;
  },

  async backup(p) {
    const result = await withProgress('Backing up project...', 'Reading data...', async () => {
      Progress.determinate('Backing up project', 'Processing...');
      const r = await buildProjectBackup(p.id, p.name, Progress.update);
      download(URL.createObjectURL(r.blob), r.name);
      return r;
    }, e => friendlyError(e, 'Backup failed: '));
    if (result?.warnings?.length) {
      App.flash('Backup completed with notes:\n- ' + result.warnings.join('\n- '), true, 'info');
    }
  },

  async backupAll() {
    const result = await withProgress('Backing up all projects...', 'Counting projects...', async () => {
      Progress.determinate('Backing up all projects', 'Starting...');
      const r = await backupAll(Progress.update);
      download(URL.createObjectURL(r.blob), r.name);
      return r;
    }, e => e.message === 'No Projects to backup yet.' ? e.message : friendlyError(e, 'Backup all projects failed: '));
    if (result?.warnings?.length) {
      App.flash('Backup completed with notes:\n- ' + result.warnings.join('\n- '), true, 'info');
    }
  },

  async restoreProject(e) {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;
    await CSTL.plugins.runHooks('beforeRestore', { fileName: uploadedFile.name });
    const result = await withProgress('Restoring project...', 'Loading archive...', async () => {
      Progress.determinate('Restoring project', 'Reading archive...');
      const r = await parseRestore(await uploadedFile.arrayBuffer(), uploadedFile.name.replace(/\.cstl$/i, ''), Progress.update);
      await App.loadDashboard();
      return r;
    }, e => friendlyError(e, 'Corrupt file: '));
    if (result) {
      await CSTL.plugins.runHooks('afterRestore', { fileName: uploadedFile.name, ok: result.ok || 1, single: !!result.single });
      if (result.single) App.flash(`Project "${result.name}" restored!`, false, 'success');
      else {
        const failMsg = result.fail
          ? `, ${result.fail} failed:\n- ${result.errors.slice(0, 5).map(e => `${e.name}: ${e.message}`).join('\n- ')}`
          : '';
        App.flash(`${result.ok} projects successfully restored${failMsg}.`, false, 'success');
      }
    }
    e.target.value = '';
  },

  refresh(keep = true, changedKey = null) {
    State.updateCount();
    State.rebuild();
    if (keep) {
      if (changedKey) {
        App.main.invalidateHeight(changedKey);
      } else {
        App.main.invalidateHeights();
      }
    }
    App.main.setItems(State.rows, keep);
    App.updateFileBadge();
    App.updateButtons();
    App.syncBookmarkUI();
    if (State.namesDirty) { App.renderNames(); State.namesDirty = false; }
    App.updateStatusBar();
    els.btnUndo.disabled = State.undoStack.length === 0;
    els.btnRedo.disabled = State.redoStack.length === 0;
  },

  updateButtons() {
    const has = State.lines.length > 0;
    const sel = State.selected.size > 0;
    [els.btnExport, els.btnProofread, els.btnSelectAll, els.pasteArea, els.btnApply, els.rangeFromInput, els.rangeToInput, els.btnSelectRange].forEach(b => { b.disabled = !has; });
    els.btnClearSelection.disabled = !sel;
    els.btnCopyForAi.disabled = !sel;
    const n = State.selected.size;
    els.btnCopyForAi.textContent = n > 0 ? `Copy ${n} Lines` : 'Copy';
  },

  updateStatusBar() {
    const total = State.lines.length;
    const tl = State.translatedCount;
    const pct = total ? Math.floor((tl / total) * 100) : 0;
    els.progressText.textContent = `${tl}/${total} (${pct}%)`;
  },

  updateFileBadge() {
    const bar = els.stickyFileBar;
    const nameEl = els.stickyFileName;
    const rangeEl = els.stickyFileRange;
    const cb = els.stickyFileCheckbox;
    if (!bar || !nameEl || !App.main) return;

    const scrollTop = els.previewViewport.scrollTop;
    const headers = State.headerIdx;

    if (!headers.length) {
      bar.classList.remove('show');
      nameEl.textContent = '';
      rangeEl.textContent = '';
      cb.disabled = true;
      cb.checked = false;
      cb.indeterminate = false;
      delete cb.dataset.file;
      App.lastFile = null;
      App.fileCache = null;
      return;
    }

    let activeHeaderIdx = -1;
    let lo = 0, hi = headers.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const idx = headers[mid];
      const p = App.main.pos[idx];
      const h = App.main.heights[idx];
      if (p + h <= scrollTop) { activeHeaderIdx = idx; lo = mid + 1; }
      else hi = mid - 1;
    }
    const activeFile = activeHeaderIdx >= 0 ? State.rows[activeHeaderIdx].file : null;

    if (activeFile !== App.lastFile) {
      if (activeFile) {
        App._applyFileBadgeContent(activeFile, nameEl, rangeEl, cb);
        bar.classList.add('show');
      } else {
        nameEl.textContent = '';
        rangeEl.textContent = '';
        cb.disabled = true;
        cb.checked = false;
        cb.indeterminate = false;
        delete cb.dataset.file;
        bar.classList.remove('show');
      }
      App.lastFile = activeFile;
      App.fileCache = null;
    }

    if (activeFile) {
      const fileLineCount = (State.fileLines.get(activeFile) || []).length;
      const key = `${activeFile}:${State.selected.size}:${State.translatedCount}:${fileLineCount}`;
      if (!App.fileCache || App.fileCache.key !== key) {
        App.fileCache = { key, ...App.computeFileCbState(activeFile) };
      }
      cb.disabled = App.fileCache.disabled;
      cb.checked = App.fileCache.checked;
      cb.indeterminate = App.fileCache.indeterminate;
    }
  },

  _applyFileBadgeContent(file, nameEl, rangeEl, cb) {
    nameEl.textContent = baseName(file);
    nameEl.title = file;
    const lines = State.fileLines.get(file) || [];
    rangeEl.textContent = lines.length ? `${lines[0].line_num}-${lines[lines.length - 1].line_num}` : '';
    cb.dataset.file = file;
  },

  toggleFileSelection(cb) {
    const file = cb.dataset.file;
    if (!file) return;
    const lines = State.fileLines.get(file) || [];
    lines.forEach(l => {
      if (isTrans(l)) return;
      if (cb.checked) State.selected.add(l.line_num);
      else State.selected.delete(l.line_num);
    });
    App.syncCheckboxes();
  },

  computeFileCbState(file) {
    const lines = State.fileLines.get(file) || [];
    let sel = 0, un = 0;
    lines.forEach(l => { if (!isTrans(l)) { un++; if (State.selected.has(l.line_num)) sel++; } });
    return {
      disabled: un === 0,
      checked: un > 0 && sel === un,
      indeterminate: sel > 0 && sel < un
    };
  },

  createMainRow() {
    const row = document.createElement('div');
    row.className = 'preview-row';
    const cell = document.createElement('div');
    cell.className = 'checkbox-cell';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    const content = document.createElement('div');
    content.className = 'text-content';
    const orig = document.createElement('div');
    orig.className = 'original';
    const trans = document.createElement('div');
    trans.className = 'translated';
    content.append(orig, trans);
    cell.append(cb, content);
    const hdr = document.createElement('div');
    hdr.className = 'file-header-inner';
    const hCb = document.createElement('input');
    hCb.type = 'checkbox';
    const hName = document.createElement('span');
    hName.className = 'file-name';
    const hRange = document.createElement('span');
    hRange.className = 'file-range';
    hdr.append(hCb, hName, hRange);
    const bm = document.createElement('button');
    bm.type = 'button';
    bm.className = 'row-bookmark-btn';
    bm.setAttribute('aria-label', 'Toggle bookmark');
    bm.tabIndex = -1;
    bm.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>';
    const imgBox = document.createElement('div');
    imgBox.className = 'row-image-box';
    const imgSpinner = document.createElement('div');
    imgSpinner.className = 'row-image-spinner';
    const imgEl = document.createElement('img');
    imgEl.className = 'row-image-el';
    imgEl.alt = '';
    const imgLabel = document.createElement('span');
    imgLabel.className = 'row-image-label';
    imgBox.append(imgSpinner, imgEl, imgLabel);
    imgEl.addEventListener('error', () => imgBox.classList.add('img-error'));
    row.append(cell, hdr, bm, imgBox);
    row._cell = cell; row._cb = cb; row._orig = orig; row._trans = trans;
    row._hdr = hdr; row._hCb = hCb; row._hName = hName; row._hRange = hRange;
    row._bm = bm;
    row._imgBox = imgBox; row._imgEl = imgEl; row._imgLabel = imgLabel; row._imgToken = 0;
    CSTL.plugins.runHooksSync('lineCreate', row);
    return row;
  },

  updateMainRow(row, data) {
    if (data.type === 'image') {
      row.className = 'preview-row row-image';
      row._cell.style.display = 'none';
      row._hdr.style.display = 'none';
      row._bm.style.display = 'none';
      row._imgBox.style.display = 'flex';
      row._imgBox.classList.remove('img-error');
      const entry = data.img;
      row._imgLabel.textContent = entry.isCover ? 'EPUB Cover' : 'Image';
      row._imgEl.removeAttribute('src');
      row._imgEl.alt = entry.isCover ? 'EPUB Cover' : 'Image in chapter';
      const token = ++row._imgToken;
      const loadMediaPath = entry.mediaPath;
      const cacheKey = loadMediaPath || entry.zipPath;
      const cached = EpubImages.peekUrl(State.projectId, cacheKey);
      if (cached !== undefined) {
        row._imgBox.classList.remove('img-loading');
        if (cached) row._imgEl.src = cached;
        else row._imgBox.classList.add('img-error');
      } else {
        row._imgBox.classList.add('img-loading');
        const promise = loadMediaPath
          ? EpubImages.getUrlFromMediaPath(State.projectId, loadMediaPath)
          : EpubImages.getUrl(State.projectId, entry.zipPath);
        promise.then(url => {
          if (row._imgToken !== token) return;
          row._imgBox.classList.remove('img-loading');
          if (url) row._imgEl.src = url;
          else row._imgBox.classList.add('img-error');
        }).catch(e => {
          console.error('[image] load failed:', e);
          if (row._imgToken !== token) return;
          row._imgBox.classList.remove('img-loading');
          row._imgBox.classList.add('img-error');
        });
      }
      return;
    }
    row._imgBox.style.display = 'none';
    if (data.type === 'header') {
      row.className = 'preview-row file-header';
      row._cell.style.display = 'none';
      row._hdr.style.display = 'flex';
      row._hName.textContent = baseName(data.file);
      row._hName.title = data.file;
      const lines = State.fileLines.get(data.file) || [];
      row._hRange.textContent = lines.length ? `${lines[0].line_num}-${lines[lines.length - 1].line_num}` : '';
      row._hCb.dataset.file = data.file;
      const st = App.computeFileCbState(data.file);
      row._hCb.disabled = st.disabled;
      row._hCb.checked = st.checked;
      row._hCb.indeterminate = st.indeterminate;
      row._bm.style.display = 'none';
    } else {
      const l = data.line;
      let cls = 'preview-row';
      if (isTrans(l)) cls += ' row-translated';
      if (State.selected.has(l.line_num)) cls += ' row-selected';
      if (State.bookmarkSet.has(l.line_num)) cls += ' row-bookmarked';
      row.className = cls;
      row._cell.style.display = 'flex';
      row._hdr.style.display = 'none';
      row._cb.dataset.num = l.line_num;
      row._cb.checked = State.selected.has(l.line_num);
      row._cb.disabled = isTrans(l);
      row._orig.textContent = App.formatLine(l);
      if (isTrans(l)) {
        row._trans.classList.remove('cell-muted');
        const n = l.trans_name || l.name;
        row._trans.textContent = n ? `${l.line_num}. ${n}: ${l.trans_message}` : `${l.line_num}. ${l.trans_message}`;
      } else {
        row._trans.classList.add('cell-muted');
        row._trans.textContent = '——';
      }
      row._bm.style.display = 'inline-flex';
      row._bm.dataset.num = l.line_num;
      const isBm = State.bookmarkSet.has(l.line_num);
      row._bm.setAttribute('aria-pressed', isBm ? 'true' : 'false');
      row._bm.title = isBm ? 'Remove bookmark' : 'Add bookmark';
      CSTL.plugins.runHooksSync('lineRender', row, l);
    }
  },

  syncCheckboxes() {
    App.main.forceUpdate();
    App.updateFileBadge();
    App.updateButtons();
  },

  uniqueNames() {
    const set = new Set();
    for (const l of State.lines) if (l.name) set.add(l.name);
    return Array.from(set).sort();
  },

  renderNames() {
    const arr = App.uniqueNames();
    els.nameTotalCount.textContent = arr.length;

    const hasNames = arr.length > 0;
    const gloss = App.buildGlossaryMap();
    const hasGloss = hasNames && arr.some(n => gloss.has(n));
    const hasMissing = hasNames && arr.some(n => !gloss.has(n));
    els.btnCopyAllNames.disabled = !hasNames;
    els.btnCopyNamesPlain.disabled = !hasNames;
    els.btnCopyNamesWithGlossary.disabled = !hasGloss;
    els.btnCopyNamesMissingGlossary.disabled = !hasMissing;

    const body = els.nameTableBody;
    body.replaceChildren();
    const frag = document.createDocumentFragment();
    for (const name of arr) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'mono';
      td.textContent = name;
      td.title = 'Click to copy';
      tr.appendChild(td);
      frag.appendChild(tr);
    }
    body.appendChild(frag);
  },

  async copyAllNames(mode) {
    closeDropdowns();
    const arr = App.uniqueNames();
    if (!arr.length) return;
    const gloss = App.buildGlossaryMap();
    let lines, label;
    if (mode === 'plain') {
      lines = arr;
      label = `${arr.length} names copied!`;
    } else if (mode === 'glossary') {
      lines = arr.map(n => `${n}: ${gloss.get(n) || ''}`);
      label = `${arr.length} names + glossary copied!`;
    } else {
      const missing = arr.filter(n => !gloss.has(n));
      lines = missing.map(n => `${n}: `);
      label = `${missing.length} names (not in glossary) copied!`;
    }
    if (!lines.length) { App.flash('No matching names.'); return; }
    try { await clipboard(lines.join('\n')); App.flash(label); }
    catch { App.flash('Clipboard blocked.', true, 'error'); }
  },

  selectRange() {
    const from = parseInt(els.rangeFromInput.value, 10);
    const to = parseInt(els.rangeToInput.value, 10);
    const max = State.lines.length ? State.maxLineNum() : 0;
    if (isNaN(from) || isNaN(to) || from > to || from < 1 || from > max || to > max) return App.flash('Invalid range.', true, 'error');

    State.selected.clear();
    for (let n = from; n <= to; n++) {
      const l = State.byNum.get(n);
      if (l && !isTrans(l)) State.selected.add(n);
    }
    App.syncCheckboxes();
    App.scrollToLine(from);
  },

  buildGlossaryMap() {
    const map = new Map();
    if (State.vndbEnabled && State.vndbGlossary?.length) {
      State.vndbGlossary.forEach(e => map.set(e[0], e[1]));
    }
    return map;
  },

  formatLine(l) {
    const base = l.name ? `${l.line_num}. ${l.name}: ${l.message}` : `${l.line_num}. ${l.message}`;
    return CSTL.plugins.runHooksSync('formatLine', base, l);
  },

  formatLineForAi(l) {
    const name = (!State.ignoreName && l.name) ? `${l.name}: ` : '';
    const base = `${l.line_num}. ${name}${l.message}`;
    return CSTL.plugins.runHooksSync('formatLineForAi', base, l);
  },

  async copyForAi() {
    const sel = State.lines.filter(l => State.selected.has(l.line_num));
    const ctx = { lines: sel.map(l => l.line_num), count: sel.length };
    await CSTL.plugins.runHooks('beforeCopy', ctx);
    const parts = [];
    if (State.promptEnabled && State.prompt.trim()) parts.push(State.prompt.trim());
    parts.push(FIXED_FORMAT_PROMPT);

    const gloss = App.buildGlossaryMap();
    if (gloss.size > 0) {
      const lines = [];
      gloss.forEach((v, k) => lines.push(`${k}: ${v}`));
      parts.push(`VNDB Glossary:\n${lines.join('\n')}`);
    }
    if (State.customEnabled && State.customRaw.trim()) parts.push(`Custom Glossary:\n${State.customRaw.trim()}`);
    if (State.summaryEnabled) {
      if (State.summary && State.summary.trim()) parts.push(`Previous Summary:\n${State.summary.trim()}`);
      if (State.summaryPrompt && State.summaryPrompt.trim()) parts.push(State.summaryPrompt.trim());
    }
    parts.push(sel.map(App.formatLineForAi).join('\n'));
    const text = await CSTL.plugins.runCopyHook(parts.join('\n\n'));

    try {
      await clipboard(text);
      App.flash(`Copied ${sel.length} lines.`);
      CSTL.plugins.emit('copy', { count: sel.length, lines: sel.map(l => l.line_num) });
      await CSTL.plugins.runHooks('afterCopy', { ...ctx, text });
    } catch {
      els.pasteArea.value = text;
      App.flash(`Clipboard blocked. Text moved to the 'Paste AI result' field.`, true, 'info');
    }
  },

  parseAi(raw, byNum) {
    const fenceLines = raw.split(/\r?\n/).filter(l => /^\s*```\w*\s*$/.test(l));
    if (fenceLines.length !== 0 && fenceLines.length !== 2) {
      return { results: [], errors: ['There must be both an opening and closing ``` together, or none at all.'], seen: new Set(), summary: null };
    }
    const text = raw.split(/\r?\n/).filter(l => !/^\s*```\w*\s*$/.test(l)).join('\n');
    const tagMatch = text.match(/<translate>([\s\S]*?)<\/translate>/i);
    if (!tagMatch) {
      return { results: [], errors: ['<translate>...</translate> tag not found.'], seen: new Set(), summary: null };
    }
    if ((text.match(/<translate>/gi) || []).length > 1) {
      return { results: [], errors: ['More than one <translate>...</translate> tag found.'], seen: new Set(), summary: null };
    }
    const before = text.slice(0, tagMatch.index).trim();
    const after = text.slice(tagMatch.index + tagMatch[0].length).trim();
    const summary = [before, after].filter(Boolean).join('\n\n').trim() || null;
    const lines = tagMatch[1].split(/\r?\n/);

    const results = [];
    const errors = [];
    const seen = new Set();
    const re = /^(\d+)\.\s+(.*)$/;
    const numRe = /^(\d+)/;
    let lastValidNum = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const m = line.match(re);
      if (!m) {
        const leading = line.match(numRe);
        if (leading) {
          errors.push(`Line ${leading[1]}: Invalid format (must be "N. ..." with a space after the period).`);
        } else if (lastValidNum !== null) {
          errors.push(`Line ${lastValidNum}: Continuation line without a number detected in AI text.`);
        }
        continue;
      }
      const num = Number(m[1]);
      const rest = m[2].trim();
      if (!Number.isInteger(num) || num <= 0) { errors.push(`Line ${num}: Invalid ID.`); continue; }
      if (seen.has(num)) { errors.push(`Line ${num}: Duplicate ID.`); continue; }
      seen.add(num);
      lastValidNum = num;

      const orig = byNum ? byNum.get(num) : null;
      let name = null, msg = rest;
      if (orig && orig.name) {
        const ci = rest.indexOf(': ');
        if (ci > 0) { name = rest.substring(0, ci).trim(); msg = rest.substring(ci + 2).trim(); }
        else if (rest.endsWith(':')) { name = rest.substring(0, rest.length - 1).trim(); msg = ''; }
      }
      results.push({ num, name, msg });
    }
    return { results, errors, seen, summary };
  },

  async applyTranslation() {
    if (!State.lines.length) return;
    const raw = await CSTL.plugins.runApplyHook(els.pasteArea.value.trim());
    if (!raw) return App.flash('Empty text.', true, 'error');

    const applyCtx = { raw, selected: Array.from(State.selected) };
    await CSTL.plugins.runHooks('beforeApply', applyCtx);

    const { results, errors, seen, summary } = App.parseAi(raw, State.byNum);
    if (!results.length) {
      if (errors.length) return App.flash('REJECTED:\n' + errors.slice(0, CFG.warningDisplayMax).join('\n') + (errors.length > CFG.warningDisplayMax ? `\n+${errors.length - CFG.warningDisplayMax} more errors` : ''), true, 'error');
      return App.flash('No valid data.', true, 'error');
    }

    if (results.length !== State.selected.size) errors.push(`Entry count (${results.length}) ≠ selected count (${State.selected.size}).`);
    State.selected.forEach(n => { if (!seen.has(n)) errors.push(`Line ${n}: Skipped by AI.`); });
    seen.forEach(n => { if (!State.selected.has(n)) errors.push(`Line ${n}: ID not selected.`); });

    const updates = [];
    results.forEach(r => {
      const l = State.byNum.get(r.num);
      if (!l) { errors.push(`Line ${r.num}: ID does not exist.`); return; }
      if (State.ignoreName) r.name = null;
      const hasOn = !!(l.name || '').trim();
      const hasTn = !!(r.name || '').trim();
      const hasMsg = !!(l.message || '').trim();
      if (!State.ignoreName && hasOn && !hasTn) errors.push(`Line ${r.num}: Name removed by AI.`);
      else if (!State.ignoreName && !hasOn && hasTn) errors.push(`Line ${r.num}: Narrative but has a name.`);
      else if (!r.msg && hasMsg) errors.push(`Line ${r.num}: Empty message.`);
      else updates.push({ line: l, item: r });
    });

    if (errors.length) return App.flash('REJECTED:\n' + errors.slice(0, CFG.warningDisplayMax).join('\n') + (errors.length > CFG.warningDisplayMax ? `\n+${errors.length - CFG.warningDisplayMax} more errors` : ''), true, 'error');

    State.undoStack.push(snapshot()); State.redoStack = [];
    updates.forEach(({ line, item }) => {
      line.trans_message = item.msg;
      line.is_translated = true;
      line.trans_name = State.ignoreName ? null : (item.name || line.trans_name || null);
      State.selected.delete(line.line_num);
    });

    if (State.summaryEnabled && summary) State.summary = summary;

    els.pasteArea.value = '';
    State.namesDirty = true;
    State.contentVersion++;
    const changedKeys = updates.map(u => `l:${u.line.line_num}`);
    changedKeys.forEach(k => App.main.invalidateHeight(k));
    App.main.setItems(State.rows, true);
    App.updateFileBadge();
    App.updateButtons();
    App.syncBookmarkUI();
    if (State.namesDirty) { App.renderNames(); State.namesDirty = false; }
    State.updateCount();
    App.updateStatusBar();
    els.btnUndo.disabled = State.undoStack.length === 0;
    els.btnRedo.disabled = State.redoStack.length === 0;
    State.queueSave();
    const nums = updates.map(u => u.line.line_num);
    const incMsg = App.applyIncrement(nums);
    App.flash(`${updates.length} lines successfully applied.${incMsg || ''}`);
    CSTL.plugins.emit('apply', { count: updates.length, lines: nums });
    await CSTL.plugins.runHooks('afterApply', { count: updates.length, lines: nums });
  },

  lastTranslatedNum() {
    let last = 0;
    for (const l of State.lines) if (isTrans(l) && l.line_num > last) last = l.line_num;
    return last;
  },

  nextUntranslatedAfter(num) {
    let next = null;
    for (const l of State.lines) {
      if (!isTrans(l) && l.line_num > num && (next === null || l.line_num < next)) next = l.line_num;
    }
    return next;
  },

  prefillIncrement() {
    const step = Math.max(1, Math.floor(Number(State.incrementStep) || 100));
    const max = State.maxLineNum();
    if (!max) return;
    const from = App.nextUntranslatedAfter(App.lastTranslatedNum());
    if (from === null) {
      els.rangeFromInput.value = '';
      els.rangeToInput.value = '';
      State.selected.clear();
      App.syncCheckboxes();
      return;
    }
    els.rangeFromInput.value = from;
    els.rangeToInput.value = Math.min(from + step - 1, max);
    App.selectRange();
  },

  applyIncrement(applied) {
    if (!State.incrementEnabled || !State.lines.length) return null;
    const step = Math.max(1, Math.floor(Number(State.incrementStep) || 100));
    const max = State.maxLineNum();
    const pf = parseInt(els.rangeFromInput.value, 10);
    const pt = parseInt(els.rangeToInput.value, 10);
    const hasRange = Number.isFinite(pf) && Number.isFinite(pt) && pf >= 1 && pt >= pf;
    let base = 0;
    if (applied.length) base = Math.max(...applied);
    if (hasRange && pt > base) base = pt;
    if (!base) base = App.lastTranslatedNum();
    const from = App.nextUntranslatedAfter(base);
    if (from === null) {
      els.rangeFromInput.value = '';
      els.rangeToInput.value = '';
      State.selected.clear();
      App.syncCheckboxes();
      return ' All lines are covered.';
    }
    els.rangeFromInput.value = from;
    els.rangeToInput.value = Math.min(from + step - 1, max);
    App.selectRange();
    return ` Next range ${from}-${Math.min(from + step - 1, max)} selected.`;
  },

  _swapHistory(dir) {
    const stack = dir === 'undo' ? State.undoStack : State.redoStack;
    if (!stack.length) return;
    const from = stack.pop();
    const oppStack = dir === 'undo' ? State.redoStack : State.undoStack;
    oppStack.push(snapshot());
    State.lines = from.lines.map(normalizeLine);
    State.selected = new Set(from.selected);
    State.namesDirty = true;
    State.contentVersion++;
    App.refresh(true);
    State.queueSave();
  },
  undo() { App._swapHistory('undo'); },
  redo() { App._swapHistory('redo'); },

  openLineEditor(num) {
    const l = State.byNum.get(num);
    if (!l) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount) sel.removeAllRanges();
    App.activeLine = num;
    CSTL.plugins.runHooksSync('lineOpen', num, l);
    els.lineEditorTitle.textContent = `Edit Line ${num}`;
    els.lineOriginalView.value = l.name ? `${l.name}: ${l.message}` : l.message;
    els.lineNameWrap.style.display = l.name ? 'block' : 'none';
    els.lineNameInput.value = l.name ? (l.trans_name || '') : '';
    els.lineNameInput.placeholder = l.name || '';
    els.lineMessageInput.value = (l.trans_message || '').trim();
    els.lineTranslatedCheck.checked = isTrans(l);
    toggleModal(els.lineEditorModal, true);
  },

  saveLineEditor() {
    const l = State.byNum.get(App.activeLine);
    if (!l) return;
    const msg = els.lineMessageInput.value.trim().replace(/\r?\n/g, '\\n');
    const hasMsg = !!(l.message || '').trim();
    if (els.lineTranslatedCheck.checked && !msg && hasMsg) return App.flash('Empty message.', true, 'error');
    const before = { trans_message: l.trans_message, trans_name: l.trans_name, is_translated: l.is_translated };

    State.undoStack.push(snapshot()); State.redoStack = [];
    l.trans_message = msg || null;
    l.is_translated = els.lineTranslatedCheck.checked && (!!msg || !hasMsg);
    if (l.name) l.trans_name = els.lineNameInput.value.trim().replace(/\r?\n/g, '\\n') || null;

    State.namesDirty = true;
    State.contentVersion++;
    toggleModal(els.lineEditorModal, false);
    App.refresh(true, `l:${l.line_num}`);
    if (els.proofreadModal.classList.contains('open')) App.renderProofread();
    State.queueSave();
    CSTL.plugins.runHooksSync('lineSave', l.line_num, l, before);
  },

  highlight(text, re) {
    if (!re) return document.createTextNode(text);
    const frag = document.createDocumentFragment();
    let last = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.substring(last, m.index)));
      const mark = document.createElement('mark');
      mark.className = 'highlight';
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.substring(last)));
    return frag;
  },

  syncProofread() {
    PROOFREAD_FIELDS.forEach(({ id, key, type }) => {
      State[key] = type === 'check' ? els[id].checked : els[id].value;
    });
    if (State.projectId) State.queueSave();
  },

  openProofread() {
    PROOFREAD_FIELDS.forEach(({ id, key, type }) => {
      const el = els[id];
      if (type === 'check') el.checked = State[key]; else el.value = State[key];
    });
    toggleModal(els.proofreadModal, true);
    requestAnimationFrame(() => App.renderProofread());
  },

  renderProofread() {
    if (!els.proofreadModal.classList.contains('open')) return;
    const q = els.proofreadSearchInput.value;
    const regex = els.proofreadRegexCheck.checked;
    const exact = els.proofreadExactCheck.checked;
    const caseSensitive = els.proofreadCaseCheck.checked;
    const translatedOnly = els.proofreadTranslatedOnlyCheck.checked;
    const scope = els.proofreadScope.value;

    App.highlightRe = q ? buildRe(q, regex, exact, caseSensitive) : null;

    const matches = proofreadSearch(State.lines, q, regex, exact, caseSensitive, scope, translatedOnly);
    els.proofreadStatus.textContent = `Found ${matches.length} lines.`;
    const sig = `${q}\u0001${regex}\u0002${exact}\u0003${caseSensitive}\u0004${translatedOnly}\u0005${scope}`;
    const sigChanged = sig !== App.lastProofreadSig;
    const contentChanged = State.contentVersion !== App.lastProofreadContentVer;
    App.lastProofreadSig = sig;
    App.lastProofreadContentVer = State.contentVersion;
    if (sigChanged) {
      App.pr.setItems(matches, false);
    } else {
      if (contentChanged) App.pr.invalidateHeights();
      App.pr.setItems(matches, true);
    }
  },

  createPrRow() {
    const row = document.createElement('div');
    row.className = 'preview-row';
    const wrap = document.createElement('div');
    wrap.className = 'text-content';
    const meta = document.createElement('div');
    meta.className = 'file-meta';
    const orig = document.createElement('div');
    orig.className = 'original';
    const trans = document.createElement('div');
    trans.className = 'translated';
    wrap.append(meta, orig, trans);
    row.append(wrap);
    row._wrap = wrap; row._meta = meta; row._orig = orig; row._trans = trans;
    return row;
  },

  updatePrRow(row, d) {
    row._wrap.dataset.num = d.num;
    row._meta.textContent = `File: ${d.file} | Line: ${d.num}`;
    row._orig.replaceChildren();
    row._trans.replaceChildren();

    const onlyTrans = els.proofreadTranslatedOnlyCheck.checked;
    const scope = els.proofreadScope.value;

    const build = (name, msg, hl) => {
      const frag = document.createDocumentFragment();
      if (name) {
        if (hl && (scope === 'all' || scope === 'name')) frag.appendChild(App.highlight(name, App.highlightRe));
        else frag.appendChild(document.createTextNode(name));
        frag.appendChild(document.createTextNode(': '));
      }
      if (hl && (scope === 'all' || scope === 'message')) frag.appendChild(App.highlight(msg, App.highlightRe));
      else frag.appendChild(document.createTextNode(msg));
      return frag;
    };

    row._trans.classList.toggle('cell-muted', !d.isTrans);

    if (onlyTrans) {
      row._orig.textContent = d.origName ? `${d.origName}: ${d.origMsg}` : d.origMsg;
      if (d.isTrans) row._trans.appendChild(build(d.transName, d.transMsg, true));
      else row._trans.textContent = '——';
    } else {
      row._orig.appendChild(build(d.origName, d.origMsg, true));
      if (d.isTrans) row._trans.textContent = d.transName ? `${d.transName}: ${d.transMsg}` : d.transMsg;
      else row._trans.textContent = '——';
    }
  },

  replaceAll() {
    const q = els.proofreadSearchInput.value;
    const repl = els.proofreadReplaceInput.value;
    if (!q) return App.flash('Empty search!', true, 'error');

    const regex = els.proofreadRegexCheck.checked;
    const exact = els.proofreadExactCheck.checked;
    const caseSensitive = els.proofreadCaseCheck.checked;
    const translatedOnly = els.proofreadTranslatedOnlyCheck.checked;
    const scope = els.proofreadScope.value;

    const result = replaceAll(State.lines, q, repl, regex, exact, caseSensitive, scope, translatedOnly);

    if (!result.count) return App.flash('No matches.', true, 'info');

    State.undoStack.push(snapshot()); State.redoStack = [];
    const modMap = new Map(result.modified.map(m => [m.line_num, m]));
    for (const l of State.lines) {
      const m = modMap.get(l.line_num);
      if (m) {
        if (m.message !== undefined) l.message = m.message;
        if (m.trans_message !== undefined) l.trans_message = m.trans_message;
        if (m.name !== undefined) l.name = m.name;
        if (m.trans_name !== undefined) l.trans_name = m.trans_name;
      }
    }
    State.namesDirty = true;
    State.contentVersion++;
    App.refresh(true);
    App.renderProofread();
    State.queueSave();
    App.flash(`Successfully replaced ${result.count} lines.`, false, 'success');
  },

  _toolbarBtnContainer: null,
  _dashboardCardsEl: null,
  _styleEl: null,
  _themeEl: null,
  _pluginMenuItems: { import: [], export: [] },

  renderPluginMenuItems() {
    const impDropdown = els.importDropdown;
    const expDropdown = els.exportDropdown;
    for (const btn of App._pluginMenuItems.import) { try { btn.remove(); } catch {} }
    for (const btn of App._pluginMenuItems.export) { try { btn.remove(); } catch {} }
    App._pluginMenuItems.import = [];
    App._pluginMenuItems.export = [];
    for (const name of CSTL.plugins.listImporters()) {
      const btn = document.createElement('button');
      btn.className = 'dropdown-item';
      btn.textContent = name;
      btn.addEventListener('click', () => {
        closeDropdowns();
        const importer = CSTL.plugins.getImporter(name);
        if (importer?.handler) {
          Promise.resolve(importer.handler({ api: importer.inst?.api, state: PluginHost.state.snapshot() }))
            .catch(e => App.flash('Import failed: ' + (e?.message || e)));
        }
      });
      if (!impDropdown.querySelector('.dropdown-sep')) {
        const sep = document.createElement('div');
        sep.className = 'dropdown-sep';
        impDropdown.appendChild(sep);
      }
      impDropdown.appendChild(btn);
      App._pluginMenuItems.import.push(btn);
    }
    for (const name of CSTL.plugins.listExporters()) {
      const btn = document.createElement('button');
      btn.className = 'dropdown-item';
      btn.textContent = name;
      btn.addEventListener('click', () => {
        closeDropdowns();
        const exporter = CSTL.plugins.getExporter(name);
        if (exporter?.handler) {
          Promise.resolve(exporter.handler({ api: exporter.inst?.api, state: PluginHost.state.snapshot(), lines: State.lines.map(CSTL.plugins.toPluginLine) }))
            .catch(e => App.flash('Export failed: ' + (e?.message || e)));
        }
      });
      if (!expDropdown.querySelector('.dropdown-sep')) {
        const sep = document.createElement('div');
        sep.className = 'dropdown-sep';
        expDropdown.appendChild(sep);
      }
      expDropdown.appendChild(btn);
      App._pluginMenuItems.export.push(btn);
    }
  },

  _ensureToolbarBtnContainer() {
    if (App._toolbarBtnContainer) return App._toolbarBtnContainer;
    const group = document.querySelector('.toolbar-group');
    if (!group) return null;
    const wrap = document.createElement('div');
    wrap.className = 'toolbar-plugin-btns';
    group.appendChild(wrap);
    App._toolbarBtnContainer = wrap;
    return wrap;
  },

  addToolbarButton(label, onClick, opts = {}) {
    const container = App._ensureToolbarBtnContainer();
    if (!container) return null;
    const btn = document.createElement('button');
    btn.className = 'btn ' + (opts.className || 'btn-ghost');
    btn.type = 'button';
    btn.title = String(opts.title || label || '');
    btn.setAttribute('aria-label', String(opts.title || label || ''));
    btn.textContent = String(label ?? '');
    btn.addEventListener('click', () => {
      try { onClick && onClick(); } catch (e) { App.flash(String(e?.message || e)); }
    });
    container.appendChild(btn);
    return btn;
  },

  removeToolbarButton(btn) {
    if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
  },

  createModal(title, bodyHtml, opts = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'backdrop cstl-plugin-modal';
    const actionsHtml = opts.actions || '';
    overlay.innerHTML = `
      <div class="modal ${opts.wide ? 'modal-wide' : ''} ${opts.xl ? 'modal-xl' : ''}" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>${escapeHtml(String(title ?? ''))}</h3></div>
        <div class="modal-body">${typeof bodyHtml === 'string' ? bodyHtml : ''}</div>
        ${actionsHtml ? `<div class="modal-actions">${actionsHtml}</div>` : '<div class="modal-actions"><span class="grow"></span><button type="button" class="btn btn-ghost cstl-plugin-modal-close">Close</button></div>'}
      </div>`;
    if (typeof bodyHtml === 'object' && bodyHtml && bodyHtml.nodeType) {
      overlay.querySelector('.modal-body').replaceChildren(bodyHtml);
    }
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    overlay.querySelector('.cstl-plugin-modal-close')?.addEventListener('click', () => App.closeModal(overlay));
    overlay.addEventListener('click', e => { if (e.target === overlay) App.closeModal(overlay); });
    return overlay;
  },

  closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('open');
    setTimeout(() => { try { modal.remove(); } catch {} }, 420);
  },

  _ensureDashboardCardsEl() {
    if (App._dashboardCardsEl) return App._dashboardCardsEl;
    const content = els.projectList.parentElement;
    if (!content) return null;
    const wrap = document.createElement('div');
    wrap.className = 'plugin-dashboard-cards';
    content.insertBefore(wrap, content.firstChild);
    App._dashboardCardsEl = wrap;
    return wrap;
  },

  addDashboardCard(cardEl) {
    const container = App._ensureDashboardCardsEl();
    if (!container || !cardEl) return null;
    container.appendChild(cardEl);
    return cardEl;
  },

  removeDashboardCard(cardEl) {
    if (cardEl && cardEl.parentNode) cardEl.parentNode.removeChild(cardEl);
  },

  setTheme(vars) {
    if (!isPlainObject(vars)) return;
    if (!App._themeEl) {
      App._themeEl = document.createElement('style');
      App._themeEl.id = 'cstl-plugin-theme';
      document.head.appendChild(App._themeEl);
    }
    const decls = [];
    for (const [k, v] of Object.entries(vars)) {
      decls.push(`  ${k.startsWith('--') ? k : '--' + k}: ${v};`);
    }
    App._themeEl.textContent = `:root {\n${decls.join('\n')}\n}`;
  },

  injectStyle(css, id) {
    const existing = id ? document.getElementById('cstl-plugin-style-' + id) : null;
    if (existing) { existing.textContent = css; return existing; }
    const el = document.createElement('style');
    if (id) el.id = 'cstl-plugin-style-' + id;
    el.textContent = css;
    document.head.appendChild(el);
    return el;
  },

  dialogPrompt(title, def) {
    const opts = (typeof title === 'string')
      ? { title, value: def ?? '' }
      : title;
    return CSTL.dialogs.prompt(opts);
  },

  async dialogConfirm(title, body) {
    return CSTL.dialogs.confirm({
      title,
      bodyHtml: body ? `<p class="m-0">${escapeHtml(body).replace(/\n/g, '<br>')}</p>` : '',
      confirmLabel: 'OK',
      cancelLabel: 'Cancel'
    });
  },

  async dialogAlert(title, body) {
    const msg = body ? `${title}\n\n${body}` : title;
    App.flash(msg, true, 'info');
  },

  updateLineExternal(num, changes) {
    const l = State.byNum.get(num);
    if (!l || !isPlainObject(changes)) return false;
    State.undoStack.push(snapshot()); State.redoStack = [];
    if ('message' in changes) l.message = String(changes.message ?? '');
    if ('name' in changes) l.name = changes.name == null ? null : stripNewlines(changes.name);
    if ('trans_message' in changes) l.trans_message = changes.trans_message == null ? null : String(changes.trans_message);
    if ('trans_name' in changes) l.trans_name = changes.trans_name == null ? null : stripNewlines(changes.trans_name);
    if ('is_translated' in changes) l.is_translated = !!changes.is_translated;
    State.namesDirty = true;
    State.contentVersion++;
    App.refresh(true);
    State.queueSave();
    return true;
  },

  addLineExternal(line) {
    if (!isPlainObject(line) || !line.message) return null;
    const num = State.nextLineNum();
    const newLine = {
      line_num: num,
      file: String(line.file || State.files[0] || 'plugin'),
      name: line.name == null ? null : stripNewlines(line.name),
      message: String(line.message).replace(/\r?\n/g, '\\n').trim(),
      trans_name: null,
      trans_message: null,
      is_translated: false,
      _n: 1
    };
    State.undoStack.push(snapshot()); State.redoStack = [];
    State.lines.push(newLine);
    if (!State.files.includes(newLine.file)) State.files.push(newLine.file);
    State.namesDirty = true;
    State.contentVersion++;
    App.refresh(true);
    State.queueSave();
    return num;
  },

  removeLineExternal(num) {
    const l = State.byNum.get(num);
    if (!l) return false;
    State.undoStack.push(snapshot()); State.redoStack = [];
    State.lines = State.lines.filter(x => x.line_num !== num);
    State.selected.delete(num);
    State.bookmarks = State.bookmarks.filter(b => b !== num);
    State.bookmarkSet.delete(num);
    State.namesDirty = true;
    State.contentVersion++;
    App.refresh(true);
    State.queueSave();
    return true;
  },

  markTranslatedExternal(num, transMsg, transName) {
    const l = State.byNum.get(num);
    if (!l) return false;
    State.undoStack.push(snapshot()); State.redoStack = [];
    l.trans_message = String(transMsg ?? '').replace(/\r?\n/g, '\\n').trim() || null;
    l.is_translated = true;
    if (transName != null) l.trans_name = stripNewlines(transName);
    State.namesDirty = true;
    State.contentVersion++;
    App.refresh(true);
    State.queueSave();
    return true;
  }
};

const PluginHost = {
  storage: {
    readPluginIndex: () => Storage.readPluginIndex(),
    writePluginIndex: items => Storage.writePluginIndex(items),
    readGlobalPluginSettings: () => Storage.readGlobalPluginSettings(),
    writeGlobalPluginSettings: value => Storage.writeGlobalPluginSettings(value),
    installPluginFiles: (pluginId, manifestJson, pluginCode, assetFiles) => Storage.installPluginFiles(pluginId, manifestJson, pluginCode, assetFiles),
    readPluginCode: pluginId => Storage.readPluginCode(pluginId),
    readPluginAssetBytes: (pluginId, path) => Storage.readPluginAssetBytes(pluginId, path),
    readPluginAssetText: (pluginId, path) => Storage.readPluginAssetText(pluginId, path),
    pluginInstalled: pluginId => Storage.pluginInstalled(pluginId),
    deletePlugin: pluginId => Storage.deletePlugin(pluginId),
    listInstalledPluginIds: () => Storage.listInstalledPluginIds(),
    savePluginData: (pluginId, key, data) => Storage.savePluginData(State.projectId, pluginId, key, data),
    loadPluginData: (pluginId, key) => Storage.loadPluginData(State.projectId, pluginId, key),
    deletePluginData: (pluginId, key) => Storage.deletePluginData(State.projectId, pluginId, key),
    listPluginData: pluginId => Storage.listPluginData(State.projectId, pluginId),
    pluginDataExists: (pluginId, key) => Storage.pluginDataExists(State.projectId, pluginId, key),
    listProjects: () => Storage.listProjects(),
    loadProject: id => Storage.loadProject(id),
    saveProject: (id, data) => Storage.saveProject(id, data),
    root: () => Storage.root()
  },

  state: {
    projectId: () => State.projectId,
    projectName: () => State.projectName,
    pluginSettings: () => State.pluginSettings,
    setPluginSettings: v => { State.pluginSettings = v; },
    queueSave: () => State.queueSave(),
    projectInfo: () => State.projectId ? {
      name: State.projectName,
      type: State.projectType,
      fileCount: State.files.length,
      lineCount: State.lines.length,
      translatedCount: State.translatedCount
    } : null,
    lines: () => State.lines,
    selection: () => Array.from(State.selected),
    clearSelection: () => { State.selected.clear(); App.syncCheckboxes(); },
    selectRangeUI: (from, to) => { els.rangeFromInput.value = from; els.rangeToInput.value = to; App.selectRange(); },
    copyForAi: () => App.copyForAi(),
    snapshot: () => ({
      projectId: State.projectId,
      projectName: State.projectName,
      projectType: State.projectType,
      pluginId: State.pluginId,
      files: State.files.slice(),
      lineCount: State.lines.length,
      translatedCount: State.translatedCount,
      selected: Array.from(State.selected),
      bookmarks: State.bookmarks.slice()
    }),
    lineByNum: num => State.byNum.get(num) || null,
    updateLine: (num, changes) => App.updateLineExternal(num, changes),
    addLine: line => App.addLineExternal(line),
    removeLine: num => App.removeLineExternal(num),
    markTranslated: (num, transMsg, transName) => App.markTranslatedExternal(num, transMsg, transName)
  },

  ui: {
    flash: msg => App.flash(msg),
    onPluginsChanged: () => { App.syncImportAccept(); App.renderPluginMenuItems(); },
    onShortcutListMaybeRender: () => {
      if (els.shortcutModal.classList.contains('open')) App.renderShortcutList();
    },
    rebuildShortcuts: () => Shortcuts.rebuild(),
    loadDashboard: () => App.loadDashboard(),
    addMenuItem: (menu, label, onClick) => App.addPluginMenuItem(menu, label, onClick),
    removeMenuItem: btn => App.removePluginMenuItem(btn),
    addSettingsSection: (target, title, hooks) => App.addPluginSettingsSection(target, title, hooks),
    removeSettingsSection: entry => App.removePluginSettingsSection(entry),
    getRegion: name => App.pluginRegion(name),
    addToolbarButton: (label, onClick, opts) => App.addToolbarButton(label, onClick, opts),
    removeToolbarButton: btn => App.removeToolbarButton(btn),
    createModal: (title, bodyHtml, opts) => App.createModal(title, bodyHtml, opts),
    closeModal: modal => App.closeModal(modal),
    addDashboardCard: cardEl => App.addDashboardCard(cardEl),
    removeDashboardCard: cardEl => App.removeDashboardCard(cardEl),
    setTheme: vars => App.setTheme(vars),
    injectStyle: (css, id) => App.injectStyle(css, id),
    prompt: (title, def) => App.dialogPrompt(title, def),
    confirm: (title, body) => App.dialogConfirm(title, body),
    alert: (title, body) => App.dialogAlert(title, body)
  },

  util: {
    clipboard,
    progress: Progress
  }
};

document.addEventListener('DOMContentLoaded', App.init);

})();
