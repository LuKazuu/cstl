const VERSION = 16;
const DEFAULT_PROMPT = `Translate entire text to Native English. Euphemism prohibited. Onomatopoeia must be English-based. Result must be inside codeblock. Keep line numbering and format (like code in the middle of the text) intact.`;
const DEFAULT_REFERENCE_PROMPT = `After translating, add a final section titled exactly "Reference:" summarizing terminology, phrasing choices, and character voice/tone notes established in this batch, so they can be reused for consistency later. Keep it concise, bullet-point style, and make it a self-contained summary (not just what changed).`;

const $ = id => document.getElementById(id);
const escapeHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const sanitizeName = s => String(s || '').replace(/[^\p{L}\p{N}_\-\.]/gu, '_');
const isJapanese = s => /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(s);
const baseName = p => String(p || '').replace(/\\/g, '/').split('/').pop();
const isTrans = l => !!l.is_translated;
const snapshot = () => ({ lines: JSON.parse(JSON.stringify(State.lines)), selected: new Set(State.selected) });
const makeProjId = () => 'proj_' + Date.now() + '.cstl';
const makeEpubId = () => 'epub_' + Date.now() + '.epub';

const SETTINGS_FIELDS = [
  { id: 'settingsIgnoreNameCheck', key: 'ignoreName', type: 'check', def: false },
  { id: 'settingsPromptCheck', key: 'promptEnabled', type: 'check', def: true },
  { id: 'settingsJumpToContextCheck', key: 'jumpToContext', type: 'check', def: false },
  { id: 'settingsHideToolsCheck', key: 'hideTools', type: 'check', def: false },
  { id: 'settingsPromptInput', key: 'prompt', type: 'value', def: DEFAULT_PROMPT },
  { id: 'settingsEpubTagsInput', key: 'epubTags', type: 'value', def: 'p' }
];

const PROOFREAD_FIELDS = [
  { id: 'proofreadScope', key: 'prScope', type: 'value', def: 'all' },
  { id: 'proofreadRegexCheck', key: 'prRegex', type: 'check', def: false },
  { id: 'proofreadCaseCheck', key: 'prCase', type: 'check', def: false },
  { id: 'proofreadExactCheck', key: 'prExact', type: 'check', def: false },
  { id: 'proofreadTranslatedOnlyCheck', key: 'prTranslatedOnly', type: 'check', def: false }
];

const DROPDOWNS = [
  { trigger: 'btnImportMain', panel: 'importDropdown', group: 'importGroup' },
  { trigger: 'btnCopyAllNames', panel: 'copyNamesDropdown', group: 'copyNamesGroup' }
];

const MODAL_CLOSE_MS = 180;
const TOAST_TIMEOUT_MS = 3000;
const SAVED_TIMEOUT_MS = 1800;

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

function decodeBuffer(buf) {
  for (const enc of ['utf-8', 'shift_jis', 'windows-31j', 'cp932']) {
    try { return new TextDecoder(enc, { fatal: true }).decode(buf); } catch {}
  }
  return new TextDecoder('utf-8').decode(buf);
}

function normalizeLine(l) {
  const clean = v => v == null ? null : String(v).replace(/\r?\n/g, '\\n').trim();
  return {
    line_num: Number(l.line_num),
    file: String(l.file),
    name: clean(l.name),
    message: String(l.message || '').replace(/\r?\n/g, '\\n').trim(),
    trans_name: clean(l.trans_name),
    trans_message: clean(l.trans_message),
    is_translated: Boolean(l.is_translated)
  };
}

function defaultProjectData(name) {
  return {
    version: VERSION,
    projectName: name,
    projectType: 'uninitialized',
    epubTags: 'p',
    epubSourceId: null,
    updatedAt: Date.now(),
    imported_files: [],
    lines: [],
    prompt_header: State.prompt,
    ignoreNameTranslation: false,
    promptEnabled: true,
    referenceEnabled: false,
    referencePrompt: DEFAULT_REFERENCE_PROMPT,
    reference: '',
    vndbEnabled: false,
    vndbId: '',
    vndbGlossary: [],
    customEnabled: false,
    customRaw: '',
    jumpToContext: false,
    hideTools: false
  };
}

function download(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function withBusyCursor(asyncFn) {
  document.body.style.cursor = 'wait';
  return Promise.resolve(asyncFn()).finally(() => { document.body.style.cursor = 'default'; });
}

const State = {
  projectId: null,
  projectName: '',
  projectType: 'uninitialized',
  epubTags: 'p',
  epubSourceId: null,
  lines: [],
  files: [],
  prompt: DEFAULT_PROMPT,
  ignoreName: false,
  promptEnabled: true,
  referenceEnabled: false,
  referencePrompt: DEFAULT_REFERENCE_PROMPT,
  reference: '',
  vndbEnabled: false,
  vndbId: '',
  vndbGlossary: [],
  customEnabled: false,
  customRaw: '',
  jumpToContext: false,
  hideTools: false,
  prScope: 'all',
  prRegex: false,
  prCase: false,
  prExact: false,
  prTranslatedOnly: false,
  undo: null,
  redo: null,
  selected: new Set(),
  rows: [],
  byNum: new Map(),
  fileLines: new Map(),
  matches: [],
  saveTimer: null,
  translatedCount: 0,
  namesDirty: true
};

State.toData = () => ({
  version: VERSION,
  projectName: State.projectName,
  projectType: State.projectType,
  epubTags: State.epubTags,
  epubSourceId: State.epubSourceId,
  imported_files: State.files,
  lines: State.lines,
  prompt_header: State.prompt,
  ignoreNameTranslation: State.ignoreName,
  promptEnabled: State.promptEnabled,
  referenceEnabled: State.referenceEnabled,
  referencePrompt: State.referencePrompt,
  reference: State.reference,
  vndbEnabled: State.vndbEnabled,
  vndbId: State.vndbId,
  vndbGlossary: State.vndbGlossary,
  customEnabled: State.customEnabled,
  customRaw: State.customRaw,
  jumpToContext: State.jumpToContext,
  hideTools: State.hideTools,
  proofreadScope: State.prScope,
  proofreadRegex: State.prRegex,
  proofreadCaseSensitive: State.prCase,
  proofreadExactMatch: State.prExact,
  proofreadTranslatedOnly: State.prTranslatedOnly
});

State.updateCount = () => {
  State.translatedCount = State.lines.filter(isTrans).length;
};

State.rebuild = () => {
  State.byNum.clear();
  State.fileLines.clear();
  State.rows = [];
  const grouped = new Map(State.files.map(f => [f, []]));
  State.lines.forEach(l => {
    State.byNum.set(l.line_num, l);
    if (grouped.has(l.file)) grouped.get(l.file).push(l);
  });
  for (const [file, lines] of grouped.entries()) {
    State.fileLines.set(file, lines);
    if (lines.length) {
      State.rows.push({ type: 'header', file });
      lines.forEach(l => State.rows.push({ type: 'line', line: l }));
    }
  }
};

State.queueSave = () => {
  if (!State.projectId) return;
  clearTimeout(State.saveTimer);
  State.saveTimer = setTimeout(() => {
    const idle = window.requestIdleCallback || (fn => setTimeout(fn, 0));
    idle(() => { Storage.save(State.projectId, State.toData()).then(() => App.flashSaved()); });
  }, 500);
};

const Storage = {
  root: () => navigator.storage.getDirectory(),

  async save(id, data) {
    try {
      data.updatedAt = Date.now();
      const root = await Storage.root();
      const h = await root.getFileHandle(id, { create: true });
      const w = await h.createWritable();
      await w.write(JSON.stringify(data));
      await w.close();
    } catch { App.flash('Gagal menyimpan ke storage!'); }
  },

  async list() {
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
          updatedAt: data.updatedAt || f.lastModified,
          fileCount: data.imported_files?.length || 0,
          lineCount: data.lines?.length || 0,
          translatedCount: data.lines?.filter(l => l.is_translated).length || 0,
          data
        });
      } catch {}
    }
    return items.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async remove(id, epubId) {
    const root = await Storage.root();
    if (epubId) { try { await root.removeEntry(epubId); } catch {} }
    await root.removeEntry(id);
  }
};

class Scroller {
  constructor(viewport, container, create, update) {
    this.vp = viewport;
    this.container = container;
    this.create = create;
    this.update = update;
    this.items = [];
    this.heights = new Float32Array(0);
    this.pos = new Float32Array(0);
    this.els = [];
    this.indices = [];
    this.defaultH = 80;
    this.gap = 8;
    this.topPad = 8;
    this.botPad = 12;
    this.overscan = 12;
    this.scrollTop = 0;
    this.totalH = 0;
    this.scheduled = false;
    this.lastW = 0;
    this.lastH = 0;
    this.raf = 0;

    viewport.addEventListener('scroll', () => {
      this.scrollTop = viewport.scrollTop;
      this.schedule();
    }, { passive: true });

    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(() => {
        const w = viewport.clientWidth, h = viewport.clientHeight;
        if (w === this.lastW && h === this.lastH) return;
        this.lastW = w; this.lastH = h;
        this.invalidate();
        this.schedule();
      });
      this.ro.observe(viewport);
      this.lastW = viewport.clientWidth;
      this.lastH = viewport.clientHeight;
    }
  }

  schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => { this.scheduled = false; this.render(); });
  }

  setItems(items, keep = false) {
    const prev = keep ? this.vp.scrollTop : 0;
    const keepH = keep && this.heights.length === items.length;
    this.items = items;
    this.heights = keepH ? this.heights : new Float32Array(items.length);
    if (!keepH) {
      for (let i = 0; i < items.length; i++) {
        this.heights[i] = items[i]?.type === 'header' ? 32 : this.defaultH;
      }
    }
    this.pos = new Float32Array(items.length);
    this.updatePos();
    if (keep) {
      const max = Math.max(0, this.totalH - this.vp.clientHeight);
      this.vp.scrollTop = Math.min(prev, max);
    } else {
      this.vp.scrollTop = 0;
    }
    this.scrollTop = this.vp.scrollTop;
    this.invalidate();
    this.render();
  }

  invalidate() {
    for (let i = 0; i < this.indices.length; i++) this.indices[i] = -1;
  }

  updatePos() {
    let cur = this.topPad;
    const n = this.items.length;
    for (let i = 0; i < n; i++) {
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
      const end = this.pos[mid] + this.heights[mid];
      if (end <= scrollTop) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  findEnd(start, vh) {
    let i = start, acc = 0;
    while (i < this.items.length && acc < vh) { acc += this.heights[i]; i++; }
    return i;
  }

  render() {
    let rerenders = 0, more = false;
    while (rerenders < 5) {
      more = this._render();
      if (!more) break;
      rerenders++;
    }
    if (more) this.schedule();
  }

  _render() {
    if (!this.items.length) {
      for (let i = 0; i < this.els.length; i++) {
        this.els[i].style.transform = 'translateY(-9999px)';
        this.indices[i] = -1;
      }
      this.container.style.height = '0px';
      this.totalH = 0;
      return false;
    }
    let vh = this.vp.clientHeight || 800;
    if (vh === 0) vh = 800;
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

    let updated = false;
    for (let i = 0; i < need; i++) {
      const di = rStart + i;
      if (this.indices[i] !== di) {
        this.update(this.els[i], this.items[di], di);
        this.indices[i] = di;
        this.els[i]._measure = true;
        updated = true;
      }
    }

    for (let i = 0; i < need; i++) {
      const di = rStart + i;
      this.els[i].style.transform = `translateY(${this.pos[di]}px)`;
    }

    for (let i = need; i < this.els.length; i++) {
      if (this.indices[i] !== -1) {
        this.els[i].style.transform = 'translateY(-9999px)';
        this.indices[i] = -1;
      }
    }

    let heightsChanged = false, adjust = 0;
    if (updated) {
      for (let i = 0; i < need; i++) {
        const el = this.els[i];
        if (!el._measure) continue;
        el._measure = false;
        const di = rStart + i;
        const h = el.offsetHeight;
        if (h === 0) continue;
        const hdr = this.items[di]?.type === 'header';
        const total = hdr ? h : h + this.gap;
        if (Math.abs(total - this.heights[di]) > 1) {
          const diff = total - this.heights[di];
          if (this.pos[di] < scrollTop) adjust += diff;
          this.heights[di] = total;
          heightsChanged = true;
        }
      }
    }

    if (heightsChanged) {
      this.updatePos();
      if (adjust !== 0) {
        this.vp.scrollTop += adjust;
        this.scrollTop = this.vp.scrollTop;
      }
      for (let i = 0; i < need; i++) {
        const di = rStart + i;
        this.els[i].style.transform = `translateY(${this.pos[di]}px)`;
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
    const target = this.pos[idx] || 0;
    this.vp.scrollTop = Math.max(0, target - (vh / 2) + (this.heights[idx] / 2));
    this.scrollTop = this.vp.scrollTop;
    this.render();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const t = this.pos[idx] || 0;
      this.vp.scrollTop = Math.max(0, t - (vh / 2) + (this.heights[idx] / 2));
      this.scrollTop = this.vp.scrollTop;
      this.render();
    });
  }

  forceUpdate() { this.invalidate(); this.render(); }
}

const Importer = {
  parseJson(arr, file, start) {
    if (!Array.isArray(arr)) throw new Error(`File ${file} bukan array JSON.`);
    return arr.filter(e => e && typeof e === 'object' && Object.hasOwn(e, 'message')).map(e => ({
      line_num: start++,
      file,
      name: e.name == null ? null : String(e.name).replace(/\r?\n/g, '\\n').trim(),
      message: String(e.message || '').replace(/\r?\n/g, '\\n').trim(),
      trans_name: null,
      trans_message: null,
      is_translated: false
    }));
  },

  assertProjectType(expected) {
    if (State.projectType !== 'uninitialized' && State.projectType !== expected) {
      const cur = State.projectType.toUpperCase();
      const want = expected.toUpperCase();
      alert(`Project ini sudah diatur sebagai project ${cur}. Tidak bisa mencampur file ${want}.`);
      return false;
    }
    if (State.projectType === 'uninitialized') State.projectType = expected;
    return true;
  },

  async importEpub(f, ctx) {
    if (!Importer.assertProjectType('epub')) return;
    if (State.projectType === 'epub' && State.epubSourceId) {
      alert('Project ini sudah memuat EPUB.');
      return;
    }
    if (!State.epubSourceId) {
      State.projectType = 'epub';
      State.epubSourceId = makeEpubId();
    }
    const root = await Storage.root();
    const h = await root.getFileHandle(State.epubSourceId, { create: true });
    const w = await h.createWritable();
    await w.write(f);
    await w.close();

    const zip = new window.JSZip();
    await zip.loadAsync(f);
    const container = await zip.file('META-INF/container.xml').async('text');
    const rootFile = new DOMParser().parseFromString(container, 'application/xml').querySelector('rootfile');
    if (!rootFile) throw new Error('EPUB tidak valid.');

    const opfPath = decodeURIComponent(rootFile.getAttribute('full-path'));
    const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/')) + '/' : '';
    const opf = new DOMParser().parseFromString(await zip.file(opfPath).async('text'), 'application/xml');
    const manifest = {};
    Array.from(opf.querySelectorAll('manifest > item')).forEach(it => {
      manifest[it.getAttribute('id')] = decodeURIComponent(it.getAttribute('href'));
    });
    const htmls = Array.from(opf.querySelectorAll('spine > itemref'))
      .map(it => manifest[it.getAttribute('idref')] ? opfDir + manifest[it.getAttribute('idref')] : null)
      .filter(Boolean);
    const tags = State.epubTags || 'p';

    for (const path of htmls) {
      if (ctx.existing.has(path)) { ctx.skipped.push(path); continue; }
      const entry = zip.file(path);
      if (!entry) continue;
      const doc = new DOMParser().parseFromString(await entry.async('text'), path.endsWith('.xhtml') ? 'application/xhtml+xml' : 'text/html');
      let has = false;
      Array.from(doc.querySelectorAll(tags)).forEach(el => {
        const txt = el.textContent.replace(/\r?\n/g, ' ').trim();
        if (txt) {
          ctx.imported.push({ line_num: ctx.cur++, file: path, name: null, message: txt, trans_name: null, trans_message: null, is_translated: false });
          has = true;
        }
      });
      if (has) ctx.existing.add(path);
    }
  },

  async importJsonFile(f, ctx) {
    if (!Importer.assertProjectType('json')) return;
    const bn = baseName(f.name);
    if (ctx.existing.has(bn)) { ctx.skipped.push(bn); return; }
    const parsed = Importer.parseJson(JSON.parse(decodeBuffer(await f.arrayBuffer())), bn, ctx.cur);
    if (parsed.length) { ctx.existing.add(bn); ctx.imported.push(...parsed); ctx.cur += parsed.length; }
  },

  async process(input, isZip = false) {
    App.flash('Memproses file...', true);
    await withBusyCursor(async () => {
      try {
        const ctx = {
          cur: State.lines.length ? State.lines.reduce((m, l) => Math.max(m, l.line_num), 0) + 1 : 1,
          imported: [],
          existing: new Set(State.files),
          skipped: []
        };

        if (isZip && input instanceof File && window.JSZip) {
          if (!Importer.assertProjectType('json')) {
            $('copyStatus').classList.add('empty');
            return;
          }
          const zip = new window.JSZip();
          await zip.loadAsync(input);
          const names = Object.keys(zip.files).filter(n => n.endsWith('.json'))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
          for (const name of names) {
            const bn = baseName(name);
            if (ctx.existing.has(bn)) { ctx.skipped.push(bn); continue; }
            const json = JSON.parse(decodeBuffer(await zip.file(name).async('uint8array')));
            const parsed = Importer.parseJson(json, bn, ctx.cur);
            if (parsed.length) { ctx.existing.add(bn); ctx.imported.push(...parsed); ctx.cur += parsed.length; }
          }
        } else {
          const files = Array.from(input).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
          for (const f of files) {
            if (f.name.toLowerCase().endsWith('.epub')) await Importer.importEpub(f, ctx);
            else if (f.name.toLowerCase().endsWith('.json')) await Importer.importJsonFile(f, ctx);
          }
        }

        if (ctx.imported.length) {
          State.lines.push(...ctx.imported);
          State.files = Array.from(ctx.existing);
          State.namesDirty = true;
          App.refresh(true);
          State.queueSave();
          App.flash(`Berhasil impor ${ctx.imported.length} baris.${ctx.skipped.length ? ` (${ctx.skipped.length} file duplikat diabaikan)` : ''}`);
        } else if (ctx.skipped.length) {
          $('copyStatus').classList.add('empty');
          setTimeout(() => alert(`Gagal impor: File duplikat.\n- ${ctx.skipped.slice(0, 5).join('\n- ')}`), 10);
        } else {
          App.flash('Tidak ada data valid.', false);
        }
      } catch (e) {
        $('copyStatus').classList.add('empty');
        setTimeout(() => alert(`Error:\n${e.message}`), 10);
      }
    });
  }
};

const Exporter = {
  async runEpub() {
    App.flash('Membuat EPUB...', true);
    await withBusyCursor(async () => {
      try {
        const root = await Storage.root();
        const h = await root.getFileHandle(State.epubSourceId);
        const f = await h.getFile();
        const zip = new window.JSZip();
        await zip.loadAsync(f);

        const byFile = {};
        State.lines.forEach(l => { (byFile[l.file] ||= []).push(l); });
        const tags = State.epubTags || 'p';

        for (const [path, lines] of Object.entries(byFile)) {
          const entry = zip.file(path);
          if (!entry) continue;
          const html = await entry.async('text');
          const xmlMatch = html.match(/^<\?xml.*?\?>/i);
          const doc = new DOMParser().parseFromString(html, path.endsWith('.xhtml') ? 'application/xhtml+xml' : 'text/html');
          let idx = 0;
          Array.from(doc.querySelectorAll(tags)).forEach(el => {
            if (el.textContent.replace(/\r?\n/g, ' ').trim() === '') return;
            const l = lines[idx++];
            if (l && isTrans(l) && l.trans_message) el.textContent = l.trans_message;
          });
          let out = new XMLSerializer().serializeToString(doc);
          if (xmlMatch && !out.startsWith('<?xml')) out = xmlMatch[0] + '\n' + out;
          zip.file(path, out);
        }

        if (zip.file('mimetype')) {
          zip.file('mimetype', await zip.file('mimetype').async('text'), { compression: 'STORE' });
        }

        const url = URL.createObjectURL(await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
        download(url, `${sanitizeName(State.projectName)}_tl.epub`);
        App.flash('Ekspor EPUB berhasil!');
      } catch (e) {
        alert('Ekspor EPUB gagal: ' + e.message);
      }
    });
  },

  async runJson() {
    const grouped = new Map();
    State.lines.forEach(l => {
      if (!grouped.has(l.file)) grouped.set(l.file, []);
      grouped.get(l.file).push(l);
    });

    const results = Array.from(grouped.entries()).map(([file, lines]) => ({
      name: `${file.replace(/\.(xhtml|html|json)$/g, '')}.json`,
      content: JSON.stringify(lines.map(l => {
        const out = {};
        const n = isTrans(l) ? (l.trans_name || l.name) : l.name;
        const m = isTrans(l) ? l.trans_message : l.message;
        if (n != null) out.name = n.replace(/\\n/g, '\n');
        out.message = m != null ? m.replace(/\\n/g, '\n') : '';
        return out;
      }), null, 2)
    }));

    if (window.JSZip && results.length > 1) {
      const zip = new window.JSZip();
      results.forEach(r => zip.file(r.name, r.content));
      const url = URL.createObjectURL(await zip.generateAsync({ type: 'blob', mimeType: 'application/octet-stream', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
      download(url, `${sanitizeName(State.projectName)}_export.zip`);
    } else {
      results.forEach(r => {
        const url = URL.createObjectURL(new Blob([r.content], { type: 'application/json' }));
        download(url, r.name);
      });
    }
  },

  async run() {
    if (!State.lines.length) return;
    if (State.projectType === 'epub' && State.epubSourceId) await Exporter.runEpub();
    else await Exporter.runJson();
  }
};

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

const positionDropdown = (panelId) => {
  const triggerMap = { importDropdown: 'btnImportMain', copyNamesDropdown: 'btnCopyAllNames' };
  const trigger = $(triggerMap[panelId]);
  const dropdown = $(panelId);
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
};

const closeDropdowns = () => {
  for (const { panel } of DROPDOWNS) $(panel)?.classList.remove('show');
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

  flash(msg, keep = false) {
    const el = $('copyStatus');
    el.textContent = msg;
    el.classList.remove('empty');
    const t = ++App.toastToken;
    if (!keep) setTimeout(() => { if (App.toastToken === t) el.classList.add('empty'); }, TOAST_TIMEOUT_MS);
  },

  toggleModal(el, show) {
    if (show) { el.classList.remove('closing'); el.classList.add('open'); }
    else {
      el.classList.add('closing');
      el.classList.remove('open');
      setTimeout(() => el.classList.remove('closing'), MODAL_CLOSE_MS);
    }
  },

  anyModalOpen() { return document.querySelectorAll('.backdrop.open').length > 0; },

  topModal() {
    const arr = Array.from(document.querySelectorAll('.backdrop.open'));
    if (!arr.length) return null;
    return arr.sort((a, b) => (parseInt(getComputedStyle(b).zIndex) || 0) - (parseInt(getComputedStyle(a).zIndex) || 0))[0];
  },

  debounce(fn, ms = 200) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  },

  flashRow(n, delay = 50) {
    setTimeout(() => {
      const el = $('previewContainer').querySelector(`input[data-num="${n}"]`)?.closest('.preview-row');
      if (el) { el.classList.add('row-flash'); setTimeout(() => el.classList.remove('row-flash'), 800); }
    }, delay);
  },

  async createProject() {
    const name = prompt('Nama project baru:')?.trim();
    if (!name) return;
    const id = makeProjId();
    const data = defaultProjectData(name);
    await Storage.save(id, data);
    App.open(id, data);
  },

  async init() {
    if (!navigator.storage?.getDirectory) {
      $('projectList').innerHTML = `<p class="hint" style="grid-column:1/-1;color:var(--danger);">Browser tidak mendukung OPFS.</p>`;
      return;
    }
    App.main = new Scroller($('previewViewport'), $('previewContainer'), App.createMainRow, App.updateMainRow);
    App.pr = new Scroller($('proofreadContainer').closest('.proofread-results-wrap'), $('proofreadContainer'), App.createPrRow, App.updatePrRow);
    App.bind();
    await App.loadDashboard();
  },

  bind() {
    $('btnNewProject').addEventListener('click', App.createProject);
    $('btnBackToDashboard').addEventListener('click', App.closeProject);
    $('btnRestoreProject').addEventListener('click', () => $('restoreProjectInput').click());
    $('restoreProjectInput').addEventListener('change', App.restoreProject);
    $('btnDashboardSettings').addEventListener('click', () => App.toggleModal($('dashboardSettingsModal'), true));
    $('btnDashboardSettingsClose').addEventListener('click', () => App.toggleModal($('dashboardSettingsModal'), false));
    $('btnBackupAll').addEventListener('click', App.backupAll);
    $('btnWipeAllData').addEventListener('click', App.wipeAllData);

    document.addEventListener('click', e => {
      for (const { trigger, panel } of DROPDOWNS) {
        if (e.target.closest(`#${trigger}`)) {
          e.preventDefault();
          const willShow = !$(panel).classList.contains('show');
          closeDropdowns();
          if (willShow) {
            positionDropdown(panel);
            $(panel).classList.add('show');
          }
          return;
        }
      }
      const insideAny = DROPDOWNS.some(({ group }) => e.target.closest(`#${group}`));
      if (!insideAny) closeDropdowns();
      const bd = e.target.closest('.backdrop.open');
      if (bd && e.target === bd) App.toggleModal(bd, false);
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        if (App.anyModalOpen()) {
          const m = App.topModal();
          if (m) App.toggleModal(m, false);
        } else {
          closeDropdowns();
        }
      }
    });

    $('dynamicToolbarWrap').addEventListener('scroll', closeDropdowns, { passive: true });
    window.addEventListener('scroll', closeDropdowns, true);
    window.addEventListener('resize', closeDropdowns);

    const importInputs = [$('importFileInput'), $('importFolderInput'), $('importZipInput')];
    ['btnImportFile', 'btnImportFolder', 'btnImportZip'].forEach((id, i) => {
      const input = importInputs[i];
      $(id).addEventListener('click', () => {
        closeDropdowns();
        input.click();
      });
      input.addEventListener('change', async e => {
        if (!e.target.files.length) return;
        await Importer.process(id === 'btnImportZip' ? e.target.files[0] : e.target.files, id === 'btnImportZip');
        e.target.value = '';
      });
    });

    $('btnExport').addEventListener('click', () => { Exporter.run(); });
    $('btnCopyForAi').addEventListener('click', App.copyForAi);
    $('btnApply').addEventListener('click', App.applyTranslation);
    $('btnUndo').addEventListener('click', App.undo);
    $('btnRedo').addEventListener('click', App.redo);
    $('btnProofread').addEventListener('click', () => { App.openProofread(); });

    $('btnSelectAll').addEventListener('click', () => {
      State.lines.forEach(l => { if (!isTrans(l)) State.selected.add(l.line_num); });
      App.syncCheckboxes();
    });
    $('btnClearSelection').addEventListener('click', () => { State.selected.clear(); App.syncCheckboxes(); });
    $('btnSelectRange').addEventListener('click', App.selectRange);

    $('btnGlossary').addEventListener('click', () => {
      $('glossaryVndbCheck').checked = State.vndbEnabled;
      $('glossaryVndbIdInput').value = State.vndbId || '';
      App.tmpVndb = [...State.vndbGlossary];
      $('glossaryVndbPreviewArea').value = App.tmpVndb.map(g => `${g[0]}: ${g[1]}`).join('\n');
      $('glossaryVndbWrap').classList.toggle('section-disabled', !State.vndbEnabled);
      $('glossaryVndbIdInput').disabled = $('btnGlossaryVndbFetch').disabled = App.tmpVndb.length > 0;
      $('glossaryCustomCheck').checked = State.customEnabled;
      $('glossaryCustomInput').value = State.customRaw || '';
      $('glossaryCustomWrap').classList.toggle('section-disabled', !State.customEnabled);
      App.toggleModal($('glossaryModal'), true);
    });

    $('btnSettings').addEventListener('click', () => {
      App.syncSettingsModal();
      App.toggleModal($('settingsModal'), true);
    });

    $('btnContext').addEventListener('click', () => {
      $('referenceEnabledCheck').checked = State.referenceEnabled;
      $('referencePromptInput').value = State.referencePrompt || DEFAULT_REFERENCE_PROMPT;
      $('referenceStoredInput').value = State.reference || '';
      $('referenceWrap').classList.toggle('section-disabled', !State.referenceEnabled);
      App.toggleModal($('contextModal'), true);
    });

    $('referenceEnabledCheck').addEventListener('change', e => {
      $('referenceWrap').classList.toggle('section-disabled', !e.target.checked);
    });

    $('btnReferenceReset').addEventListener('click', () => {
      $('referenceEnabledCheck').checked = false;
      $('referencePromptInput').value = DEFAULT_REFERENCE_PROMPT;
      $('referenceStoredInput').value = '';
      $('referenceWrap').classList.add('section-disabled');
    });

    $('btnContextCancel').addEventListener('click', () => App.toggleModal($('contextModal'), false));
    $('btnContextSave').addEventListener('click', () => {
      State.referenceEnabled = $('referenceEnabledCheck').checked;
      State.referencePrompt = $('referencePromptInput').value.trim() || DEFAULT_REFERENCE_PROMPT;
      State.reference = $('referenceStoredInput').value.trim();
      App.toggleModal($('contextModal'), false);
      State.queueSave();
    });

    $('btnSettingsDasarReset').addEventListener('click', () => App.resetSettingsModal('dasar'));
    $('btnSettingsPromptReset').addEventListener('click', () => { $('settingsPromptInput').value = DEFAULT_PROMPT; });
    $('btnSettingsEpubReset').addEventListener('click', () => { $('settingsEpubTagsInput').value = 'p'; });
    $('btnSettingsCancel').addEventListener('click', () => App.toggleModal($('settingsModal'), false));
    $('btnSettingsSave').addEventListener('click', () => {
      SETTINGS_FIELDS.forEach(({ id, key, type }) => {
        const v = type === 'check' ? $(id).checked : $(id).value.trim() || 'p';
        State[key] = v;
      });
      App.applyHideTools();
      App.toggleModal($('settingsModal'), false);
      State.queueSave();
    });

    $('glossaryVndbCheck').addEventListener('change', e => {
      $('glossaryVndbWrap').classList.toggle('section-disabled', !e.target.checked);
    });

    $('btnGlossaryVndbFetch').addEventListener('click', async () => {
      let id = $('glossaryVndbIdInput').value.trim();
      if (!id) return;
      if (!id.startsWith('v')) id = 'v' + id;
      const status = $('glossaryVndbStatus');
      try {
        $('btnGlossaryVndbFetch').disabled = $('glossaryVndbIdInput').disabled = true;
        status.textContent = 'Mengambil data...';
        status.className = 'toast info';
        const chars = await Vndb.fetchCharacters(id);
        if (!chars.length) throw new Error('Karakter tidak ditemukan.');
        App.tmpVndb = Vndb.buildGlossary(chars);
        $('glossaryVndbPreviewArea').value = App.tmpVndb.map(g => `${g[0]}: ${g[1]}`).join('\n');
        status.textContent = `Ditemukan ${App.tmpVndb.length} entri.`;
        status.className = 'toast success';
      } catch (e) {
        status.textContent = e.message;
        status.className = 'toast error';
        $('btnGlossaryVndbFetch').disabled = $('glossaryVndbIdInput').disabled = false;
      }
    });

    $('btnGlossaryVndbReset').addEventListener('click', () => {
      $('glossaryVndbCheck').checked = false;
      $('glossaryVndbIdInput').value = '';
      $('glossaryVndbPreviewArea').value = '';
      App.tmpVndb = [];
      $('glossaryVndbStatus').className = 'toast empty mb-2';
      $('glossaryVndbIdInput').disabled = $('btnGlossaryVndbFetch').disabled = false;
      $('glossaryVndbWrap').classList.add('section-disabled');
    });

    $('glossaryCustomCheck').addEventListener('change', e => {
      $('glossaryCustomWrap').classList.toggle('section-disabled', !e.target.checked);
    });

    $('btnGlossaryCustomReset').addEventListener('click', () => {
      $('glossaryCustomCheck').checked = false;
      $('glossaryCustomInput').value = '';
      $('glossaryCustomWrap').classList.add('section-disabled');
    });

    $('btnGlossaryCancel').addEventListener('click', () => App.toggleModal($('glossaryModal'), false));
    $('btnGlossarySave').addEventListener('click', () => {
      State.vndbEnabled = $('glossaryVndbCheck').checked;
      State.vndbId = $('glossaryVndbIdInput').value.trim();
      State.vndbGlossary = App.tmpVndb;
      State.customEnabled = $('glossaryCustomCheck').checked;
      State.customRaw = $('glossaryCustomInput').value.trim();
      App.toggleModal($('glossaryModal'), false);
      State.queueSave();
    });

    $('btnLineCancel').addEventListener('click', () => App.toggleModal($('lineEditorModal'), false));
    $('btnLineSave').addEventListener('click', App.saveLineEditor);
    $('btnProofreadClose').addEventListener('click', () => App.toggleModal($('proofreadModal'), false));

    $('btnProofreadReset').addEventListener('click', () => {
      $('proofreadSearchInput').value = '';
      $('proofreadReplaceInput').value = '';
      PROOFREAD_FIELDS.forEach(({ id, def, type }) => {
        const el = $(id);
        if (type === 'check') el.checked = def;
        else el.value = def;
      });
      App.syncProofread();
      App.renderProofread();
    });

    $('btnProofreadReplaceAll').addEventListener('click', App.replaceAll);

    const delayed = App.debounce(App.renderProofread, 200);
    $('proofreadSearchInput').addEventListener('input', delayed);
    PROOFREAD_FIELDS.forEach(({ id }) => {
      $(id).addEventListener('change', () => { App.syncProofread(); App.renderProofread(); });
    });

    $('previewContainer').addEventListener('change', e => {
      if (e.target.closest('.checkbox-cell') && e.target.type === 'checkbox') {
        const n = Number(e.target.dataset.num);
        if (e.target.checked) State.selected.add(n); else State.selected.delete(n);
        App.syncCheckboxes();
      } else if (e.target.matches('.file-header-inner input[type="checkbox"][data-file]')) {
        App.toggleFileSelection(e.target);
      }
    });

    $('stickyFileCheckbox').addEventListener('change', e => {
      if (e.target.dataset.file) App.toggleFileSelection(e.target);
    });

    $('previewContainer').addEventListener('click', e => {
      if (e.target.matches('input[type="checkbox"]')) return;
      const wrap = e.target.closest('.text-content');
      if (wrap) {
        const row = wrap.closest('.preview-row');
        if (row && !row.classList.contains('file-header')) {
          const cb = row.querySelector('input[type="checkbox"]');
          if (cb?.dataset.num) App.openLineEditor(Number(cb.dataset.num));
        }
      }
    });

    let raf = 0;
    $('previewViewport').addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; App.updateFileBadge(); });
    }, { passive: true });

    $('proofreadContainer').addEventListener('click', e => {
      const wrap = e.target.closest('.text-content');
      if (wrap?.dataset.num) {
        const n = Number(wrap.dataset.num);
        if (State.jumpToContext) {
          App.toggleModal($('proofreadModal'), false);
          const idx = State.rows.findIndex(r => r.type === 'line' && r.line.line_num === n);
          if (idx !== -1) {
            App.main.scrollToIndex(idx);
            App.flashRow(n, 60);
          }
        } else {
          App.openLineEditor(n);
        }
      }
    });

    $('nameTableBody').addEventListener('click', async e => {
      if (e.target.tagName === 'TD') {
        try { await clipboard(e.target.textContent); App.flash('Nama disalin!'); }
        catch { alert('Gagal disalin.'); }
      }
    });

    $('btnCopyNamesPlain').addEventListener('click', () => App.copyAllNames('plain'));
    $('btnCopyNamesWithGlossary').addEventListener('click', () => App.copyAllNames('glossary'));
    $('btnCopyNamesMissingGlossary').addEventListener('click', () => App.copyAllNames('missing'));
  },

  syncSettingsModal() {
    SETTINGS_FIELDS.forEach(({ id, key, type, def }) => {
      const v = State[key] ?? def;
      if (type === 'check') $(id).checked = v;
      else $(id).value = v;
    });
  },

  resetSettingsModal(group) {
    const filter = group === 'dasar' ? f => f.type === 'check' : null;
    if (!filter) return;
    SETTINGS_FIELDS.filter(filter).forEach(({ id, def }) => { $(id).checked = def; });
  },

  async buildProjectZip(p) {
    const zip = new window.JSZip();
    const meta = { ...p.data };
    delete meta.lines;
    delete meta.proofreadScope;
    delete meta.proofreadRegex;
    delete meta.proofreadCaseSensitive;
    delete meta.proofreadExactMatch;
    delete meta.proofreadTranslatedOnly;
    zip.file('metadata.json', JSON.stringify(meta));

    let orig = '', trans = '', names = '';
    for (const file of (p.data.imported_files || [])) {
      orig += `<filename>${file}</filename>\n`;
      trans += `<filename>${file}</filename>\n`;
      names += `<filename>${file}</filename>\n`;
      p.data.lines.filter(l => l.file === file).forEach(l => {
        orig += `${l.message || ''}\n`;
        trans += `${l.trans_message || ''}\n`;
        names += ((l.name || '') || (l.trans_name || '')) ? `<original>${l.name || ''}</original><translate>${l.trans_name || ''}</translate>\n` : '\n';
      });
    }
    zip.file('original.txt', orig);
    zip.file('translate.txt', trans);
    zip.file('name.txt', names);

    if (p.data.projectType === 'epub' && p.data.epubSourceId) {
      const root = await Storage.root();
      const h = await root.getFileHandle(p.data.epubSourceId);
      const f = await h.getFile();
      zip.file(p.data.epubSourceId, f);
    }
    return zip;
  },

  async backup(p) {
    await withBusyCursor(async () => {
      try {
        const zip = await App.buildProjectZip(p);
        const url = URL.createObjectURL(await zip.generateAsync({ type: 'blob', mimeType: 'application/octet-stream', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
        download(url, `${sanitizeName(p.name)}_backup.cstl`);
      } catch (e) {
        alert('Gagal backup: ' + e.message);
      }
    });
  },

  async backupAll() {
    await withBusyCursor(async () => {
      try {
        const items = await Storage.list();
        if (!items.length) return alert('Belum ada Project untuk di-backup.');
        const outer = new window.JSZip();
        const used = new Set();
        for (const p of items) {
          const zip = await App.buildProjectZip(p);
          const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });
          const base = sanitizeName(p.name);
          let name = base, i = 2;
          while (used.has(name)) name = `${base}_${i++}`;
          used.add(name);
          outer.file(`${name}_backup.cstl`, blob);
        }
        const url = URL.createObjectURL(await outer.generateAsync({ type: 'blob', mimeType: 'application/octet-stream', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
        download(url, `Semua_Project_Backup_${new Date().toISOString().slice(0, 10)}.zip`);
      } catch (e) {
        alert('Gagal backup semua project: ' + e.message);
      }
    });
  },

  async loadDashboard() {
    const list = $('projectList');
    list.innerHTML = '';
    const content = list.parentElement;
    try {
      const items = await Storage.list();
      if (!items.length) {
        content.classList.add('is-empty');
        list.innerHTML = `<p class="hint" style="grid-column:1/-1;">Belum ada Project. Buat atau Pulihkan!</p>`;
        return;
      }
      content.classList.remove('is-empty');
      items.forEach(p => {
        const card = document.createElement('div');
        card.className = 'project-card';
        const badge = p.fileCount || p.lineCount
          ? (p.data.projectType === 'epub' ? '<span class="badge badge-epub">EPUB</span>'
            : p.data.projectType === 'json' ? '<span class="badge badge-json">JSON-VNTP</span>' : '')
          : '';
        card.innerHTML = `
          <div class="project-card-main">
            <h3>${escapeHtml(p.name)}</h3>
            <div class="project-meta mt-2">
              ${badge ? `<div style="margin-bottom:8px;">${badge}</div>` : ''}
              Diubah: ${new Date(p.updatedAt).toLocaleString('id-ID')}<br>
              File: ${p.fileCount}<br>
              Baris: ${p.translatedCount}/${p.lineCount} (${p.lineCount ? Math.floor(p.translatedCount / p.lineCount * 100) : 0}%)
            </div>
          </div>
          <div class="project-actions">
            <button class="btn btn-primary btn-sm btn-open">Buka</button>
            <button class="btn btn-ghost btn-sm btn-rename">Ubah</button>
            <button class="btn btn-ghost btn-sm btn-backup">Backup</button>
            <button class="btn btn-danger btn-sm btn-delete">Hapus</button>
          </div>
        `;
        card.querySelector('.btn-open').addEventListener('click', () => App.open(p.id, p.data));
        card.querySelector('.btn-rename').addEventListener('click', async () => {
          const name = prompt('Nama baru:', p.name);
          if (name?.trim() && name !== p.name) {
            p.data.projectName = name.trim();
            await Storage.save(p.id, p.data);
            App.loadDashboard();
          }
        });
        card.querySelector('.btn-backup').addEventListener('click', () => App.backup(p));
        card.querySelector('.btn-delete').addEventListener('click', async () => {
          if (confirm('Hapus permanen?')) {
            await Storage.remove(p.id, p.data.epubSourceId);
            App.loadDashboard();
          }
        });
        list.appendChild(card);
      });
    } catch {
      list.innerHTML = `<p class="hint" style="color:var(--danger);">Gagal akses storage.</p>`;
    }
  },

  async restoreProject(e) {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;
    await withBusyCursor(async () => {
      try {
        const zip = new window.JSZip();
        await zip.loadAsync(uploadedFile);
        const metaFile = zip.file('metadata.json');
        const origFile = zip.file('original.txt');
        const transFile = zip.file('translate.txt');
        const nameFile = zip.file('name.txt');
        if (!metaFile || !origFile || !transFile || !nameFile) throw new Error('Format arsip tidak valid.');

        const meta = JSON.parse(await metaFile.async('text'));
        const orig = (await origFile.async('text')).split(/\r?\n/);
        const trans = (await transFile.async('text')).split(/\r?\n/);
        const names = (await nameFile.async('text')).split(/\r?\n/);
        [orig, trans, names].forEach(arr => { if (arr[arr.length - 1] === '') arr.pop(); });
        if (orig.length !== trans.length || orig.length !== names.length) throw new Error('Baris tidak sinkron.');

        const lines = [];
        let file = 'unknown', n = 1;
        for (let i = 0; i < orig.length; i++) {
          const o = orig[i];
          const m = o.match(/^<filename>(.*?)<\/filename>$/);
          if (m) {
            if (trans[i] !== o || names[i] !== o) throw new Error('Header file tidak sinkron.');
            file = m[1];
          } else {
            let on = null, tn = null;
            const nl = names[i].trim();
            if (nl) {
              const om = nl.match(/<original>(.*?)<\/original>/);
              const tm = nl.match(/<translate>(.*?)<\/translate>/);
              on = om ? om[1] : null;
              tn = tm ? tm[1] : null;
            }
            lines.push({
              line_num: n++,
              file,
              name: on,
              message: o,
              trans_name: tn,
              trans_message: trans[i] || null,
              is_translated: !!trans[i]?.trim()
            });
          }
        }

        const name = meta.projectName || uploadedFile.name.replace(/\.cstl$/, '');
        if (meta.projectType === 'epub' && meta.epubSourceId) {
          const entry = zip.file(meta.epubSourceId);
          if (entry) {
            const newId = makeEpubId();
            const root = await Storage.root();
            const h = await root.getFileHandle(newId, { create: true });
            const w = await h.createWritable();
            await w.write(await entry.async('blob'));
            await w.close();
            meta.epubSourceId = newId;
          }
        }

        await Storage.save(makeProjId(), {
          version: VERSION,
          projectName: name,
          projectType: meta.projectType || 'uninitialized',
          epubTags: meta.epubTags || 'p',
          epubSourceId: meta.epubSourceId || null,
          imported_files: meta.imported_files || [],
          lines: lines.map(normalizeLine),
          prompt_header: meta.prompt_header || State.prompt,
          ignoreNameTranslation: meta.ignoreNameTranslation ?? false,
          promptEnabled: meta.promptEnabled ?? true,
          referenceEnabled: meta.referenceEnabled ?? false,
          referencePrompt: meta.referencePrompt || DEFAULT_REFERENCE_PROMPT,
          reference: meta.reference || '',
          vndbEnabled: meta.vndbEnabled ?? false,
          vndbId: meta.vndbId || '',
          vndbGlossary: meta.vndbGlossary || [],
          customEnabled: meta.customEnabled ?? false,
          customRaw: meta.customRaw || '',
          jumpToContext: meta.jumpToContext ?? false,
          hideTools: meta.hideTools ?? false
        });
        await App.loadDashboard();
        alert(`Project "${name}" dipulihkan!`);
      } catch (e) {
        alert('File korup: ' + e.message);
      } finally {
        e.target.value = '';
      }
    });
  },

  open(id, data) {
    State.projectId = id;
    State.projectName = data.projectName || 'Unknown';
    State.projectType = data.projectType || 'uninitialized';
    State.epubTags = data.epubTags || 'p';
    State.epubSourceId = data.epubSourceId || null;
    State.lines = (data.lines || []).map(normalizeLine);
    State.files = data.imported_files || [];
    State.prompt = data.prompt_header || State.prompt;
    State.ignoreName = data.ignoreNameTranslation ?? false;
    State.promptEnabled = data.promptEnabled ?? true;
    State.referenceEnabled = data.referenceEnabled ?? false;
    State.referencePrompt = data.referencePrompt || DEFAULT_REFERENCE_PROMPT;
    State.reference = data.reference || '';
    State.vndbEnabled = data.vndbEnabled ?? false;
    State.vndbId = data.vndbId || '';
    State.vndbGlossary = data.vndbGlossary || [];
    State.customEnabled = data.customEnabled ?? false;
    State.customRaw = data.customRaw || '';
    State.jumpToContext = data.jumpToContext ?? false;
    State.hideTools = data.hideTools ?? false;
    State.prScope = data.proofreadScope || 'all';
    State.prRegex = data.proofreadRegex ?? false;
    State.prCase = data.proofreadCaseSensitive ?? false;
    State.prExact = data.proofreadExactMatch ?? false;
    State.prTranslatedOnly = data.proofreadTranslatedOnly ?? false;
    State.selected.clear();
    State.undo = State.redo = null;
    State.namesDirty = true;

    $('projectNameDisplay').textContent = State.projectName;
    $('dashboardView').classList.remove('open');
    $('workspaceView').style.display = 'flex';
    App.applyHideTools();
    App.refresh(false);
  },

  applyHideTools() {
    const split = document.querySelector('.split');
    if (!split) return;
    split.classList.toggle('hide-tools', State.hideTools);
    if (App.main) requestAnimationFrame(() => { App.main.invalidate(); App.main.render(); });
  },

  async wipeAllData() {
    if (!confirm('Semua project dan data akan dihapus permanen. Lanjutkan?')) return;
    try {
      const root = await navigator.storage.getDirectory();
      for await (const [name] of root.entries()) {
        try { await root.removeEntry(name, { recursive: true }); } catch {}
      }
    } catch {}
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

  closeProject() {
    if (State.saveTimer) {
      clearTimeout(State.saveTimer);
      Storage.save(State.projectId, State.toData()).then(App.finishClose).catch(App.finishClose);
    } else App.finishClose();
  },

  finishClose() {
    State.saveTimer = null;
    State.projectId = null;
    State.epubSourceId = null;
    State.undo = State.redo = null;
    State.projectName = '';
    State.lines = [];
    State.files = [];
    State.rows = [];
    State.matches = [];
    State.selected.clear();
    State.byNum.clear();
    State.fileLines.clear();
    State.translatedCount = 0;
    State.prScope = 'all';
    State.prRegex = State.prCase = State.prExact = false;
    State.prTranslatedOnly = false;
    State.hideTools = false;
    State.namesDirty = true;

    App.main?.setItems([], false);
    App.pr?.setItems([], false);
    $('nameTableBody').replaceChildren();
    $('pasteArea').value = '';
    $('copyStatus').classList.add('empty');
    $('stickyFileName').textContent = '';
    $('stickyFileName').title = '';
    $('stickyFileRange').textContent = '';
    $('stickyFileBar').classList.remove('show', 'swap');
    $('stickyFileCheckbox').checked = false;
    $('stickyFileCheckbox').disabled = true;
    delete $('stickyFileCheckbox').dataset.file;
    App.lastFile = null;
    App.fileCache = null;
    $('workspaceView').style.display = 'none';
    const split = document.querySelector('.split');
    if (split) split.classList.remove('hide-tools');
    $('dashboardView').classList.add('open');
    App.loadDashboard();
  },

  refresh(keep = true) {
    State.updateCount();
    State.rebuild();
    App.main.setItems(State.rows, keep);
    App.updateFileBadge();
    App.updateButtons();
    if (State.namesDirty) { App.renderNames(); State.namesDirty = false; }
    App.updateStatusBar();
    $('btnUndo').disabled = !State.undo;
    $('btnRedo').disabled = !State.redo;
  },

  updateButtons() {
    const has = State.lines.length > 0;
    const sel = State.selected.size > 0;
    $('btnExport').disabled = !has;
    $('btnProofread').disabled = !has;
    $('btnSelectAll').disabled = !has;
    $('pasteArea').disabled = !has;
    $('btnApply').disabled = !has;
    $('rangeFromInput').disabled = !has;
    $('rangeToInput').disabled = !has;
    $('btnSelectRange').disabled = !has;
    $('btnClearSelection').disabled = !sel;
    $('btnCopyForAi').disabled = !sel;
    const n = State.selected.size;
    $('btnCopyForAi').textContent = n > 0 ? `Copy ${n} Baris` : 'Copy';
  },

  updateStatusBar() {
    const total = State.lines.length;
    const tl = State.translatedCount;
    const pct = total ? Math.floor((tl / total) * 100) : 0;
    const mode = State.projectType === 'uninitialized' ? '-' : (State.projectType === 'epub' ? 'EPUB' : 'JSON');
    const fileRaw = State.files.length > 1 ? `${State.files.length} files` : (State.files[0] || '-');
    const file = baseName(fileRaw);
    $('statusBar').textContent = `${mode} · ${file} · ${tl}/${total} (${pct}%)`;
    $('progressFill').style.width = `${pct}%`;
    $('progressText').textContent = `${tl}/${total}`;
  },

  flashSaved() {
    const bar = $('statusBar');
    if (!bar || !State.projectId) return;
    bar.classList.remove('saved');
    void bar.offsetWidth;
    bar.classList.add('saved');
    clearTimeout(App.savedTimer);
    App.savedTimer = setTimeout(() => bar.classList.remove('saved'), SAVED_TIMEOUT_MS);
  },

  updateFileBadge() {
    const bar = $('stickyFileBar');
    const nameEl = $('stickyFileName');
    const rangeEl = $('stickyFileRange');
    const cb = $('stickyFileCheckbox');
    if (!bar || !nameEl || !App.main) return;
    const scrollTop = $('previewViewport').scrollTop;
    const rows = State.rows;
    if (!rows.length) {
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
    let activeFile = null;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].type !== 'header') continue;
      const p = App.main.pos[i];
      const h = App.main.heights[i];
      if (p + h <= scrollTop) activeFile = rows[i].file;
      else break;
    }
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
      if (!isTrans(l)) {
        if (cb.checked) State.selected.add(l.line_num);
        else State.selected.delete(l.line_num);
      }
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
    row._cell = cell;
    row._cb = cb;
    row._orig = orig;
    row._trans = trans;
    row._hdr = hdr;
    row._hCb = hCb;
    row._hName = hName;
    row._hRange = hRange;
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
    State.lines.forEach(l => { if (l.name) set.add(l.name); });
    const arr = Array.from(set).sort();
    $('nameTotalCount').textContent = arr.length;
    const hasNames = arr.length > 0;
    const gloss = App.buildGlossaryMap();
    const hasGloss = hasNames && arr.some(n => gloss.has(n));
    const hasMissing = hasNames && arr.some(n => !gloss.has(n));
    $('btnCopyAllNames').disabled = !hasNames;
    $('btnCopyNamesPlain').disabled = !hasNames;
    $('btnCopyNamesWithGlossary').disabled = !hasGloss;
    $('btnCopyNamesMissingGlossary').disabled = !hasMissing;
    const body = $('nameTableBody');
    body.replaceChildren();
    const frag = document.createDocumentFragment();
    arr.forEach(name => {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.className = 'mono';
      td.textContent = name;
      td.title = 'Klik untuk copy';
      tr.appendChild(td);
      frag.appendChild(tr);
    });
    body.appendChild(frag);
  },

  async copyAllNames(mode) {
    closeDropdowns();
    const names = new Set();
    State.lines.forEach(l => { if (l.name) names.add(l.name); });
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
    const from = parseInt($('rangeFromInput').value);
    const to = parseInt($('rangeToInput').value);
    const max = State.lines.length ? State.lines.reduce((m, l) => Math.max(m, l.line_num), 0) : 0;
    if (isNaN(from) || isNaN(to) || from > to || from < 1 || from > max || to > max) return alert('Range tidak valid.');

    State.selected.clear();
    for (let n = from; n <= to; n++) {
      const l = State.byNum.get(n);
      if (l && !isTrans(l)) State.selected.add(n);
    }
    App.syncCheckboxes();

    const idx = State.rows.findIndex(r => r.type === 'line' && r.line.line_num === from);
    if (idx !== -1) {
      App.main.scrollToIndex(idx);
      App.flashRow(from, 50);
    }
  },

  buildGlossaryMap() {
    const map = new Map();
    if (State.vndbEnabled && State.vndbGlossary?.length) State.vndbGlossary.forEach(e => map.set(e[0], e[1]));
    return map;
  },

  formatLine(l) {
    return l.name ? `${l.line_num}. ${l.name}: ${l.message}` : `${l.line_num}. ${l.message}`;
  },

  async copyForAi() {
    const sel = State.lines.filter(l => State.selected.has(l.line_num));
    const parts = [];
    if (State.promptEnabled && State.prompt.trim()) parts.push(State.prompt.trim());

    const gloss = App.buildGlossaryMap();
    if (gloss.size > 0) {
      const lines = [];
      gloss.forEach((v, k) => lines.push(`${k}: ${v}`));
      parts.push(`VNDB Glossary:\n${lines.join('\n')}`);
    }

    if (State.customEnabled && State.customRaw.trim()) parts.push(`Custom Glossary:\n${State.customRaw.trim()}`);

    if (State.referenceEnabled) {
      if (State.reference && State.reference.trim()) parts.push(`Reference:\n${State.reference.trim()}`);
      if (State.referencePrompt && State.referencePrompt.trim()) parts.push(State.referencePrompt.trim());
    }

    parts.push(sel.map(App.formatLine).join('\n'));
    const text = parts.join('\n\n');

    try {
      await clipboard(text);
      App.flash(`Disalin ${sel.length} baris.`);
    } catch {
      $('pasteArea').value = text;
      alert("Clipboard diblokir. Teks dipindah ke kolom 'Paste hasil AI'.");
    }
  },

  parseAi(raw, byNum) {
    let cleaned = raw.replace(/```(?:json|text)?\s*([\s\S]*?)```/g, '$1').trim();
    let reference = null;
    const refMatch = cleaned.match(/\n\s*Reference:\s*\n([\s\S]*)$/i);
    if (refMatch) {
      reference = refMatch[1].trim();
      cleaned = cleaned.slice(0, refMatch.index).trim();
    }
    const results = [];
    const errors = [];
    const seen = new Set();
    const re = /^(\d+)\.\s+(.*)$/;
    const lines = cleaned.split(/\r?\n/);

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
    return { results, errors, seen, reference };
  },

  applyTranslation() {
    if (!State.lines.length) return;
    const raw = $('pasteArea').value.trim();
    if (!raw) return alert('Teks kosong.');

    const { results, errors, seen, reference } = App.parseAi(raw, State.byNum);
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

    if (State.referenceEnabled && reference) State.reference = reference;

    $('pasteArea').value = '';
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
    $('lineEditorTitle').textContent = `Edit Baris ${num}`;
    $('lineOriginalView').value = l.name ? `${l.name}: ${l.message}` : l.message;
    $('lineNameWrap').style.display = l.name ? 'block' : 'none';
    $('lineNameInput').value = l.name ? (l.trans_name || '') : '';
    if (l.name) $('lineNameInput').placeholder = l.name;
    $('lineMessageInput').value = (l.trans_message || '').trim();
    $('lineTranslatedCheck').checked = isTrans(l);
    App.toggleModal($('lineEditorModal'), true);
  },

  saveLineEditor() {
    const l = State.byNum.get(App.activeLine);
    if (!l) return;
    const msg = $('lineMessageInput').value.trim().replace(/\r?\n/g, '\\n');
    const hasMsg = !!(l.message || '').trim();
    if ($('lineTranslatedCheck').checked && !msg && hasMsg) return alert('Pesan kosong.');

    State.undo = snapshot();
    l.trans_message = msg || null;
    const mark = $('lineTranslatedCheck').checked && (!!msg || !hasMsg);
    l.is_translated = mark;
    if (l.name) l.trans_name = $('lineNameInput').value.trim().replace(/\r?\n/g, '\\n') || null;

    State.redo = null;
    State.namesDirty = true;
    App.toggleModal($('lineEditorModal'), false);
    App.refresh(true);
    if ($('proofreadModal').classList.contains('open')) App.renderProofread();
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
      State[key] = type === 'check' ? $(id).checked : $(id).value;
    });
    if (State.projectId) State.queueSave();
  },

  openProofread() {
    PROOFREAD_FIELDS.forEach(({ id, key, type }) => {
      const el = $(id);
      if (type === 'check') el.checked = State[key];
      else el.value = State[key];
    });
    App.toggleModal($('proofreadModal'), true);
    setTimeout(() => App.renderProofread(), 340);
  },

  buildRe(query, regex, exact, caseSensitive) {
    if (!query) return null;
    try {
      let p = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (exact) p = `(?<![\\p{L}\\p{N}_])${p}(?![\\p{L}\\p{N}_])`;
      return new RegExp(p, caseSensitive ? 'gu' : 'giu');
    } catch { return null; }
  },

  renderProofread() {
    if (!$('proofreadModal').classList.contains('open')) return;
    const q = $('proofreadSearchInput').value;
    const re = App.buildRe(q, $('proofreadRegexCheck').checked, $('proofreadExactCheck').checked, $('proofreadCaseCheck').checked);
    App.highlightRe = re ? new RegExp(re.source, re.flags) : null;
    const onlyTrans = $('proofreadTranslatedOnlyCheck').checked;
    const scope = $('proofreadScope').value;

    State.matches = State.lines.filter(l => {
      if (onlyTrans && !isTrans(l)) return false;
      const on = l.name || '';
      const tn = isTrans(l) ? (l.trans_name || '').trim() || l.name : null;
      const msg = onlyTrans ? l.trans_message : l.message;
      const name = onlyTrans ? tn : on;
      if (q && re) {
        let found = false;
        re.lastIndex = 0;
        if ((scope === 'all' || scope === 'message') && msg && re.test(msg)) found = true;
        re.lastIndex = 0;
        if (!found && (scope === 'all' || scope === 'name') && name && re.test(name)) found = true;
        if (!found) return false;
      }
      return true;
    }).map(l => ({
      num: l.line_num,
      file: l.file,
      origName: l.name || '',
      origMsg: l.message,
      transName: isTrans(l) ? (l.trans_name || '').trim() || l.name : null,
      transMsg: l.trans_message,
      isTrans: isTrans(l)
    }));

    $('proofreadStatus').textContent = `Ditemukan ${State.matches.length} baris.`;
    const changed = q !== App.lastQuery;
    App.lastQuery = q;
    App.pr.setItems(State.matches, !changed);
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
    row._wrap = wrap;
    row._meta = meta;
    row._orig = orig;
    row._trans = trans;
    return row;
  },

  updatePrRow(row, d) {
    row._wrap.dataset.num = d.num;
    row._meta.textContent = `File: ${d.file} | Baris: ${d.num}`;
    row._orig.replaceChildren();
    row._trans.replaceChildren();

    const onlyTrans = $('proofreadTranslatedOnlyCheck').checked;
    const scope = $('proofreadScope').value;

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

    if (!d.isTrans) row._trans.classList.add('cell-muted');
    else row._trans.classList.remove('cell-muted');

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
    const q = $('proofreadSearchInput').value;
    const repl = $('proofreadReplaceInput').value;
    if (!q) return alert('Pencarian kosong!');

    const re = App.buildRe(q, $('proofreadRegexCheck').checked, $('proofreadExactCheck').checked, $('proofreadCaseCheck').checked);
    if (!re) return alert('Regex tidak valid.');

    let count = 0;
    State.undo = snapshot();
    State.redo = null;

    const onlyTrans = $('proofreadTranslatedOnlyCheck').checked;
    const scope = $('proofreadScope').value;

    State.lines.forEach(l => {
      if (onlyTrans && !isTrans(l)) return;
      let replaced = false;
      const msgProp = onlyTrans ? 'trans_message' : 'message';
      const nameProp = onlyTrans ? 'trans_name' : 'name';

      if ((scope === 'all' || scope === 'message') && l[msgProp]) {
        const v = l[msgProp].replace(re, repl);
        if (v !== l[msgProp]) { l[msgProp] = v; replaced = true; }
      }
      if ((scope === 'all' || scope === 'name') && l[nameProp]) {
        const v = l[nameProp].replace(re, repl);
        if (v !== l[nameProp]) { l[nameProp] = v; replaced = true; }
      }
      if (replaced) count++;
    });

    if (count) {
      State.namesDirty = true;
      App.refresh(true);
      App.renderProofread();
      State.queueSave();
      alert(`Berhasil replace ${count} baris.`);
    } else alert('Tidak ada yang cocok.');
  }
};

document.addEventListener('DOMContentLoaded', App.init);
