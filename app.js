(() => {
'use strict';

const VERSION = 1;
const INDEX_FILE = '_index.json';
const DEFAULT_PROMPT = `Translate entire text to Native English. Euphemism prohibited. Onomatopoeia must be English-based. Result must be inside codeblock. Keep line numbering and format (like code in the middle of the text) intact.`;
const DEFAULT_RINGKASAN_PROMPT = `Outside the <translate> and </translate> tags (placed above or below the translated lines), include updated summary of the characters and overall story so far. Any characters and story need to be preserved even though they don't appear again for context.`;
const FIXED_FORMAT_PROMPT = `Format:\n<translate>\ntext\n</translate>`;
const MODAL_CLOSE_MS = 180;
const TOAST_TIMEOUT_MS = 3000;
const SAVED_TIMEOUT_MS = 1800;
const DASHBOARD_PAGE_SIZE = 30;
const SCROLLER_OVERSCAN = 6;
const DECODERS = ['utf-8', 'shift_jis', 'windows-31j', 'cp932'];

const SETTINGS_FIELDS = [
  { id: 'settingsIgnoreNameCheck',    key: 'ignoreName',    type: 'check', def: false },
  { id: 'settingsPromptCheck',        key: 'promptEnabled', type: 'check', def: true  },
  { id: 'settingsJumpToContextCheck', key: 'jumpToContext', type: 'check', def: false },
  { id: 'settingsHideToolsCheck',     key: 'hideTools',     type: 'check', def: false },
  { id: 'settingsPromptInput',        key: 'prompt',        type: 'value', def: DEFAULT_PROMPT },
  { id: 'settingsEpubTagsInput',      key: 'epubTags',      type: 'value', def: 'p' }
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
  { key: 'epubTags',           def: 'p',                    coerce: true },
  { key: 'epubSourceId',       def: null,                   coerce: true },
  { key: 'prompt',             def: DEFAULT_PROMPT,         coerce: true, store: 'prompt_header' },
  { key: 'ignoreName',         def: false,                  store: 'ignoreNameTranslation' },
  { key: 'promptEnabled',      def: true },
  { key: 'ringkasanEnabled',   def: false },
  { key: 'ringkasanPrompt',    def: DEFAULT_RINGKASAN_PROMPT, coerce: true },
  { key: 'ringkasan',          def: '' },
  { key: 'vndbEnabled',        def: false },
  { key: 'vndbId',             def: '' },
  { key: 'vndbGlossary',       def: [],                     coerce: true },
  { key: 'customEnabled',      def: false },
  { key: 'customRaw',          def: '' },
  { key: 'jumpToContext',      def: false },
  { key: 'hideTools',          def: false },
  { key: 'prScope',            def: 'all',                  coerce: true, store: 'proofreadScope' },
  { key: 'prRegex',            def: false,                  store: 'proofreadRegex' },
  { key: 'prCase',             def: false,                  store: 'proofreadCaseSensitive' },
  { key: 'prExact',            def: false,                  store: 'proofreadExactMatch' },
  { key: 'prTranslatedOnly',   def: false,                  store: 'proofreadTranslatedOnly' }
];

const DROPDOWNS = [
  { trigger: 'btnImportMain',   panel: 'importDropdown',    group: 'importGroup'    },
  { trigger: 'btnCopyAllNames', panel: 'copyNamesDropdown', group: 'copyNamesGroup' }
];

const $ = id => document.getElementById(id);
const escapeHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const baseName = p => String(p || '').replace(/\\/g, '/').split('/').pop();
const isTrans = l => !!l.is_translated;
const makeProjId = () => 'proj_' + Date.now() + '.cstl';
const makeEpubId = () => 'epub_' + Date.now() + '.epub';
const clone = obj => (typeof structuredClone === 'function') ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
const snapshot = () => ({ lines: clone(State.lines), selected: new Set(State.selected) });
const jsZipReady = () => typeof JSZip !== 'undefined';
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

function decodeBuffer(buf) {
  for (const enc of DECODERS) {
    try { return new TextDecoder(enc, { fatal: true }).decode(buf); } catch {}
  }
  return new TextDecoder('utf-8').decode(buf);
}

function stripNewlines(v) {
  return v == null ? null : String(v).replace(/\r?\n/g, '\\n').trim();
}

function sanitizeName(s) {
  const name = String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().replace(/[.\s]+$/, '');
  return name || 'untitled';
}

function isJapanese(s) {
  return /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(s);
}

function download(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
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

function debounce(fn, ms = 200) {
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
    if (els.copyStatus) els.copyStatus.classList.add('empty');
    const msg = failMsg ? failMsg(err) : err.message;
    setTimeout(() => alert(msg), 10);
    return undefined;
  }
  return result;
}

const Storage = {
  root() { return navigator.storage.getDirectory(); },
  async readIndex() {
    try {
      const root = await Storage.root();
      const f = await (await root.getFileHandle(INDEX_FILE)).getFile();
      return JSON.parse(await f.text());
    } catch { return null; }
  },
  async writeIndex(items) {
    const root = await Storage.root();
    const w = await (await root.getFileHandle(INDEX_FILE, { create: true })).createWritable();
    await w.write(JSON.stringify(items));
    await w.close();
  },
  async upsertIndex(meta) {
    const items = (await Storage.readIndex()) || [];
    const i = items.findIndex(p => p.id === meta.id);
    if (i >= 0) items[i] = meta; else items.push(meta);
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    await Storage.writeIndex(items);
  },
  async removeIndex(id) {
    const items = (await Storage.readIndex()) || [];
    await Storage.writeIndex(items.filter(p => p.id !== id));
  },
  async saveProject(id, data, counts) {
    data.updatedAt = Date.now();
    const root = await Storage.root();
    const w = await (await root.getFileHandle(id, { create: true })).createWritable();
    await w.write(JSON.stringify(data));
    await w.close();
    const tc = counts?.translatedCount ?? data.lines?.reduce((n, l) => n + (l.is_translated ? 1 : 0), 0) ?? 0;
    await Storage.upsertIndex({
      id,
      name: data.projectName,
      projectType: data.projectType || 'uninitialized',
      updatedAt: data.updatedAt,
      fileCount: counts?.fileCount ?? data.imported_files?.length ?? 0,
      lineCount: counts?.lineCount ?? data.lines?.length ?? 0,
      translatedCount: tc
    });
  },
  async load(id) {
    const root = await Storage.root();
    const f = await (await root.getFileHandle(id)).getFile();
    return JSON.parse(await f.text());
  },
  async remove(id, epubId) {
    const root = await Storage.root();
    if (epubId) { try { await root.removeEntry(epubId); } catch {} }
    await root.removeEntry(id);
    await Storage.removeIndex(id);
  },
  async list() {
    let items = await Storage.readIndex();
    if (!items) items = await Storage.rebuildIndex();
    return items.slice().sort((a, b) => b.updatedAt - a.updatedAt);
  },
  async rebuildIndex() {
    const root = await Storage.root();
    const items = [];
    for await (const [name, h] of root.entries()) {
      if (!name.endsWith('.cstl') || h.kind !== 'file') continue;
      try {
        const f = await h.getFile();
        const data = JSON.parse(await f.text());
        items.push({
          id: name,
          name: data.projectName || name.replace('.cstl', ''),
          projectType: data.projectType || 'uninitialized',
          updatedAt: data.updatedAt || f.lastModified,
          fileCount: data.imported_files?.length || 0,
          lineCount: data.lines?.length || 0,
          translatedCount: data.lines?.reduce((n, l) => n + (l.is_translated ? 1 : 0), 0) || 0
        });
      } catch {}
    }
    await Storage.writeIndex(items);
    return items;
  },
  async loadEpubBuffer(epubId) {
    const root = await Storage.root();
    const f = await (await root.getFileHandle(epubId)).getFile();
    return await f.arrayBuffer();
  },
  async saveEpub(epubId, buffer) {
    const root = await Storage.root();
    const w = await (await root.getFileHandle(epubId, { create: true })).createWritable();
    await w.write(buffer);
    await w.close();
  },
  async wipe() {
    const root = await navigator.storage.getDirectory();
    for await (const [name] of root.entries()) {
      try { await root.removeEntry(name, { recursive: true }); } catch {}
    }
  }
};

const Html = {
  containerRoot(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const rootFile = doc.querySelector('rootfile');
    if (!rootFile) throw new Error('EPUB tidak valid.');
    return decodeURIComponent(rootFile.getAttribute('full-path'));
  },
  opfManifest(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const manifest = {};
    doc.querySelectorAll('manifest > item').forEach(it => {
      manifest[it.getAttribute('id')] = decodeURIComponent(it.getAttribute('href'));
    });
    const spine = Array.from(doc.querySelectorAll('spine > itemref')).map(it => it.getAttribute('idref'));
    return { manifest, spine };
  },
  extractTags(html, isXhtml, tags) {
    const doc = new DOMParser().parseFromString(html, isXhtml ? 'application/xhtml+xml' : 'text/html');
    const out = [];
    doc.querySelectorAll(tags).forEach(el => {
      const txt = el.textContent.replace(/\r?\n/g, ' ').trim();
      if (txt) out.push(txt);
    });
    return out;
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

function parseJsonArray(arr, file, start) {
  if (!Array.isArray(arr)) throw new Error(`File ${file} bukan array JSON.`);
  const out = [];
  let n = start;
  for (const e of arr) {
    if (!e || typeof e !== 'object' || !Object.hasOwn(e, 'message')) continue;
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
  return out;
}

async function parseFilesList(files, existing, start, onProgress, label = 'file') {
  existing = new Set(existing || []);
  const imported = [];
  const skipped = [];
  let cur = start;
  const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    const bn = baseName(f.name);
    if (existing.has(bn)) { skipped.push(bn); continue; }
    const arr = JSON.parse(decodeBuffer(f.buffer));
    const parsed = parseJsonArray(arr, bn, cur);
    if (parsed.length) { existing.add(bn); imported.push(...parsed); cur += parsed.length; }
    onProgress(`${i + 1} / ${sorted.length} ${label}`, ((i + 1) / sorted.length) * 100);
    if (i % 50 === 0) await yieldToEvent();
  }
  return { imported, skipped, nextStart: cur, existing: Array.from(existing) };
}

async function parseZipJson(buffer, existing, start, onProgress) {
  if (!jsZipReady()) throw new Error('JSZip tidak tersedia.');
  const zip = new JSZip();
  await zip.loadAsync(buffer);
  const files = [];
  for (const name of Object.keys(zip.files).filter(n => n.endsWith('.json'))) {
    files.push({ name, buffer: await zip.file(name).async('uint8array') });
  }
  return parseFilesList(files, existing, start, onProgress);
}

async function parseEpub(buffer, tags, existing, start, epubId, onProgress) {
  if (!jsZipReady()) throw new Error('JSZip tidak tersedia.');
  existing = new Set(existing || []);
  await Storage.saveEpub(epubId, buffer);
  const zip = new JSZip();
  await zip.loadAsync(buffer);
  const containerXml = await zip.file('META-INF/container.xml').async('text');
  const opfPath = Html.containerRoot(containerXml);
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) + '/' : '';
  const opfXml = await zip.file(opfPath).async('text');
  const { manifest, spine } = Html.opfManifest(opfXml);
  const htmls = spine.map(idref => manifest[idref] ? opfDir + manifest[idref] : null).filter(Boolean);

  const imported = [];
  const skipped = [];
  let cur = start;
  for (let i = 0; i < htmls.length; i++) {
    const path = htmls[i];
    if (existing.has(path)) { skipped.push(path); continue; }
    const entry = zip.file(path);
    if (!entry) continue;
    const html = await entry.async('text');
    const texts = Html.extractTags(html, path.endsWith('.xhtml'), tags);
    let has = false;
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
      has = true;
    }
    if (has) existing.add(path);
    onProgress(`${i + 1} / ${htmls.length} file`, ((i + 1) / htmls.length) * 100);
    if (i % 20 === 0) await yieldToEvent();
  }
  return { imported, skipped, nextStart: cur, existing: Array.from(existing) };
}

async function buildExportJson(lines, projectName, onProgress) {
  if (!jsZipReady()) throw new Error('JSZip tidak tersedia.');
  const grouped = new Map();
  for (const l of lines) {
    let arr = grouped.get(l.file);
    if (!arr) { arr = []; grouped.set(l.file, arr); }
    arr.push(l);
  }
  const entries = Array.from(grouped.entries());
  const results = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const [file, fileLines] = entries[i];
    const out = new Array(fileLines.length);
    for (let j = 0; j < fileLines.length; j++) {
      const l = fileLines[j];
      const isT = !!l.is_translated;
      const obj = {};
      const n = isT ? (l.trans_name || l.name) : l.name;
      const msg = isT ? l.trans_message : l.message;
      if (n != null) obj.name = n.replace(/\\n/g, '\n');
      obj.message = msg != null ? msg.replace(/\\n/g, '\n') : '';
      out[j] = obj;
    }
    results[i] = {
      name: `${file.replace(/\.(xhtml|html|json)$/g, '')}.json`,
      content: JSON.stringify(out, null, 2)
    };
    onProgress(`${i + 1} / ${entries.length} file`, ((i + 1) / entries.length) * 100);
    if (i % 50 === 0) await yieldToEvent();
  }
  if (results.length > 1) {
    onProgress('Mengompres ZIP...', 100);
    const zip = new JSZip();
    for (const r of results) zip.file(r.name, r.content);
    const blob = await zip.generateAsync({
      type: 'blob', mimeType: 'application/octet-stream',
      compression: 'DEFLATE', compressionOptions: { level: 9 }
    });
    return { blob, name: `${sanitizeName(projectName)}_export.zip`, multiple: true };
  }
  const r = results[0];
  const blob = new Blob([r.content], { type: 'application/json' });
  return { blob, name: r.name, multiple: false };
}

async function buildExportEpub(epubId, lines, tags, projectName, onProgress) {
  if (!jsZipReady()) throw new Error('JSZip tidak tersedia.');
  let buffer = epubId ? await Storage.loadEpubBuffer(epubId) : null;
  if (!buffer) throw new Error('EPUB tidak ditemukan.');
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
  onProgress('Mengompres EPUB...', 100);
  const blob = await zip.generateAsync({
    type: 'blob', mimeType: 'application/epub+zip',
    compression: 'DEFLATE', compressionOptions: { level: 9 }
  });
  return { blob, name: `${sanitizeName(projectName)}_tl.epub` };
}

function buildProjectZipInner(zip, data) {
  const meta = { ...data };
  delete meta.lines;
  delete meta.proofreadScope;
  delete meta.proofreadRegex;
  delete meta.proofreadCaseSensitive;
  delete meta.proofreadExactMatch;
  delete meta.proofreadTranslatedOnly;
  zip.file('metadata.json', JSON.stringify(meta));

  const fileLines = new Map();
  for (const l of (data.lines || [])) {
    let arr = fileLines.get(l.file);
    if (!arr) { arr = []; fileLines.set(l.file, arr); }
    arr.push(l);
  }
  const origParts = [];
  const transParts = [];
  const namesParts = [];
  for (const file of (data.imported_files || [])) {
    origParts.push(`<filename>${file}</filename>\n`);
    transParts.push(`<filename>${file}</filename>\n`);
    namesParts.push(`<filename>${file}</filename>\n`);
    const fl = fileLines.get(file) || [];
    for (const l of fl) {
      origParts.push(l.message || '', '\n');
      transParts.push(l.trans_message || '', '\n');
      const hasName = (l.name || '') || (l.trans_name || '');
      if (hasName) namesParts.push(`<original>${l.name || ''}</original><translate>${l.trans_name || ''}</translate>\n`);
      else namesParts.push('\n');
    }
  }
  zip.file('original.txt', origParts.join(''));
  zip.file('translate.txt', transParts.join(''));
  zip.file('name.txt', namesParts.join(''));
}

async function compressZip(zip, mimeType, level = 9) {
  return await zip.generateAsync({
    type: 'blob', mimeType,
    compression: 'DEFLATE', compressionOptions: { level }
  });
}

async function buildBackup(id, name, onProgress) {
  if (!jsZipReady()) throw new Error('JSZip tidak tersedia.');
  const data = await Storage.load(id);
  let epubBuffer = null;
  if (data.projectType === 'epub' && data.epubSourceId) {
    try { epubBuffer = await Storage.loadEpubBuffer(data.epubSourceId); } catch {}
  }
  const zip = new JSZip();
  buildProjectZipInner(zip, data);
  if (epubBuffer) zip.file(data.epubSourceId, epubBuffer);
  onProgress('Mengompres backup...', 90);
  const blob = await compressZip(zip, 'application/octet-stream');
  return { blob, name: `${sanitizeName(name)}_backup.cstl` };
}

async function backupAll(onProgress) {
  if (!jsZipReady()) throw new Error('JSZip tidak tersedia.');
  const items = await Storage.list();
  if (!items.length) throw new Error('Belum ada Project untuk di-backup.');
  const total = items.length;
  const outer = new JSZip();
  const used = new Set();
  onProgress(`0 / ${total} project`, 0);
  for (let i = 0; i < total; i++) {
    onProgress(`Memproses ${i + 1} / ${total} project`, (i / total) * 95);
    const data = await Storage.load(items[i].id);
    const zip = new JSZip();
    buildProjectZipInner(zip, data);
    if (data.projectType === 'epub' && data.epubSourceId) {
      try { zip.file(data.epubSourceId, await Storage.loadEpubBuffer(data.epubSourceId)); } catch {}
    }
    const blob = await compressZip(zip, '', 9);
    const base = sanitizeName(data.projectName);
    let name = base, k = 2;
    while (used.has(name)) name = `${base}_${k++}`;
    used.add(name);
    outer.file(`${name}_backup.cstl`, blob);
    onProgress(`${i + 1} / ${total} project selesai`, ((i + 1) / total) * 95);
    await yieldToEvent();
  }
  onProgress('Mengompres arsip utama...', 98);
  const blob = await compressZip(outer, 'application/octet-stream');
  return { blob, name: `ProjectBackupAll_${new Date().toISOString().slice(0, 10)}.cstl` };
}

async function restoreOne(zip, fallbackName, onProgress) {
  const metaFile = zip.file('metadata.json');
  const origFile = zip.file('original.txt');
  const transFile = zip.file('translate.txt');
  const nameFile = zip.file('name.txt');
  if (!metaFile || !origFile || !transFile || !nameFile) throw new Error('Format arsip tidak valid.');

  const meta = JSON.parse(await metaFile.async('text'));
  const orig = (await origFile.async('text')).split(/\r?\n/);
  const trans = (await transFile.async('text')).split(/\r?\n/);
  const names = (await nameFile.async('text')).split(/\r?\n/);
  if (orig.length && orig[orig.length - 1] === '') orig.pop();
  if (trans.length && trans[trans.length - 1] === '') trans.pop();
  if (names.length && names[names.length - 1] === '') names.pop();
  if (orig.length !== trans.length || orig.length !== names.length) throw new Error('Baris tidak sinkron.');

  const total = orig.length;
  const lines = new Array(total);
  let file = 'unknown', n = 1;
  for (let i = 0; i < total; i++) {
    const o = orig[i];
    const m = o.match(/^<filename>(.*?)<\/filename>$/);
    if (m) {
      if (trans[i] !== o || names[i] !== o) throw new Error('Header file tidak sinkron.');
      file = m[1];
      lines[i] = null;
    } else {
      let on = null, tn = null;
      const nl = names[i].trim();
      if (nl) {
        const om = nl.match(/<original>(.*?)<\/original>/);
        const tm = nl.match(/<translate>(.*?)<\/translate>/);
        on = om ? om[1] : null;
        tn = tm ? tm[1] : null;
      }
      lines[i] = normalizeLine({
        line_num: n++, file,
        name: on, message: o,
        trans_name: tn,
        trans_message: trans[i] || null,
        is_translated: !!trans[i]?.trim()
      });
    }
    if (onProgress && (i % 5000 === 0)) { onProgress(i, total); await yieldToEvent(); }
  }
  const finalLines = lines.filter(x => x !== null);

  const name = meta.projectName || fallbackName;
  if (meta.projectType === 'epub' && meta.epubSourceId) {
    const entry = zip.file(meta.epubSourceId);
    if (entry) {
      const newId = 'epub_' + Date.now() + '.epub';
      await Storage.saveEpub(newId, await entry.async('arraybuffer'));
      meta.epubSourceId = newId;
    }
  }

  const id = makeProjId();
  await Storage.saveProject(id, {
    version: VERSION,
    projectName: name,
    projectType: meta.projectType || 'uninitialized',
    epubTags: meta.epubTags || 'p',
    epubSourceId: meta.epubSourceId || null,
    imported_files: meta.imported_files || [],
    lines: finalLines,
    prompt_header: meta.prompt_header || DEFAULT_PROMPT,
    ignoreNameTranslation: meta.ignoreNameTranslation ?? false,
    promptEnabled: meta.promptEnabled ?? true,
    ringkasanEnabled: meta.ringkasanEnabled ?? false,
    ringkasanPrompt: meta.ringkasanPrompt || DEFAULT_RINGKASAN_PROMPT,
    ringkasan: meta.ringkasan || '',
    vndbEnabled: meta.vndbEnabled ?? false,
    vndbId: meta.vndbId || '',
    vndbGlossary: meta.vndbGlossary || [],
    customEnabled: meta.customEnabled ?? false,
    customRaw: meta.customRaw || '',
    jumpToContext: meta.jumpToContext ?? false,
    hideTools: meta.hideTools ?? false
  });
  return name;
}

async function parseRestore(buffer, fallbackName, onProgress) {
  if (!jsZipReady()) throw new Error('JSZip tidak tersedia.');
  const zip = new JSZip();
  await zip.loadAsync(buffer);

  if (zip.file('metadata.json')) {
    onProgress('Membaca baris...', 0);
    const name = await restoreOne(zip, fallbackName, (done, total) => {
      onProgress(`${done} / ${total} baris`, total ? (done / total) * 100 : 0);
    });
    onProgress('Menyimpan project...', 100);
    return { single: true, name };
  }

  const entries = Object.values(zip.files).filter(f => !f.dir && f.name.toLowerCase().endsWith('.cstl'));
  if (!entries.length) throw new Error('Format arsip tidak valid.');

  const totalEntries = entries.length;
  let ok = 0, fail = 0;
  for (let i = 0; i < totalEntries; i++) {
    const entry = entries[i];
    try {
      const inner = new JSZip();
      await inner.loadAsync(await entry.async('blob'));
      await restoreOne(inner, entry.name.replace(/\.cstl$/i, ''));
      ok++;
    } catch { fail++; }
    onProgress(`${i + 1} / ${totalEntries} project`, ((i + 1) / totalEntries) * 100);
    await yieldToEvent();
  }
  return { single: false, ok, fail };
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

const els = {};

function cacheEls() {
  const ids = [
    'dashboardView', 'workspaceView', 'projectList',
    'btnNewProject', 'btnRestoreProject', 'btnDashboardSettings', 'btnDashboardSettingsClose',
    'btnBackupAll', 'btnWipeAllData',
    'btnBackToDashboard', 'projectNameDisplay', 'dynamicToolbarWrap',
    'workspaceToolbar', 'btnToggleHeader', 'btnShowHeader',
    'btnImportMain', 'importDropdown', 'importGroup',
    'btnImportFile', 'btnImportFolder', 'btnImportZip',
    'importFileInput', 'importFolderInput', 'importZipInput', 'restoreProjectInput',
    'btnExport', 'btnProofread', 'btnGlossary', 'btnContext', 'btnSettings',
    'previewViewport', 'previewContainer', 'stickyFileBar', 'stickyFileName', 'stickyFileRange', 'stickyFileCheckbox',
    'progressText',
    'rangeFromInput', 'rangeToInput', 'btnSelectRange', 'btnClearSelection', 'btnSelectAll', 'btnCopyForAi',
    'copyStatus', 'pasteArea', 'btnUndo', 'btnApply', 'btnRedo',
    'nameTotalCount', 'nameTableBody',
    'btnCopyAllNames', 'copyNamesDropdown', 'copyNamesGroup',
    'btnCopyNamesPlain', 'btnCopyNamesWithGlossary', 'btnCopyNamesMissingGlossary',
    'settingsModal', 'btnSettingsDasarReset', 'settingsIgnoreNameCheck', 'settingsPromptCheck',
    'settingsJumpToContextCheck', 'settingsHideToolsCheck',
    'btnSettingsPromptReset', 'settingsPromptInput', 'btnSettingsEpubReset', 'settingsEpubTagsInput',
    'btnSettingsCancel', 'btnSettingsSave',
    'glossaryModal', 'btnGlossaryVndbReset', 'glossaryVndbCheck', 'glossaryVndbWrap',
    'glossaryVndbIdInput', 'btnGlossaryVndbFetch', 'glossaryVndbStatus', 'glossaryVndbPreviewArea',
    'btnGlossaryCustomReset', 'glossaryCustomCheck', 'glossaryCustomWrap', 'glossaryCustomInput',
    'btnGlossaryCancel', 'btnGlossarySave',
    'contextModal', 'btnRingkasanReset', 'ringkasanEnabledCheck', 'ringkasanWrap',
    'ringkasanPromptInput', 'ringkasanStoredInput', 'btnRingkasanPromptReset', 'btnRingkasanStoredReset', 'btnContextCancel', 'btnContextSave',
    'lineEditorModal', 'lineEditorTitle', 'lineOriginalView', 'lineNameWrap',
    'lineNameInput', 'lineMessageInput', 'lineTranslatedCheck', 'btnLineCancel', 'btnLineSave',
    'proofreadModal', 'proofreadSearchInput', 'proofreadScope', 'proofreadRegexCheck',
    'proofreadCaseCheck', 'proofreadExactCheck', 'proofreadTranslatedOnlyCheck',
    'btnProofreadReset', 'proofreadReplaceInput', 'btnProofreadReplaceAll',
    'proofreadStatus', 'proofreadContainer', 'btnProofreadClose',
    'dashboardSettingsModal',
    'busyOverlay', 'busyTitle', 'busyMsg', 'busyBarFill'
  ];
  for (const id of ids) els[id] = $(id);
}

const Progress = {
  show(title, msg = '') {
    els.busyTitle.textContent = title;
    els.busyMsg.textContent = msg;
    els.busyBarFill.classList.remove('determinate');
    els.busyBarFill.style.width = '';
    els.busyOverlay.classList.add('open');
  },
  determinate(title, msg = '') {
    els.busyTitle.textContent = title;
    els.busyMsg.textContent = msg;
    els.busyBarFill.classList.add('determinate');
    els.busyBarFill.style.width = '0%';
    els.busyOverlay.classList.add('open');
  },
  update(msg, pct) {
    if (msg !== undefined && typeof msg === 'string') els.busyMsg.textContent = msg;
    if (pct !== undefined && els.busyBarFill.classList.contains('determinate')) {
      els.busyBarFill.style.width = Math.min(100, Math.max(0, pct)) + '%';
    }
  },
  hide() { els.busyOverlay.classList.remove('open'); }
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
  undo: null,
  redo: null,
  saveTimer: null,
  translatedCount: 0,
  namesDirty: true
};

for (const f of STATE_SCHEMA) State[f.key] = f.def;

State.toData = () => {
  const data = {
    version: VERSION,
    imported_files: State.files,
    lines: State.lines
  };
  for (const f of STATE_SCHEMA) {
    data[f.store || f.key] = State[f.key];
  }
  return data;
};

State.loadFromData = (data) => {
  State.files = data.imported_files || [];
  State.lines = (data.lines || []).map(normalizeLine);
  for (const f of STATE_SCHEMA) {
    const storeKey = f.store || f.key;
    const v = data[storeKey];
    State[f.key] = f.coerce ? (v || f.def) : (v ?? f.def);
  }
  if (!State.projectName) State.projectName = 'Unknown';
};

State.resetTransient = () => {
  State.projectId = null;
  State.projectName = '';
  State.projectType = 'uninitialized';
  State.epubSourceId = null;
  State.files = [];
  State.lines = [];
  State.rows = [];
  State.headerIdx = [];
  State.byNum.clear();
  State.fileLines.clear();
  State.selected.clear();
  State.undo = State.redo = null;
  State.translatedCount = 0;
  State.namesDirty = true;
  State.prScope = 'all';
  State.prRegex = false;
  State.prCase = false;
  State.prExact = false;
  State.prTranslatedOnly = false;
  State.hideTools = false;
};

State.initNewProject = () => {
  State.projectType = 'uninitialized';
  State.epubTags = 'p';
  State.epubSourceId = null;
  State.lines = [];
  State.files = [];
  State.prompt = State.prompt || DEFAULT_PROMPT;
  State.ignoreName = false;
  State.promptEnabled = true;
  State.ringkasanEnabled = false;
  State.ringkasanPrompt = DEFAULT_RINGKASAN_PROMPT;
  State.ringkasan = '';
  State.vndbEnabled = false;
  State.vndbId = '';
  State.vndbGlossary = [];
  State.customEnabled = false;
  State.customRaw = '';
  State.jumpToContext = false;
  State.hideTools = false;
  State.selected.clear();
  State.undo = State.redo = null;
  State.namesDirty = true;
  State.translatedCount = 0;
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
  for (let i = 0; i < files.length; i++) {
    const fileLines = grouped[i];
    if (!fileLines.length) continue;
    State.fileLines.set(files[i], fileLines);
    State.headerIdx.push(State.rows.length);
    State.rows.push({ type: 'header', file: files[i] });
    for (let j = 0, m = fileLines.length; j < m; j++) {
      State.rows.push({ type: 'line', line: fileLines[j] });
    }
  }
};

State.queueSave = () => {
  if (!State.projectId) return;
  clearTimeout(State.saveTimer);
  State.saveTimer = setTimeout(() => {
    const idle = window.requestIdleCallback || (fn => setTimeout(fn, 0));
    idle(async () => {
      try {
        await Storage.saveProject(State.projectId, State.toData(), {
          fileCount: State.files.length,
          lineCount: State.lines.length,
          translatedCount: State.translatedCount
        });
        App.flashSaved();
      } catch {}
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
    this.defaultH = 80;
    this.gap = 8;
    this.topPad = 8;
    this.botPad = 12;
    this.overscan = SCROLLER_OVERSCAN;
    this.scrollTop = 0;
    this.totalH = 0;
    this.scheduled = false;

    viewport.addEventListener('scroll', () => {
      this.scrollTop = viewport.scrollTop;
      this.schedule();
    }, { passive: true });

    if (window.ResizeObserver) {
      new ResizeObserver(() => { this.invalidate(); this.schedule(); }).observe(viewport);
    }
  }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => { this.scheduled = false; this.render(); });
  }

  setItems(items, keep = false) {
    const prevScroll = keep ? this.vp.scrollTop : 0;
    this.items = items;
    this.keys = items.map((it, i) => this.keyOf(it, i));
    this.heights = items.map((it, i) => {
      if (!keep) return it?.type === 'header' ? 32 : this.defaultH;
      const cached = this.heightCache.get(this.keys[i]);
      return cached !== undefined ? cached : (it?.type === 'header' ? 32 : this.defaultH);
    });
    if (!keep) this.heightCache.clear();
    this.pos = new Array(items.length);
    this.updatePos();
    this.vp.scrollTop = keep ? Math.min(prevScroll, Math.max(0, this.totalH - this.vp.clientHeight)) : 0;
    this.scrollTop = this.vp.scrollTop;
    this.invalidate();
    this.render();
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
    while (more && passes < 5) {
      more = this._renderPass();
      passes++;
    }
    if (more) this.schedule();
  }

  _renderPass() {
    if (!this.items.length) {
      for (let i = 0; i < this.els.length; i++) {
        this.els[i].style.transform = 'translateY(-9999px)';
        this.indices[i] = -1;
      }
      this.container.style.height = '0px';
      this.totalH = 0;
      return false;
    }

    const vh = this.vp.clientHeight || 800;
    const scrollTop = this.scrollTop;
    const vStart = this.findStart(scrollTop);
    const vEnd = this.findEnd(vStart, vh);
    const rStart = Math.max(0, vStart - this.overscan);
    const rEnd = Math.min(this.items.length, vEnd + this.overscan);
    const need = rEnd - rStart;

    while (this.els.length < need) {
      const el = this.create();
      el.style.transform = 'translateY(-9999px)';
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

    for (let i = 0; i < need; i++) {
      this.els[i].style.transform = `translateY(${this.pos[rStart + i]}px)`;
    }

    for (let i = need; i < this.els.length; i++) {
      if (this.indices[i] !== -1) {
        this.els[i].style.transform = 'translateY(-9999px)';
        this.indices[i] = -1;
      }
    }

    let heightsChanged = false;
    let adjust = 0;
    for (const i of toMeasure) {
      const di = rStart + i;
      const h = this.els[i].offsetHeight;
      if (h === 0) continue;
      const total = this.items[di]?.type === 'header' ? h : h + this.gap;
      if (Math.abs(total - this.heights[di]) > 1) {
        if (this.pos[di] < scrollTop) adjust += total - this.heights[di];
        this.heights[di] = total;
        this.heightCache.set(this.keys[di], total);
        heightsChanged = true;
      }
    }

    if (heightsChanged) {
      this.updatePos();
      if (adjust) { this.vp.scrollTop += adjust; this.scrollTop = this.vp.scrollTop; }
      for (let i = 0; i < need; i++) {
        this.els[i].style.transform = `translateY(${this.pos[rStart + i]}px)`;
      }
      const vBot = this.scrollTop + vh;
      const lastBot = rEnd < this.items.length
        ? this.pos[rEnd - 1] + this.heights[rEnd - 1]
        : this.totalH;
      if (lastBot < vBot) return true;
    }
    return false;
  }

  scrollToIndex(idx) {
    if (idx < 0 || idx >= this.items.length) return;
    const vh = this.vp.clientHeight || 800;
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
  const triggerMap = { importDropdown: 'btnImportMain', copyNamesDropdown: 'btnCopyAllNames' };
  const trigger = els[triggerMap[panelId]];
  const dropdown = els[panelId];
  if (!trigger || !dropdown) return;
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
  for (const { panel } of DROPDOWNS) els[panel]?.classList.remove('show');
}

function toggleModal(el, show) {
  if (show) { el.classList.remove('closing'); el.classList.add('open'); }
  else {
    el.classList.add('closing');
    el.classList.remove('open');
    setTimeout(() => el.classList.remove('closing'), MODAL_CLOSE_MS);
  }
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
      alert(`Project ini sudah diatur sebagai project ${State.projectType.toUpperCase()}. Tidak bisa mencampur file ${expected.toUpperCase()}.`);
      return false;
    }
    if (State.projectType === 'uninitialized') State.projectType = expected;
    return true;
  },

  async process(input, isZip = false) {
    await withProgress('Memproses file...', 'Mempersiapkan...', async () => {
      const startNum = State.lines.length ? State.lines.reduce((m, l) => Math.max(m, l.line_num), 0) + 1 : 1;
      const existing = new Set(State.files);
      let result;

      if (isZip && input instanceof File) {
        if (!Importer.assertProjectType('json')) { els.copyStatus.classList.add('empty'); return; }
        Progress.determinate('Mengimpor ZIP', `0 file`);
        result = await parseZipJson(await input.arrayBuffer(), Array.from(existing), startNum, Progress.update);
      } else {
        const files = Array.from(input).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        const hasEpub = files.some(f => f.name.toLowerCase().endsWith('.epub'));
        const hasJson = files.some(f => f.name.toLowerCase().endsWith('.json'));

        if (hasEpub && hasJson) {
          Progress.hide();
          alert('Tidak bisa mencampur EPUB dan JSON dalam satu import.');
          return;
        }

        if (hasEpub) {
          if (!Importer.assertProjectType('epub')) return;
          if (State.projectType === 'epub' && State.epubSourceId) {
            Progress.hide();
            alert('Project ini sudah memuat EPUB.');
            return;
          }
          if (!State.epubSourceId) {
            State.projectType = 'epub';
            State.epubSourceId = makeEpubId();
          }
          Progress.determinate('Mengimpor EPUB', `0 file`);
          result = await parseEpub(await files[0].arrayBuffer(), State.epubTags || 'p', Array.from(existing), startNum, State.epubSourceId, Progress.update);
        } else {
          if (!Importer.assertProjectType('json')) return;
          const fileInputs = [];
          for (const f of files) fileInputs.push({ name: f.name, buffer: await f.arrayBuffer() });
          Progress.determinate('Mengimpor file', `0 / ${fileInputs.length} file`);
          result = await parseFilesList(fileInputs, Array.from(existing), startNum, Progress.update);
        }
      }

      if (result.imported.length) {
        State.lines.push(...result.imported);
        State.files = Array.from(result.existing || existing);
        State.namesDirty = true;
        App.refresh(true);
        State.queueSave();
        App.flash(`Berhasil impor ${result.imported.length} baris.${result.skipped.length ? ` (${result.skipped.length} file duplikat diabaikan)` : ''}`);
      } else if (result.skipped.length) {
        els.copyStatus.classList.add('empty');
        setTimeout(() => alert(`Gagal impor: File duplikat.\n- ${result.skipped.slice(0, 5).join('\n- ')}`), 10);
      } else {
        App.flash('Tidak ada data valid.', false);
      }
    }, e => `Error:\n${e.message}`);
  }
};

const Exporter = {
  async runEpub() {
    await withProgress('Membuat EPUB...', 'Memuat arsip...', async () => {
      Progress.determinate('Membuat EPUB', `0 file`);
      const result = await buildExportEpub(State.epubSourceId, State.lines, State.epubTags || 'p', State.projectName, Progress.update);
      download(URL.createObjectURL(result.blob), result.name);
      App.flash('Ekspor EPUB berhasil!');
    }, e => 'Ekspor EPUB gagal: ' + e.message);
  },

  async runJson() {
    await withProgress('Membuat JSON...', 'Mengelompokkan baris...', async () => {
      Progress.determinate('Membuat JSON', `0 file`);
      const result = await buildExportJson(State.lines, State.projectName, Progress.update);
      download(URL.createObjectURL(result.blob), result.name);
      App.flash('Ekspor JSON berhasil!');
    }, e => 'Ekspor JSON gagal: ' + e.message);
  },

  async run() {
    if (!State.lines.length) return;
    if (State.projectType === 'epub' && State.epubSourceId) await Exporter.runEpub();
    else await Exporter.runJson();
  }
};

const App = {
  main: null,
  pr: null,
  activeLine: null,
  highlightRe: null,
  lastQuery: '',
  lastFile: null,
  fileCache: null,
  toastToken: 0,
  savedTimer: 0,
  tmpVndb: [],
  dashboardItems: [],
  dashboardRendered: 0,
  dashboardObserver: null,
  dashboardSentinel: null,

  flash(msg, keep = false) {
    const el = els.copyStatus;
    el.textContent = msg;
    el.classList.remove('empty');
    const t = ++App.toastToken;
    if (!keep) setTimeout(() => { if (App.toastToken === t) el.classList.add('empty'); }, TOAST_TIMEOUT_MS);
  },

  flashRow(n, delay = 50) {
    setTimeout(() => {
      const cb = els.previewContainer.querySelector(`input[data-num="${n}"]`);
      const row = cb?.closest('.preview-row');
      if (row) { row.classList.add('row-flash'); setTimeout(() => row.classList.remove('row-flash'), 800); }
    }, delay);
  },

  flashSaved() {
    const bar = els.progressText;
    if (!bar || !State.projectId) return;
    bar.classList.remove('saved');
    void bar.offsetWidth;
    bar.classList.add('saved');
    clearTimeout(App.savedTimer);
    App.savedTimer = setTimeout(() => bar.classList.remove('saved'), SAVED_TIMEOUT_MS);
  },

  async init() {
    cacheEls();

    if (!navigator.storage?.getDirectory) {
      els.projectList.innerHTML = `<p class="hint" style="grid-column:1/-1;color:var(--danger);">Browser tidak mendukung OPFS.</p>`;
      return;
    }

    App.main = new Scroller(
      els.previewViewport, els.previewContainer, App.createMainRow, App.updateMainRow,
      (item) => item.type === 'header' ? `h:${item.file}` : `l:${item.line.line_num}`
    );
    App.pr = new Scroller(
      els.proofreadContainer.closest('.proofread-results-wrap'),
      els.proofreadContainer,
      App.createPrRow,
      App.updatePrRow,
      (item) => `p:${item.num}`
    );

    App.bind();
    await App.loadDashboard();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
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
  },

  bindToolbar() {
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
    els.btnDashboardSettings.addEventListener('click', () => toggleModal(els.dashboardSettingsModal, true));
    els.btnDashboardSettingsClose.addEventListener('click', () => toggleModal(els.dashboardSettingsModal, false));
    els.btnBackupAll.addEventListener('click', App.backupAll);
    els.btnWipeAllData.addEventListener('click', App.wipeAllData);
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

    els.btnExport.addEventListener('click', () => Exporter.run());
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
        status.textContent = 'Mengambil data...';
        status.className = 'toast info';
        const chars = await Vndb.fetchCharacters(id);
        if (!chars.length) throw new Error('Karakter tidak ditemukan.');
        App.tmpVndb = Vndb.buildGlossary(chars);
        els.glossaryVndbPreviewArea.value = App.tmpVndb.map(g => `${g[0]}: ${g[1]}`).join('\n');
        status.textContent = `Ditemukan ${App.tmpVndb.length} entri.`;
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
      toggleModal(els.glossaryModal, false);
      State.queueSave();
    });
  },

  bindSettings() {
    els.btnSettings.addEventListener('click', () => {
      App.syncSettingsModal();
      toggleModal(els.settingsModal, true);
    });
    els.btnSettingsDasarReset.addEventListener('click', () => App.resetSettingsModal('dasar'));
    els.btnSettingsPromptReset.addEventListener('click', () => { els.settingsPromptInput.value = DEFAULT_PROMPT; });
    els.btnSettingsEpubReset.addEventListener('click', () => { els.settingsEpubTagsInput.value = 'p'; });
    els.btnSettingsCancel.addEventListener('click', () => toggleModal(els.settingsModal, false));
    els.btnSettingsSave.addEventListener('click', () => {
      SETTINGS_FIELDS.forEach(({ id, key, type, def }) => {
        if (type === 'check') State[key] = els[id].checked;
        else State[key] = els[id].value.trim() || def;
      });
      App.applyHideTools();
      toggleModal(els.settingsModal, false);
      State.queueSave();
    });
  },

  bindContext() {
    els.btnContext.addEventListener('click', () => {
      els.ringkasanEnabledCheck.checked = State.ringkasanEnabled;
      els.ringkasanPromptInput.value = State.ringkasanPrompt || DEFAULT_RINGKASAN_PROMPT;
      els.ringkasanStoredInput.value = State.ringkasan || '';
      els.ringkasanWrap.classList.toggle('section-disabled', !State.ringkasanEnabled);
      toggleModal(els.contextModal, true);
    });
    els.ringkasanEnabledCheck.addEventListener('change', e => {
      els.ringkasanWrap.classList.toggle('section-disabled', !e.target.checked);
    });
    els.btnRingkasanReset.addEventListener('click', () => {
      els.ringkasanEnabledCheck.checked = false;
      els.ringkasanPromptInput.value = DEFAULT_RINGKASAN_PROMPT;
      els.ringkasanStoredInput.value = '';
      els.ringkasanWrap.classList.add('section-disabled');
    });
    els.btnRingkasanPromptReset.addEventListener('click', () => {
      els.ringkasanPromptInput.value = DEFAULT_RINGKASAN_PROMPT;
    });
    els.btnRingkasanStoredReset.addEventListener('click', () => {
      els.ringkasanStoredInput.value = '';
    });
    els.btnContextCancel.addEventListener('click', () => toggleModal(els.contextModal, false));
    els.btnContextSave.addEventListener('click', () => {
      State.ringkasanEnabled = els.ringkasanEnabledCheck.checked;
      State.ringkasanPrompt = els.ringkasanPromptInput.value.trim() || DEFAULT_RINGKASAN_PROMPT;
      State.ringkasan = els.ringkasanStoredInput.value.trim();
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

    const delayedRender = debounce(App.renderProofread, 200);
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
        const idx = State.rows.findIndex(r => r.type === 'line' && r.line.line_num === n);
        if (idx !== -1) { App.main.scrollToIndex(idx); App.flashRow(n, 60); }
      } else {
        App.openLineEditor(n);
      }
    });
  },

  bindNames() {
    els.nameTableBody.addEventListener('click', async e => {
      if (e.target.tagName !== 'TD') return;
      try { await clipboard(e.target.textContent); App.flash('Nama disalin!'); }
      catch { alert('Gagal disalin.'); }
    });
    els.btnCopyNamesPlain.addEventListener('click', () => App.copyAllNames('plain'));
    els.btnCopyNamesWithGlossary.addEventListener('click', () => App.copyAllNames('glossary'));
    els.btnCopyNamesMissingGlossary.addEventListener('click', () => App.copyAllNames('missing'));
  },

  syncSettingsModal() {
    SETTINGS_FIELDS.forEach(({ id, key, type, def }) => {
      const v = State[key] ?? def;
      if (type === 'check') els[id].checked = v; else els[id].value = v;
    });
  },

  resetSettingsModal(group) {
    const filter = group === 'dasar' ? f => f.type === 'check' : null;
    if (!filter) return;
    SETTINGS_FIELDS.filter(filter).forEach(({ id, def }) => { els[id].checked = def; });
  },

  async createProject() {
    const name = prompt('Nama project baru:')?.trim();
    if (!name) return;
    const id = makeProjId();
    State.initNewProject();
    State.projectId = id;
    State.projectName = name;
    try {
      await Storage.saveProject(id, State.toData());
      App.open(id, State.toData());
    } catch (e) {
      alert('Gagal membuat project: ' + e.message);
    }
  },

  open(id, data) {
    State.loadFromData(data);
    State.projectId = id;
    State.selected.clear();
    State.undo = State.redo = null;
    State.namesDirty = true;

    if (App.dashboardObserver) { App.dashboardObserver.disconnect(); App.dashboardObserver = null; }

    els.projectNameDisplay.textContent = State.projectName;
    els.dashboardView.classList.remove('open');
    els.workspaceView.style.display = 'flex';
    App.applyHideTools();
    App.refresh(false);
  },

  closeProject() {
    if (State.saveTimer) {
      clearTimeout(State.saveTimer);
      State.saveTimer = null;
      const id = State.projectId;
      const data = State.toData();
      Storage.saveProject(id, data)
        .then(App.finishClose)
        .catch(e => {
          alert('Gagal menyimpan perubahan terakhir: ' + e.message);
          App.finishClose();
        });
    } else App.finishClose();
  },

  finishClose() {
    State.resetTransient();
    App.main?.setItems([], false);
    App.pr?.setItems([], false);
    els.nameTableBody.replaceChildren();
    els.pasteArea.value = '';
    els.copyStatus.classList.add('empty');
    els.progressText.textContent = '0/0 (0%)';
    els.progressText.classList.remove('saved');
    els.stickyFileName.textContent = '';
    els.stickyFileName.title = '';
    els.stickyFileRange.textContent = '';
    els.stickyFileBar.classList.remove('show', 'swap');
    els.stickyFileCheckbox.checked = false;
    els.stickyFileCheckbox.disabled = true;
    delete els.stickyFileCheckbox.dataset.file;
    App.lastFile = null;
    App.fileCache = null;
    els.workspaceView.style.display = 'none';
    const split = document.querySelector('.split');
    if (split) split.classList.remove('hide-tools');
    els.workspaceToolbar.classList.remove('hidden');
    els.btnShowHeader.classList.remove('visible');
    els.dashboardView.classList.add('open');
    App.loadDashboard();
  },

  applyHideTools() {
    const split = document.querySelector('.split');
    if (!split) return;
    split.classList.toggle('hide-tools', State.hideTools);
    if (App.main) requestAnimationFrame(() => { App.main.invalidate(); App.main.render(); });
  },

  async wipeAllData() {
    if (!confirm('Semua project dan data akan dihapus permanen. Lanjutkan?')) return;
    try { await Storage.wipe(); } catch {}
    try {
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch {}
    try {
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
    } catch {}
    location.reload();
  },

  async loadDashboard() {
    const list = els.projectList;
    const content = list.parentElement;

    if (App.dashboardObserver) { App.dashboardObserver.disconnect(); App.dashboardObserver = null; }
    App.dashboardSentinel = null;
    App.dashboardItems = [];
    App.dashboardRendered = 0;
    list.innerHTML = '';

    try {
      const items = await Storage.list();
      if (!items.length) {
        content.classList.add('is-empty');
        list.innerHTML = `<p class="hint" style="grid-column:1/-1;">Belum ada Project. Buat atau Pulihkan!</p>`;
        return;
      }
      content.classList.remove('is-empty');
      App.dashboardItems = items;

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
    } catch {
      list.innerHTML = `<p class="hint" style="color:var(--danger);">Gagal akses storage.</p>`;
    }
  },

  renderDashboardPage() {
    const list = els.projectList;
    const sentinel = App.dashboardSentinel;
    if (!list || !sentinel) return;

    const start = App.dashboardRendered;
    const end = Math.min(start + DASHBOARD_PAGE_SIZE, App.dashboardItems.length);
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
    if (hasData) {
      if (p.projectType === 'epub') badge = '<span class="badge badge-epub">EPUB</span>';
      else if (p.projectType === 'json') badge = '<span class="badge badge-json">JSON-VNTP</span>';
    }
    const pct = p.lineCount ? Math.floor(p.translatedCount / p.lineCount * 100) : 0;
    card.innerHTML = `
      <div class="project-card-main">
        <h3>${escapeHtml(p.name)}</h3>
        <div class="project-meta mt-2">
          ${badge ? `<div style="margin-bottom:8px;">${badge}</div>` : ''}
          Diubah: ${new Date(p.updatedAt).toLocaleString('id-ID')}<br>
          File: ${p.fileCount}<br>
          Baris: ${p.translatedCount}/${p.lineCount} (${pct}%)
        </div>
      </div>
      <div class="project-actions">
        <button class="btn btn-primary btn-sm btn-open">Buka</button>
        <button class="btn btn-ghost btn-sm btn-rename">Ubah</button>
        <button class="btn btn-ghost btn-sm btn-backup">Backup</button>
        <button class="btn btn-danger btn-sm btn-delete">Hapus</button>
      </div>
    `;
    card.querySelector('.btn-open').addEventListener('click', async () => {
      try {
        const data = await Storage.load(p.id);
        App.open(p.id, data);
      } catch (e) { alert('Gagal membuka project: ' + e.message); }
    });
    card.querySelector('.btn-rename').addEventListener('click', async () => {
      const name = prompt('Nama baru:', p.name);
      if (!name?.trim() || name === p.name) return;
      try {
        const data = await Storage.load(p.id);
        data.projectName = name.trim();
        await Storage.saveProject(p.id, data);
        App.loadDashboard();
      } catch (e) { alert('Gagal mengubah nama: ' + e.message); }
    });
    card.querySelector('.btn-backup').addEventListener('click', async () => {
      App.backup({ id: p.id, name: p.name });
    });
    card.querySelector('.btn-delete').addEventListener('click', async () => {
      if (!confirm('Hapus permanen?')) return;
      try {
        const data = await Storage.load(p.id);
        await Storage.remove(p.id, data.epubSourceId);
        App.loadDashboard();
      } catch (e) { alert('Gagal menghapus: ' + e.message); }
    });
    return card;
  },

  async backup(p) {
    await withProgress('Mem-backup project...', 'Membaca data...', async () => {
      Progress.determinate('Mem-backup project', 'Memproses...');
      const result = await buildBackup(p.id, p.name, Progress.update);
      download(URL.createObjectURL(result.blob), result.name);
    }, e => 'Gagal backup: ' + e.message);
  },

  async backupAll() {
    await withProgress('Mem-backup semua project...', 'Menghitung project...', async () => {
      Progress.determinate('Mem-backup semua project', 'Memulai...');
      const result = await backupAll(Progress.update);
      download(URL.createObjectURL(result.blob), result.name);
    }, e => e.message === 'Belum ada Project untuk di-backup.' ? e.message : 'Gagal backup semua project: ' + e.message);
  },

  async restoreProject(e) {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;
    const result = await withProgress('Memulihkan project...', 'Memuat arsip...', async () => {
      Progress.determinate('Memulihkan project', 'Membaca arsip...');
      const r = await parseRestore(await uploadedFile.arrayBuffer(), uploadedFile.name.replace(/\.cstl$/i, ''), Progress.update);
      await App.loadDashboard();
      return r;
    }, e => 'File korup: ' + e.message);
    if (result) {
      if (result.single) alert(`Project "${result.name}" dipulihkan!`);
      else alert(`${result.ok} project berhasil dipulihkan${result.fail ? `, ${result.fail} gagal` : ''}.`);
    }
    e.target.value = '';
  },

  refresh(keep = true) {
    State.updateCount();
    State.rebuild();
    App.main.setItems(State.rows, keep);
    App.updateFileBadge();
    App.updateButtons();
    if (State.namesDirty) { App.renderNames(); State.namesDirty = false; }
    App.updateStatusBar();
    els.btnUndo.disabled = !State.undo;
    els.btnRedo.disabled = !State.redo;
  },

  updateButtons() {
    const has = State.lines.length > 0;
    const sel = State.selected.size > 0;
    els.btnExport.disabled = !has;
    els.btnProofread.disabled = !has;
    els.btnSelectAll.disabled = !has;
    els.pasteArea.disabled = !has;
    els.btnApply.disabled = !has;
    els.rangeFromInput.disabled = !has;
    els.rangeToInput.disabled = !has;
    els.btnSelectRange.disabled = !has;
    els.btnClearSelection.disabled = !sel;
    els.btnCopyForAi.disabled = !sel;
    const n = State.selected.size;
    els.btnCopyForAi.textContent = n > 0 ? `Copy ${n} Baris` : 'Copy';
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
        if (App.lastFile !== null) {
          bar.classList.add('swap');
          setTimeout(() => {
            App._applyFileBadgeContent(activeFile, nameEl, rangeEl, cb);
            bar.classList.remove('swap');
          }, 100);
        } else {
          App._applyFileBadgeContent(activeFile, nameEl, rangeEl, cb);
          bar.classList.add('show');
        }
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
      const key = `${activeFile}:${State.selected.size}:${State.translatedCount}`;
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
    row.append(cell, hdr);
    row._cell = cell; row._cb = cb; row._orig = orig; row._trans = trans;
    row._hdr = hdr; row._hCb = hCb; row._hName = hName; row._hRange = hRange;
    return row;
  },

  updateMainRow(row, data) {
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
    } else {
      const l = data.line;
      let cls = 'preview-row';
      if (isTrans(l)) cls += ' row-translated';
      if (State.selected.has(l.line_num)) cls += ' row-selected';
      row.className = cls;
      row._cell.style.display = 'flex';
      row._hdr.style.display = 'none';
      row._cb.dataset.num = l.line_num;
      row._cb.checked = State.selected.has(l.line_num);
      row._cb.disabled = isTrans(l);
      row._orig.textContent = l.name ? `${l.line_num}. ${l.name}: ${l.message}` : `${l.line_num}. ${l.message}`;
      if (isTrans(l)) {
        row._trans.classList.remove('cell-muted');
        const n = l.trans_name || l.name;
        row._trans.textContent = n ? `${l.line_num}. ${n}: ${l.trans_message}` : `${l.line_num}. ${l.trans_message}`;
      } else {
        row._trans.classList.add('cell-muted');
        row._trans.textContent = '——';
      }
    }
  },

  syncCheckboxes() {
    App.main.forceUpdate();
    App.updateFileBadge();
    App.updateButtons();
  },

  renderNames() {
    const set = new Set();
    for (const l of State.lines) if (l.name) set.add(l.name);
    const arr = Array.from(set).sort();
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
      td.title = 'Klik untuk copy';
      tr.appendChild(td);
      frag.appendChild(tr);
    }
    body.appendChild(frag);
  },

  async copyAllNames(mode) {
    closeDropdowns();
    const names = new Set();
    for (const l of State.lines) if (l.name) names.add(l.name);
    const arr = Array.from(names).sort();
    if (!arr.length) return;
    const gloss = App.buildGlossaryMap();
    let lines, label;
    if (mode === 'plain') {
      lines = arr;
      label = `${arr.length} nama disalin!`;
    } else if (mode === 'glossary') {
      lines = arr.map(n => `${n}: ${gloss.get(n) || ''}`);
      label = `${arr.length} nama + glossary disalin!`;
    } else {
      const missing = arr.filter(n => !gloss.has(n));
      lines = missing.map(n => `${n}: `);
      label = `${missing.length} nama (belum di glossary) disalin!`;
    }
    if (!lines.length) { App.flash('Tidak ada nama yang cocok.'); return; }
    try { await clipboard(lines.join('\n')); App.flash(label); }
    catch { alert('Clipboard diblokir.'); }
  },

  selectRange() {
    const from = parseInt(els.rangeFromInput.value);
    const to = parseInt(els.rangeToInput.value);
    const max = State.lines.length ? State.lines.reduce((m, l) => Math.max(m, l.line_num), 0) : 0;
    if (isNaN(from) || isNaN(to) || from > to || from < 1 || from > max || to > max) return alert('Range tidak valid.');

    State.selected.clear();
    for (let n = from; n <= to; n++) {
      const l = State.byNum.get(n);
      if (l && !isTrans(l)) State.selected.add(n);
    }
    App.syncCheckboxes();

    const idx = State.rows.findIndex(r => r.type === 'line' && r.line.line_num === from);
    if (idx !== -1) { App.main.scrollToIndex(idx); App.flashRow(from, 50); }
  },

  buildGlossaryMap() {
    const map = new Map();
    if (State.vndbEnabled && State.vndbGlossary?.length) {
      State.vndbGlossary.forEach(e => map.set(e[0], e[1]));
    }
    return map;
  },

  formatLine(l) {
    return l.name ? `${l.line_num}. ${l.name}: ${l.message}` : `${l.line_num}. ${l.message}`;
  },

  async copyForAi() {
    const sel = State.lines.filter(l => State.selected.has(l.line_num));
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
    if (State.ringkasanEnabled) {
      if (State.ringkasan && State.ringkasan.trim()) parts.push(`Ringkasan Sebelumnya:\n${State.ringkasan.trim()}`);
      if (State.ringkasanPrompt && State.ringkasanPrompt.trim()) parts.push(State.ringkasanPrompt.trim());
    }
    parts.push(sel.map(App.formatLine).join('\n'));
    const text = parts.join('\n\n');

    try {
      await clipboard(text);
      App.flash(`Disalin ${sel.length} baris.`);
    } catch {
      els.pasteArea.value = text;
      alert("Clipboard diblokir. Teks dipindah ke kolom 'Paste hasil AI'.");
    }
  },

  parseAi(raw, byNum) {
    const fenceLines = raw.split(/\r?\n/).filter(l => /^\s*```\w*\s*$/.test(l));
    if (fenceLines.length !== 0 && fenceLines.length !== 2) {
      return { results: [], errors: ['Harus ada pembuka dan penutup ``` bersamaan, atau tidak ada sama sekali.'], seen: new Set(), ringkasan: null };
    }
    const text = raw.split(/\r?\n/).filter(l => !/^\s*```\w*\s*$/.test(l)).join('\n');
    const tagMatch = text.match(/<translate>([\s\S]*?)<\/translate>/i);
    if (!tagMatch) {
      return { results: [], errors: ['Tidak ditemukan tag <translate>...</translate>.'], seen: new Set(), ringkasan: null };
    }
    const before = text.slice(0, tagMatch.index).trim();
    const after = text.slice(tagMatch.index + tagMatch[0].length).trim();
    const ringkasan = [before, after].filter(Boolean).join('\n\n').trim() || null;
    const lines = tagMatch[1].split(/\r?\n/);

    const results = [];
    const errors = [];
    const seen = new Set();
    const re = /^(\d+)\.\s+(.*)$/;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const m = line.match(re);
      if (!m) { errors.push(`Baris ${i + 1}: Format tidak valid (harus "N. ...").`); continue; }
      const num = Number(m[1]);
      const rest = m[2].trim();
      if (!Number.isInteger(num) || num <= 0) { errors.push(`Baris ${i + 1}: ID tidak valid.`); continue; }
      if (seen.has(num)) { errors.push(`Baris ${num}: Duplikat ID.`); continue; }
      seen.add(num);

      const orig = byNum ? byNum.get(num) : null;
      let name = null, msg = rest;
      if (orig && orig.name) {
        const ci = rest.indexOf(': ');
        if (ci > 0) { name = rest.substring(0, ci).trim(); msg = rest.substring(ci + 2).trim(); }
        else if (rest.endsWith(':')) { name = rest.substring(0, rest.length - 1).trim(); msg = ''; }
      }
      results.push({ num, name, msg });
    }
    return { results, errors, seen, ringkasan };
  },

  applyTranslation() {
    if (!State.lines.length) return;
    const raw = els.pasteArea.value.trim();
    if (!raw) return alert('Teks kosong.');

    const { results, errors, seen, ringkasan } = App.parseAi(raw, State.byNum);
    if (!results.length) {
      if (errors.length) return alert('DITOLAK:\n' + errors.slice(0, 10).join('\n') + (errors.length > 10 ? `\n+${errors.length - 10} error lainnya` : ''));
      return alert('Tidak ada data valid.');
    }

    if (results.length !== State.selected.size) errors.push(`Jumlah entry (${results.length}) ≠ jumlah centang (${State.selected.size}).`);
    State.selected.forEach(n => { if (!seen.has(n)) errors.push(`Baris ${n}: Dilewati AI.`); });
    seen.forEach(n => { if (!State.selected.has(n)) errors.push(`Baris ${n}: ID tidak dicentang.`); });

    const updates = [];
    results.forEach(r => {
      const l = State.byNum.get(r.num);
      if (!l) { errors.push(`Baris ${r.num}: ID tidak ada.`); return; }
      if (State.ignoreName && l.name) r.name = l.name;
      const hasOn = !!(l.name || '').trim();
      const hasTn = !!(r.name || '').trim();
      const hasMsg = !!(l.message || '').trim();
      if (hasOn && !hasTn) errors.push(`Baris ${r.num}: Nama dihapus AI.`);
      else if (!hasOn && hasTn) errors.push(`Baris ${r.num}: Narasi tapi ada nama.`);
      else if (!r.msg && hasMsg) errors.push(`Baris ${r.num}: Pesan kosong.`);
      else updates.push({ line: l, item: r });
    });

    if (errors.length) return alert('DITOLAK:\n' + errors.slice(0, 10).join('\n') + (errors.length > 10 ? `\n+${errors.length - 10} error lainnya` : ''));

    State.undo = snapshot();
    State.redo = null;
    updates.forEach(({ line, item }) => {
      line.trans_message = item.msg;
      line.is_translated = true;
      if (item.name) line.trans_name = State.ignoreName ? null : item.name;
      State.selected.delete(line.line_num);
    });

    if (State.ringkasanEnabled && ringkasan) State.ringkasan = ringkasan;

    els.pasteArea.value = '';
    State.namesDirty = true;
    App.refresh(true);
    State.queueSave();
    App.flash(`${updates.length} baris sukses diterapkan.`);
  },

  undo() {
    if (!State.undo) return;
    State.redo = snapshot();
    State.lines = State.undo.lines.map(normalizeLine);
    State.selected = new Set(State.undo.selected);
    State.undo = null;
    State.namesDirty = true;
    App.refresh(true);
    State.queueSave();
  },

  redo() {
    if (!State.redo) return;
    State.undo = snapshot();
    State.lines = State.redo.lines.map(normalizeLine);
    State.selected = new Set(State.redo.selected);
    State.redo = null;
    State.namesDirty = true;
    App.refresh(true);
    State.queueSave();
  },

  openLineEditor(num) {
    const l = State.byNum.get(num);
    if (!l) return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount) sel.removeAllRanges();
    App.activeLine = num;
    els.lineEditorTitle.textContent = `Edit Baris ${num}`;
    els.lineOriginalView.value = l.name ? `${l.name}: ${l.message}` : l.message;
    els.lineNameWrap.style.display = l.name ? 'block' : 'none';
    els.lineNameInput.value = l.name ? (l.trans_name || '') : '';
    if (l.name) els.lineNameInput.placeholder = l.name;
    els.lineMessageInput.value = (l.trans_message || '').trim();
    els.lineTranslatedCheck.checked = isTrans(l);
    toggleModal(els.lineEditorModal, true);
  },

  saveLineEditor() {
    const l = State.byNum.get(App.activeLine);
    if (!l) return;
    const msg = els.lineMessageInput.value.trim().replace(/\r?\n/g, '\\n');
    const hasMsg = !!(l.message || '').trim();
    if (els.lineTranslatedCheck.checked && !msg && hasMsg) return alert('Pesan kosong.');

    State.undo = snapshot();
    l.trans_message = msg || null;
    l.is_translated = els.lineTranslatedCheck.checked && (!!msg || !hasMsg);
    if (l.name) l.trans_name = els.lineNameInput.value.trim().replace(/\r?\n/g, '\\n') || null;

    State.redo = null;
    State.namesDirty = true;
    toggleModal(els.lineEditorModal, false);
    App.refresh(true);
    if (els.proofreadModal.classList.contains('open')) App.renderProofread();
    State.queueSave();
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
    setTimeout(() => App.renderProofread(), 340);
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
    els.proofreadStatus.textContent = `Ditemukan ${matches.length} baris.`;
    const changed = q !== App.lastQuery;
    App.lastQuery = q;
    App.pr.setItems(matches, !changed);
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
    row._meta.textContent = `File: ${d.file} | Baris: ${d.num}`;
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
    if (!q) return alert('Pencarian kosong!');

    const regex = els.proofreadRegexCheck.checked;
    const exact = els.proofreadExactCheck.checked;
    const caseSensitive = els.proofreadCaseCheck.checked;
    const translatedOnly = els.proofreadTranslatedOnlyCheck.checked;
    const scope = els.proofreadScope.value;

    const result = replaceAll(State.lines, q, repl, regex, exact, caseSensitive, scope, translatedOnly);

    if (!result.count) return alert('Tidak ada yang cocok.');

    State.undo = snapshot();
    State.redo = null;
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
    App.refresh(true);
    App.renderProofread();
    State.queueSave();
    alert(`Berhasil replace ${result.count} baris.`);
  }
};

document.addEventListener('DOMContentLoaded', App.init);

})();
