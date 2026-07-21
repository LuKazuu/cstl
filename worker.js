'use strict';

let JSZIP_READY = false;
try {
  importScripts('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
  JSZIP_READY = typeof JSZip !== 'undefined';
} catch {
  JSZIP_READY = false;
}

const VERSION = 1;
const INDEX_FILE = '_index.json';
const DEFAULT_PROMPT = `Translate entire text to Native English. Euphemism prohibited. Onomatopoeia must be English-based. Result must be inside codeblock. Keep line numbering and format (like code in the middle of the text) intact.`;
const DEFAULT_RINGKASAN_PROMPT = `Outside the <translate> and </translate> tags (placed above or below the translated lines), include updated summary of the characters and overall story so far. Any characters and story need to be preserved even though they don't appear again for context.`;

const DECODERS = ['utf-8', 'shift_jis', 'windows-31j', 'cp932'];

let cachedLines = null;

let domReqId = 1;
const domPending = new Map();

function domCall(method, ...args) {
  return new Promise((resolve, reject) => {
    const reqId = domReqId++;
    domPending.set(reqId, { resolve, reject });
    self.postMessage({ domRequest: { reqId, method, args } });
  });
}

function post(id, task, payload) {
  self.postMessage({ id, task, ok: true, result: payload });
}

function postError(id, task, message) {
  self.postMessage({ id, task, ok: false, error: message });
}

function postProgress(id, msg, pct) {
  self.postMessage({ id, progress: { msg, pct } });
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

function baseName(p) {
  return String(p || '').replace(/\\/g, '/').split('/').pop();
}

function sanitizeName(s) {
  const name = String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim().replace(/[.\s]+$/, '');
  return name || 'untitled';
}

function isJapanese(s) {
  return /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(s);
}

function fastNormalize(l) {
  return {
    line_num: l.line_num,
    file: l.file,
    name: l.name,
    message: l.message,
    trans_name: l.trans_name,
    trans_message: l.trans_message,
    is_translated: !!l.is_translated,
    _n: 1
  };
}

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

function yieldToEvent() {
  return new Promise(r => setTimeout(r, 0));
}

const Storage = {
  async root() {
    return await navigator.storage.getDirectory();
  },

  async readIndex() {
    try {
      const root = await Storage.root();
      const h = await root.getFileHandle(INDEX_FILE);
      const f = await h.getFile();
      return JSON.parse(await f.text());
    } catch { return null; }
  },

  async writeIndex(items) {
    const root = await Storage.root();
    const h = await root.getFileHandle(INDEX_FILE, { create: true });
    const w = await h.createWritable();
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

  async saveProject(id, data) {
    data.updatedAt = Date.now();
    const root = await Storage.root();
    const h = await root.getFileHandle(id, { create: true });
    const w = await h.createWritable();
    await w.write(JSON.stringify(data));
    await w.close();
    await Storage.upsertIndex({
      id,
      name: data.projectName,
      projectType: data.projectType || 'uninitialized',
      updatedAt: data.updatedAt,
      fileCount: data.imported_files?.length || 0,
      lineCount: data.lines?.length || 0,
      translatedCount: data.lines?.reduce((n, l) => n + (l.is_translated ? 1 : 0), 0) || 0
    });
  },

  async load(id) {
    const root = await Storage.root();
    const h = await root.getFileHandle(id);
    const f = await h.getFile();
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
    const h = await root.getFileHandle(epubId);
    const f = await h.getFile();
    return await f.arrayBuffer();
  },

  async saveEpub(epubId, buffer) {
    const root = await Storage.root();
    const h = await root.getFileHandle(epubId, { create: true });
    const w = await h.createWritable();
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

async function parseJsonFiles({ files, existing, start }, onProgress) {
  existing = new Set(existing || []);
  const imported = [];
  const skipped = [];
  let cur = start;
  const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i];
    const bn = baseName(f.name);
    if (existing.has(bn)) { skipped.push(bn); continue; }
    const buf = f.buffer;
    const arr = JSON.parse(decodeBuffer(buf));
    const parsed = parseJsonArray(arr, bn, cur);
    if (parsed.length) { existing.add(bn); imported.push(...parsed); cur += parsed.length; }
    onProgress(`${i + 1} / ${sorted.length} file`, ((i + 1) / sorted.length) * 100);
    if (i % 50 === 0) await yieldToEvent();
  }
  return { imported, skipped, nextStart: cur, existing: Array.from(existing) };
}

async function parseZipJson({ buffer, existing, start }, onProgress) {
  if (!JSZIP_READY) throw new Error('JSZip tidak tersedia.');
  existing = new Set(existing || []);
  const zip = new JSZip();
  await zip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter(n => n.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  const imported = [];
  const skipped = [];
  let cur = start;
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const bn = baseName(name);
    if (existing.has(bn)) { skipped.push(bn); continue; }
    const buf = await zip.file(name).async('uint8array');
    const arr = JSON.parse(decodeBuffer(buf));
    const parsed = parseJsonArray(arr, bn, cur);
    if (parsed.length) { existing.add(bn); imported.push(...parsed); cur += parsed.length; }
    onProgress(`${i + 1} / ${names.length} file`, ((i + 1) / names.length) * 100);
    if (i % 50 === 0) await yieldToEvent();
  }
  return { imported, skipped, nextStart: cur, existing: Array.from(existing) };
}

async function parseEpub({ buffer, tags, existing, start, epubId }, onProgress) {
  if (!JSZIP_READY) throw new Error('JSZip tidak tersedia.');
  existing = new Set(existing || []);
  await Storage.saveEpub(epubId, buffer);
  const zip = new JSZip();
  await zip.loadAsync(buffer);
  const containerXml = await zip.file('META-INF/container.xml').async('text');
  const opfPath = await domCall('containerRoot', containerXml);
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) + '/' : '';
  const opfXml = await zip.file(opfPath).async('text');
  const { manifest, spine } = await domCall('opfManifest', opfXml);
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
    const texts = await domCall('extractTags', html, path.endsWith('.xhtml'), tags);
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

async function buildExportJson({ lines, projectName }, onProgress) {
  if (!JSZIP_READY) throw new Error('JSZip tidak tersedia.');
  const grouped = new Map();
  for (let i = 0, n = lines.length; i < n; i++) {
    const l = lines[i];
    let arr = grouped.get(l.file);
    if (!arr) { arr = []; grouped.set(l.file, arr); }
    arr.push(l);
  }
  const entries = Array.from(grouped.entries());
  const results = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const [file, fileLines] = entries[i];
    const out = new Array(fileLines.length);
    for (let j = 0, m = fileLines.length; j < m; j++) {
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

async function buildExportEpub({ epubBuffer, epubId, lines, tags, projectName }, onProgress) {
  if (!JSZIP_READY) throw new Error('JSZip tidak tersedia.');
  let buffer = epubBuffer;
  if (!buffer && epubId) buffer = await Storage.loadEpubBuffer(epubId);
  if (!buffer) throw new Error('EPUB tidak ditemukan.');
  const zip = new JSZip();
  await zip.loadAsync(buffer);
  const byFile = {};
  for (let i = 0, n = lines.length; i < n; i++) {
    const l = lines[i];
    (byFile[l.file] ||= []).push(l);
  }
  const paths = Object.keys(byFile);
  for (let pi = 0; pi < paths.length; pi++) {
    const path = paths[pi];
    const fileLines = byFile[path];
    const entry = zip.file(path);
    if (!entry) continue;
    const html = await entry.async('text');
    const xmlMatch = html.match(/^<\?xml.*?\?>/i);
    const replacements = fileLines.map(l => (l.is_translated && l.trans_message) ? l.trans_message : null);
    let out = await domCall('rewriteTags', html, path.endsWith('.xhtml'), tags, replacements);
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
  const allLines = data.lines || [];
  for (let i = 0, n = allLines.length; i < n; i++) {
    const l = allLines[i];
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
    for (let i = 0, n = fl.length; i < n; i++) {
      const l = fl[i];
      origParts.push(l.message || '', '\n');
      transParts.push(l.trans_message || '', '\n');
      const hasName = (l.name || '') || (l.trans_name || '');
      if (hasName) {
        namesParts.push(`<original>${l.name || ''}</original><translate>${l.trans_name || ''}</translate>\n`);
      } else {
        namesParts.push('\n');
      }
    }
  }
  zip.file('original.txt', origParts.join(''));
  zip.file('translate.txt', transParts.join(''));
  zip.file('name.txt', namesParts.join(''));
}

async function buildBackupFromStorage({ id, name }, onProgress) {
  if (!JSZIP_READY) throw new Error('JSZip tidak tersedia.');
  const data = await Storage.load(id);
  let epubBuffer = null;
  if (data.projectType === 'epub' && data.epubSourceId) {
    try { epubBuffer = await Storage.loadEpubBuffer(data.epubSourceId); } catch {}
  }
  const zip = new JSZip();
  buildProjectZipInner(zip, data);
  if (epubBuffer) zip.file(data.epubSourceId, epubBuffer);
  onProgress('Mengompres backup...', 90);
  const blob = await zip.generateAsync({
    type: 'blob', mimeType: 'application/octet-stream',
    compression: 'DEFLATE', compressionOptions: { level: 9 }
  });
  return { blob, name: `${sanitizeName(name)}_backup.cstl` };
}

async function backupAll(_payload, onProgress) {
  if (!JSZIP_READY) throw new Error('JSZip tidak tersedia.');
  const items = await Storage.list();
  if (!items.length) throw new Error('Belum ada Project untuk di-backup.');
  const total = items.length;
  const outer = new JSZip();
  const used = new Set();
  onProgress(`0 / ${total} project`, 0);
  for (let i = 0; i < total; i++) {
    onProgress(`Memproses ${i + 1} / ${total} project`, (i / total) * 95);
    const meta = items[i];
    const data = await Storage.load(meta.id);
    const zip = new JSZip();
    buildProjectZipInner(zip, data);
    if (data.projectType === 'epub' && data.epubSourceId) {
      try {
        const buf = await Storage.loadEpubBuffer(data.epubSourceId);
        zip.file(data.epubSourceId, buf);
      } catch {}
    }
    const blob = await zip.generateAsync({
      type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 }
    });
    const base = sanitizeName(data.projectName);
    let name = base, k = 2;
    while (used.has(name)) name = `${base}_${k++}`;
    used.add(name);
    outer.file(`${name}_backup.cstl`, blob);
    onProgress(`${i + 1} / ${total} project selesai`, ((i + 1) / total) * 95);
    await yieldToEvent();
  }
  onProgress('Mengompres arsip utama...', 98);
  const blob = await outer.generateAsync({
    type: 'blob', mimeType: 'application/octet-stream',
    compression: 'DEFLATE', compressionOptions: { level: 9 }
  });
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
      lines[i] = fastNormalize({
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
      const buf = await entry.async('arraybuffer');
      await Storage.saveEpub(newId, buf);
      meta.epubSourceId = newId;
    }
  }

  const id = 'proj_' + Date.now() + '.cstl';
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

async function parseRestore({ buffer, fallbackName }, onProgress) {
  if (!JSZIP_READY) throw new Error('JSZip tidak tersedia.');
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

function proofreadSearch({ lines, query, regex, exact, caseSensitive, scope, translatedOnly }) {
  const source = lines || cachedLines || [];
  const re = buildRe(query, regex, exact, caseSensitive);
  const matches = [];
  for (let i = 0, n = source.length; i < n; i++) {
    const l = source[i];
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
  return { matches };
}

function replaceAll({ lines, query, replace, regex, exact, caseSensitive, scope, translatedOnly }) {
  const source = lines || cachedLines || [];
  const re = buildRe(query, regex, exact, caseSensitive);
  if (!re) return { modified: [], count: 0 };
  const modified = [];
  let count = 0;
  for (let i = 0, n = source.length; i < n; i++) {
    const l = source[i];
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

function vndbBuildGlossary({ chars }) {
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
  return { glossary: Array.from(map.entries()).sort((a, b) => b[0].length - a[0].length) };
}

const handlers = {
  'storage-list': () => Storage.list(),
  'storage-load': ({ id }) => Storage.load(id),
  'storage-save': ({ id, data }) => Storage.saveProject(id, data),
  'storage-remove': ({ id, epubId }) => Storage.remove(id, epubId),
  'storage-wipe': () => Storage.wipe(),
  'set-state': ({ lines }) => { cachedLines = lines; return { ok: true }; },
  'parse-json-files': (p, onProg) => parseJsonFiles(p, onProg),
  'parse-zip-json': (p, onProg) => parseZipJson(p, onProg),
  'parse-epub': (p, onProg) => parseEpub(p, onProg),
  'build-export-json': (p, onProg) => buildExportJson(p, onProg),
  'build-export-epub': (p, onProg) => buildExportEpub(p, onProg),
  'build-backup-from-storage': (p, onProg) => buildBackupFromStorage(p, onProg),
  'backup-all': (p, onProg) => backupAll(p, onProg),
  'parse-restore': (p, onProg) => parseRestore(p, onProg),
  'proofread-search': (p) => proofreadSearch(p),
  'replace-all': (p) => replaceAll(p),
  'vndb-build-glossary': (p) => vndbBuildGlossary(p)
};

self.onmessage = async (e) => {
  const { id, task, payload, domResponse } = e.data;
  if (domResponse) {
    const { reqId, ok, result, error } = domResponse;
    const h = domPending.get(reqId);
    if (h) {
      domPending.delete(reqId);
      if (ok) h.resolve(result);
      else h.reject(new Error(error));
    }
    return;
  }
  const handler = handlers[task];
  if (!handler) { postError(id, task, `Unknown task: ${task}`); return; }
  try {
    const result = await handler(payload, (msg, pct) => postProgress(id, msg, pct));
    post(id, task, result);
  } catch (err) {
    postError(id, task, err.message || String(err));
  }
};
