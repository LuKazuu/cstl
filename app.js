const CONFIG = Object.freeze({
  APP_VERSION: 8,
  PROJECT_EXT: ".cstl",
  DEFAULT_PROMPT_HEADER: `Rewrite entire text to Native Indonesian. Do not change prefix number. Euphemism prohibited. Use of "Bahasa Jakarta Selatan" is prohibited. Put results inside plaintext block.`,
  DEFAULT_EPUB_TAGS: "p",
  DEFAULT_IGNORE_NAME_TL: false,
  DEFAULT_PROMPT_ENABLED: true,
  DEFAULT_CONTEXT_ENABLED: false,
  DEFAULT_CONTEXT_SIZE: 5,
  DEFAULT_VNDB_ENABLED: false,
  DEFAULT_VNDB_ID: "",
  ENCODINGS: ["utf-8", "shift_jis", "windows-31j", "cp932"],
  TOAST_DURATION: 3000,
  AUTOSAVE_DELAY: 500,
  DEBOUNCE_DELAY: 200,
  FALLBACK_FILENAME: "unknown",
  PROJECT_TYPE_UNINITIALIZED: "uninitialized"
});

class UI {
  static el = {};
  static hintToken = 0;

  static cache() {
    document.querySelectorAll('[id]').forEach(el => {
      UI.el[el.id] = el;
    });
  }

  static toggleModal(element, state) {
    if (state) {
      element.classList.add("open");
    } else {
      element.classList.remove("open");
    }
  }

  static flashMessage(msg, keepAlive = false) {
    UI.el.copyStatus.textContent = msg;
    UI.el.copyStatus.classList.remove("empty");
    const currentToken = ++UI.hintToken;
    if (!keepAlive) {
      setTimeout(() => {
        if (UI.hintToken === currentToken) {
          UI.el.copyStatus.classList.add("empty");
        }
      }, CONFIG.TOAST_DURATION);
    }
  }

  static createDomNode(tag, classNames, attributes = {}) {
    const node = document.createElement(tag);
    if (classNames) node.className = classNames;
    for (const key in attributes) {
      node[key] = attributes[key];
    }
    return node;
  }
}

class StorageManager {
  static async getRoot() {
    return await navigator.storage.getDirectory();
  }

  static async saveProject(id, dataObj) {
    try {
      dataObj.updatedAt = Date.now();
      const root = await StorageManager.getRoot();
      const fileHandle = await root.getFileHandle(id, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(dataObj));
      await writable.close();
    } catch (e) {
      UI.flashMessage("Gagal menyimpan ke storage!");
    }
  }

  static async fetchProjects() {
    const root = await StorageManager.getRoot();
    const projects = [];
    for await (const [name, handle] of root.entries()) {
      if (name.endsWith(CONFIG.PROJECT_EXT) && handle.kind === 'file') {
        try {
          const file = await handle.getFile();
          const text = await file.text();
          const data = JSON.parse(text);
          projects.push({
            id: name,
            name: data.projectName || name.replace(CONFIG.PROJECT_EXT, ''),
            updatedAt: data.updatedAt || file.lastModified,
            fileCount: data.imported_files?.length || 0,
            lineCount: data.lines?.length || 0,
            data: data
          });
        } catch (e) {}
      }
    }
    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  static async removeProject(id, epubSourceId) {
    const root = await StorageManager.getRoot();
    if (epubSourceId) {
      try {
        await root.removeEntry(epubSourceId);
      } catch (e) {}
    }
    await root.removeEntry(id);
  }
}

class AppState {
  static currentProjectId = null;
  static projectName = "";
  static projectType = CONFIG.PROJECT_TYPE_UNINITIALIZED;
  static epubTags = CONFIG.DEFAULT_EPUB_TAGS;
  static epubSourceId = null;
  static lines = [];
  static importedFiles = [];
  static aiInstructionHeader = CONFIG.DEFAULT_PROMPT_HEADER;
  static ignoreNameTranslation = CONFIG.DEFAULT_IGNORE_NAME_TL;
  static aiPromptEnabled = CONFIG.DEFAULT_PROMPT_ENABLED;
  static contextEnabled = CONFIG.DEFAULT_CONTEXT_ENABLED;
  static contextSize = CONFIG.DEFAULT_CONTEXT_SIZE;
  static vndbEnabled = CONFIG.DEFAULT_VNDB_ENABLED;
  static vndbId = CONFIG.DEFAULT_VNDB_ID;
  static vndbGlossary = [];
  static customEnabled = false;
  static customRaw = "";
  static customGlossary = [];
  static undoSnapshot = null;
  static redoSnapshot = null;
  static selectedLines = new Set();
  static displayRows = [];
  static lineByNum = new Map();
  static filesLinesCache = new Map();
  static proofreadMatches = [];
  static saveTimeout = null;
  static translatedCount = 0;

  static isTranslated(line) {
    return !!line.is_translated;
  }

  static normalizeLine(line) {
    return {
      line_num: Number(line.line_num),
      file: String(line.file),
      name: line.name == null ? null : String(line.name).replace(/\r?\n/g, "\\n").trim(),
      message: String(line.message || "").replace(/\r?\n/g, "\\n").trim(),
      trans_name: line.trans_name == null ? null : String(line.trans_name).replace(/\r?\n/g, "\\n").trim(),
      trans_message: line.trans_message == null ? null : String(line.trans_message).replace(/\r?\n/g, "\\n").trim(),
      is_translated: Boolean(line.is_translated),
    };
  }

  static updateTranslatedCount() {
    let count = 0;
    for (let i = 0; i < AppState.lines.length; i++) {
      if (AppState.lines[i].is_translated) count++;
    }
    AppState.translatedCount = count;
  }

  static rebuildCache() {
    AppState.lineByNum.clear();
    AppState.filesLinesCache.clear();
    AppState.displayRows = [];
    const grouped = new Map(AppState.importedFiles.map(f => [f, []]));
    for (let i = 0; i < AppState.lines.length; i++) {
      const line = AppState.lines[i];
      AppState.lineByNum.set(line.line_num, line);
      if (grouped.has(line.file)) {
        grouped.get(line.file).push(line);
      }
    }
    for (const [fileName, rows] of grouped.entries()) {
      AppState.filesLinesCache.set(fileName, rows);
      if (rows.length > 0) {
        AppState.displayRows.push({ type: "separator", file: fileName });
        for (let i = 0; i < rows.length; i++) {
          AppState.displayRows.push({ type: "line", line: rows[i] });
        }
      }
    }
  }

  static queueAutoSave() {
    if (!AppState.currentProjectId) return;
    clearTimeout(AppState.saveTimeout);
    AppState.saveTimeout = setTimeout(() => {
      if (window.requestIdleCallback) {
        window.requestIdleCallback(AppState.executeAutoSave);
      } else {
        setTimeout(AppState.executeAutoSave, 0);
      }
    }, CONFIG.AUTOSAVE_DELAY);
  }

  static async executeAutoSave() {
    const data = {
      version: CONFIG.APP_VERSION,
      projectName: AppState.projectName,
      projectType: AppState.projectType,
      epubTags: AppState.epubTags,
      epubSourceId: AppState.epubSourceId,
      imported_files: AppState.importedFiles,
      lines: AppState.lines,
      prompt_header: AppState.aiInstructionHeader,
      ignoreNameTranslation: AppState.ignoreNameTranslation,
      promptEnabled: AppState.aiPromptEnabled,
      contextEnabled: AppState.contextEnabled,
      contextSize: AppState.contextSize,
      vndbEnabled: AppState.vndbEnabled,
      vndbId: AppState.vndbId,
      vndbGlossary: AppState.vndbGlossary,
      customEnabled: AppState.customEnabled,
      customRaw: AppState.customRaw,
      customGlossary: AppState.customGlossary
    };
    await StorageManager.saveProject(AppState.currentProjectId, data);
    UI.el.statusBar.textContent = UI.el.statusBar.textContent.replace(" | Tersimpan!", "") + " | Tersimpan!";
    setTimeout(() => AppController.updateStatusBar(), 2000);
  }
}

class FastVirtualScroller {
  constructor(viewport, container, createFn, updateFn) {
    this.viewport = viewport;
    this.container = container;
    this.createFn = createFn;
    this.updateFn = updateFn;
    this.items = [];
    this.positions = [];
    this.heights = [];
    this.pool = [];
    this.scrollTop = 0;
    this.defaultHeight = 80;
    this.viewport.addEventListener('scroll', () => {
      requestAnimationFrame(() => this.onScroll());
    }, { passive: true });
  }

  ensurePoolSize(size) {
    while (this.pool.length < size) {
      const el = this.createFn();
      el.style.transform = 'translateY(-9999px)';
      this.pool.push(el);
      this.container.appendChild(el);
    }
  }

  setItems(items) {
    this.items = items;
    this.heights = new Float32Array(items.length);
    this.heights.fill(this.defaultHeight);
    this.positions = new Float32Array(items.length);
    this.updatePositions();
    this.scrollTop = this.viewport.scrollTop = 0;
    this.render(true);
  }

  updatePositions() {
    let t = 8;
    for (let i = 0; i < this.items.length; i++) {
      this.positions[i] = t;
      t += this.heights[i];
    }
    this.container.style.height = `${t + 8}px`;
  }

  onScroll() {
    this.scrollTop = this.viewport.scrollTop;
    this.render();
  }

  findStart() {
    let l = 0;
    let r = this.items.length - 1;
    while (l <= r) {
      const m = Math.floor((l + r) / 2);
      if (this.positions[m] <= this.scrollTop && this.positions[m] + this.heights[m] > this.scrollTop) {
        return m;
      }
      if (this.positions[m] < this.scrollTop) l = m + 1;
      else r = m - 1;
    }
    return Math.max(0, Math.min(l, this.items.length - 1));
  }

  render() {
    if (!this.items.length) {
      for (let i = 0; i < this.pool.length; i++) {
        this.pool[i].style.transform = 'translateY(-9999px)';
      }
      this.container.style.height = '0px';
      return;
    }

    const vh = this.viewport.clientHeight || 800;
    let start = this.findStart();
    start = Math.max(0, start - 4);
    
    let end = start;
    let visibleH = 0;
    while (end < this.items.length && visibleH < vh + (this.defaultHeight * 8)) {
      visibleH += this.heights[end];
      end++;
    }

    const requiredPoolSize = end - start;
    this.ensurePoolSize(requiredPoolSize);

    let changed = false;
    let heightDiff = 0;

    for (let i = 0; i < requiredPoolSize; i++) {
      const dataIdx = start + i;
      const el = this.pool[i];
      this.updateFn(el, this.items[dataIdx], dataIdx);
      
      const h = el.offsetHeight;
      if (h && Math.abs(h + 8 - this.heights[dataIdx]) > 1) {
        const diff = (h + 8) - this.heights[dataIdx];
        this.heights[dataIdx] = h + 8;
        changed = true;
        if (this.positions[dataIdx] < this.scrollTop) heightDiff += diff;
      }
    }

    for (let i = requiredPoolSize; i < this.pool.length; i++) {
      this.pool[i].style.transform = 'translateY(-9999px)';
    }

    if (changed) {
      this.updatePositions();
      if (heightDiff !== 0) {
        this.viewport.scrollTop += heightDiff;
        this.scrollTop = this.viewport.scrollTop;
      }
    }

    for (let i = 0; i < requiredPoolSize; i++) {
      const dataIdx = start + i;
      this.pool[i].style.transform = `translateY(${this.positions[dataIdx]}px)`;
    }
  }

  scrollToIndex(idx) {
    if (idx < 0 || idx >= this.items.length) return;
    this.viewport.scrollTop = this.positions[idx] - (this.viewport.clientHeight / 2);
    this.scrollTop = this.viewport.scrollTop;
    this.render(true);
  }

  forceUpdate() {
    this.render(true);
  }
}

class Importer {
  static decodeBuffer(buffer) {
    for (const enc of CONFIG.ENCODINGS) {
      try {
        return new TextDecoder(enc, { fatal: true }).decode(buffer);
      } catch (_) {}
    }
    return new TextDecoder("utf-8").decode(buffer);
  }

  static getBaseName(pathStr) {
    const normalized = String(pathStr || "").replace(/\\/g, "/");
    return (normalized.split("/").pop() || normalized).replace(/\.json$/i, "");
  }

  static parseJsonData(jsonArray, fileName, startLineNum) {
    if (!Array.isArray(jsonArray)) throw new Error(`File ${fileName} bukan array JSON.`);
    const lines = [];
    let curLine = startLineNum;
    for (const entry of jsonArray) {
      if (!entry || typeof entry !== "object" || !Object.hasOwn(entry, "message")) continue;
      lines.push({
        line_num: curLine++,
        file: fileName,
        name: entry.name == null ? null : String(entry.name).replace(/\r?\n/g, "\\n").trim(),
        message: String(entry.message ?? "").replace(/\r?\n/g, "\\n").trim(),
        trans_name: null,
        trans_message: null,
        is_translated: false,
      });
    }
    return lines;
  }

  static async processImport(filesObj, isZip = false) {
    UI.flashMessage("Memproses file... Mohon tunggu.", true);
    document.body.style.cursor = "wait";
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    try {
      let cur = AppState.lines.length > 0 ? AppState.lines.reduce((max, l) => Math.max(max, l.line_num), 0) + 1 : 1;
      const lines = [];
      const existingFiles = new Set(AppState.importedFiles);
      const skippedFiles = [];

      if (isZip && filesObj instanceof File && window.JSZip) {
        if (AppState.projectType === CONFIG.PROJECT_TYPE_UNINITIALIZED) AppState.projectType = "json";
        const zip = new window.JSZip();
        await zip.loadAsync(filesObj);
        const names = Object.keys(zip.files).filter(n => n.endsWith(".json")).sort();
        
        for (const n of names) {
          const baseName = Importer.getBaseName(n);
          if (existingFiles.has(baseName)) {
            skippedFiles.push(baseName);
            continue;
          }
          const jsonContent = JSON.parse(Importer.decodeBuffer(await zip.file(n).async("uint8array")));
          const p = Importer.parseJsonData(jsonContent, baseName, cur);
          if (p.length) {
            existingFiles.add(baseName);
            lines.push(...p);
            cur += p.length;
          }
          await new Promise(r => setTimeout(r, 0));
        }
      } else {
        const files = Array.from(filesObj).sort((a, b) => a.name.localeCompare(b.name));
        for (const f of files) {
          if (f.name.toLowerCase().endsWith(".epub")) {
            if (AppState.projectType === "epub" && AppState.epubSourceId) {
              alert("Project ini sudah memuat file EPUB. Buat proyek baru untuk mengimpor EPUB lain.");
              continue;
            }
            if (AppState.projectType === CONFIG.PROJECT_TYPE_UNINITIALIZED) {
              AppState.projectType = "epub";
              AppState.epubSourceId = "epub_" + Date.now() + ".epub";
            }
            const root = await StorageManager.getRoot();
            const fh = await root.getFileHandle(AppState.epubSourceId, { create: true });
            const writable = await fh.createWritable();
            await writable.write(f);
            await writable.close();
            
            const zip = new window.JSZip();
            await zip.loadAsync(f);
            const containerXml = await zip.file("META-INF/container.xml").async("text");
            const rootfile = new DOMParser().parseFromString(containerXml, "application/xml").querySelector("rootfile");
            
            if (!rootfile) throw new Error("Format EPUB tidak valid atau korup.");
            const opfPath = decodeURIComponent(rootfile.getAttribute("full-path"));
            const opfDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/")) + "/" : "";
            const opfXml = await zip.file(opfPath).async("text");
            const opfDoc = new DOMParser().parseFromString(opfXml, "application/xml");
            
            const manifest = {};
            Array.from(opfDoc.querySelectorAll("manifest > item")).forEach(item => {
              manifest[item.getAttribute("id")] = decodeURIComponent(item.getAttribute("href"));
            });
            
            const spineHrefs = Array.from(opfDoc.querySelectorAll("spine > itemref")).map(ref => {
              const idref = ref.getAttribute("idref");
              return manifest[idref] ? opfDir + manifest[idref] : null;
            }).filter(Boolean);
            
            const tagsSelector = AppState.epubTags || CONFIG.DEFAULT_EPUB_TAGS;
            for (const href of spineHrefs) {
              if (existingFiles.has(href)) {
                skippedFiles.push(href);
                continue;
              }
              const fileEntry = zip.file(href);
              if (!fileEntry) continue;
              
              const html = await fileEntry.async("text");
              const doc = new DOMParser().parseFromString(html, href.endsWith('.xhtml') ? "application/xhtml+xml" : "text/html");
              const els = Array.from(doc.querySelectorAll(tagsSelector));
              
              let fileHasContent = false;
              for (const el of els) {
                const text = el.textContent.replace(/\r?\n/g, " ").trim();
                if (text) {
                  lines.push({
                    line_num: cur++,
                    file: href,
                    name: null,
                    message: text,
                    trans_name: null,
                    trans_message: null,
                    is_translated: false
                  });
                  fileHasContent = true;
                }
              }
              if (fileHasContent) existingFiles.add(href);
              await new Promise(r => setTimeout(r, 0));
            }
          } else if (f.name.toLowerCase().endsWith(".json")) {
            if (AppState.projectType === CONFIG.PROJECT_TYPE_UNINITIALIZED) AppState.projectType = "json";
            const baseName = Importer.getBaseName(f.name);
            if (existingFiles.has(baseName)) {
              skippedFiles.push(baseName);
              continue;
            }
            const content = JSON.parse(Importer.decodeBuffer(await f.arrayBuffer()));
            const p = Importer.parseJsonData(content, baseName, cur);
            if (p.length) {
              existingFiles.add(baseName);
              lines.push(...p);
              cur += p.length;
            }
            await new Promise(r => setTimeout(r, 0));
          }
        }
      }

      if (lines.length > 0) {
        AppState.lines = [...AppState.lines, ...lines];
        AppState.importedFiles = Array.from(existingFiles);
        AppController.refreshWorkspace();
        AppState.queueAutoSave();
        let msg = `Berhasil impor ${lines.length} baris.`;
        if (skippedFiles.length > 0) msg += ` (${skippedFiles.length} file duplikat diabaikan)`;
        UI.flashMessage(msg);
      } else if (skippedFiles.length > 0) {
        UI.el.copyStatus.classList.add("empty");
        setTimeout(() => alert(`Gagal impor: File duplikat.\n- ${skippedFiles.slice(0, 5).join('\n- ')}`), 10);
      } else {
        UI.flashMessage("Tidak ada data valid yang diimpor.", false);
      }
    } catch (err) {
      UI.el.copyStatus.classList.add("empty");
      setTimeout(() => alert(`Terjadi kesalahan saat mengimpor:\n${err.message}`), 10);
    } finally {
      document.body.style.cursor = "default";
    }
  }
}

class Exporter {
  static async exportData() {
    if (!AppState.lines.length) return;

    if (AppState.projectType === "epub" && AppState.epubSourceId) {
      try {
        UI.flashMessage("Membuat file EPUB...", true);
        document.body.style.cursor = "wait";
        
        const root = await StorageManager.getRoot();
        const fh = await root.getFileHandle(AppState.epubSourceId);
        const f = await fh.getFile();
        const zip = new window.JSZip();
        await zip.loadAsync(f);
        
        const linesByFile = {};
        AppState.lines.forEach(l => {
          if (!linesByFile[l.file]) linesByFile[l.file] = [];
          linesByFile[l.file].push(l);
        });
        
        const tagsSelector = AppState.epubTags || CONFIG.DEFAULT_EPUB_TAGS;
        
        for (const [href, fLines] of Object.entries(linesByFile)) {
          const zf = zip.file(href);
          if (!zf) continue;
          
          const html = await zf.async("text");
          const xmlMatch = html.match(/^<\?xml.*?\?>/i);
          const xmlHeader = xmlMatch ? xmlMatch[0] + "\n" : "";
          const doc = new DOMParser().parseFromString(html, href.endsWith('.xhtml') ? "application/xhtml+xml" : "text/html");
          const els = Array.from(doc.querySelectorAll(tagsSelector));
          
          let lineIdx = 0;
          for (const el of els) {
            if (el.textContent.replace(/\r?\n/g, " ").trim() === "") continue;
            const l = fLines[lineIdx++];
            if (l && l.is_translated && l.trans_message) el.textContent = l.trans_message;
          }
          
          let newHtml = new XMLSerializer().serializeToString(doc);
          if (xmlHeader && !newHtml.startsWith("<?xml")) newHtml = xmlHeader + newHtml;
          zip.file(href, newHtml);
        }
        
        if (zip.file("mimetype")) {
          const mimeData = await zip.file("mimetype").async("text");
          zip.file("mimetype", mimeData, { compression: "STORE" });
        }
        
        const blob = await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip", compression: "DEFLATE", compressionOptions: { level: 9 } });
        const url = URL.createObjectURL(blob);
        const a = UI.createDomNode("a", null, { href: url, download: `${AppState.projectName.replace(/[^\p{L}\p{N}_\-\.]/gu, '_')}_tl.epub` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        UI.flashMessage("Berhasil mengekspor EPUB!");
      } catch (err) {
        alert("Gagal mengekspor EPUB: " + err.message);
      } finally {
        document.body.style.cursor = "default";
      }
    } else {
      const g = new Map();
      for (const l of AppState.lines) {
        if (!g.has(l.file)) g.set(l.file, []);
        g.get(l.file).push(l);
      }
      
      const res = Array.from(g.entries()).map(([fn, lns]) => ({
        fn: `${fn.replace(/\.xhtml|\.html/g, '')}.json`,
        content: JSON.stringify(lns.map(l => {
          const e = {};
          const n = AppState.isTranslated(l) ? (l.trans_name || l.name) : l.name;
          if (n != null) e.name = n.replace(/\\n/g, "\n");
          const m = AppState.isTranslated(l) ? l.trans_message : l.message;
          e.message = m != null ? m.replace(/\\n/g, "\n") : "";
          return e;
        }), null, 2)
      }));
      
      if (window.JSZip && res.length > 1) {
        const zip = new window.JSZip();
        res.forEach(f => zip.file(f.fn, f.content));
        const blob = await zip.generateAsync({ type: "blob", mimeType: "application/octet-stream", compression: "DEFLATE", compressionOptions: { level: 9 } });
        const url = URL.createObjectURL(blob);
        const a = UI.createDomNode("a", null, { href: url, download: `${AppState.projectName.replace(/[^\p{L}\p{N}_\-\.]/gu, '_')}_export.zip` });
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } else {
        res.forEach(f => {
          const blob = new Blob([f.content], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = UI.createDomNode("a", null, { href: url, download: f.fn });
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
        });
      }
    }
  }
}

class VndbService {
  static isJapanese(text) {
    return /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(text);
  }

  static async fetchCharacters(vnId) {
    let allCharacters = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const query = {
        filters: ["vn", "=", ["id", "=", vnId]],
        fields: "name, original, aliases",
        results: 100,
        page: page
      };

      const response = await fetch("https://api.vndb.org/kana/character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query)
      });

      if (!response.ok) throw new Error(`Status: ${response.status}`);

      const data = await response.json();
      if (data.results) allCharacters.push(...data.results);
      
      hasMore = data.more || false;
      page++;
    }
    return allCharacters;
  }

  static buildGlossary(characters) {
    const glossary = new Map();
    const add = (jp, ro) => {
      jp = (jp || "").trim();
      ro = (ro || "").trim();
      if (jp && ro && VndbService.isJapanese(jp) && !glossary.has(jp)) glossary.set(jp, ro);
    };

    for (const ch of characters) {
      if (!ch.name || !ch.original) continue;
      const romaji = ch.name;
      const kanji = ch.original;

      add(kanji, romaji);

      if (kanji.includes(' ') && romaji.includes(' ')) {
        const kp = kanji.split(' ');
        const rp = romaji.split(' ');
        if (kp.length === rp.length) kp.forEach((k, idx) => add(k, rp[idx]));
      }

      const jpAliases = (ch.aliases || []).filter(a => VndbService.isJapanese(a));
      const roAliases = (ch.aliases || []).filter(a => !VndbService.isJapanese(a));
      const fallback = romaji.split(' ').pop() || romaji;

      jpAliases.forEach((jpAlias, i) => add(jpAlias, roAliases[i] || fallback));
    }
    return Array.from(glossary.entries()).sort((a, b) => b[0].length - a[0].length);
  }
}

class AppController {
  static mainScroller = null;
  static proofreadScroller = null;
  static activeEditorLineNum = null;
  static currentHighlightRegex = null;
  static tempVndbGlossary = [];
  static tempCustomRaw = "";
  static tempCustomGlossary = [];

  static async init() {
    UI.cache();
    if (!navigator.storage || !navigator.storage.getDirectory) {
      alert("Browser kamu tidak mendukung Sistem File OPFS.");
      UI.el.projectList.innerHTML = `<p class="hint" style="grid-column: 1/-1; color: var(--danger);">Browser tidak mendukung OPFS.</p>`;
      return;
    }
    AppController.mainScroller = new FastVirtualScroller(UI.el.previewViewport, UI.el.previewContainer, AppController.createMainRow, AppController.updateMainRow);
    const prViewport = UI.el.proofreadContainer.closest('.proofread-results-wrap');
    AppController.proofreadScroller = new FastVirtualScroller(prViewport, UI.el.proofreadContainer, AppController.createProofreadRow, AppController.updateProofreadRow);
    AppController.bindEvents();
    await AppController.loadDashboard();
  }

  static debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  static evalContextApplyBtn() {
    if (!UI.el.settingsContextCheck.checked) {
      UI.el.btnSettingsContextApply.disabled = true;
      return;
    }
    const val = parseInt(UI.el.settingsContextInput.value);
    if (isNaN(val) || val === AppState.contextSize || val > AppState.translatedCount || val < 1) {
      UI.el.btnSettingsContextApply.disabled = true;
    } else {
      UI.el.btnSettingsContextApply.disabled = false;
    }
  }

  static adjustToolbar() {
    const wrap = UI.el.dynamicToolbarWrap;
    const actions = UI.el.actionButtons;
    const moreGroup = UI.el.moreGroup;
    const moreDropdown = UI.el.moreDropdown;
    if (!wrap || !actions || !moreGroup || !moreDropdown) return;

    const items = [UI.el.importGroup, UI.el.btnExport, UI.el.btnProofread, UI.el.btnSettings];

    items.forEach(el => {
      if (el) actions.appendChild(el);
    });
    moreGroup.style.display = 'none';

    if (actions.scrollWidth > wrap.clientWidth) {
      moreGroup.style.display = 'inline-block';
      for (let i = items.length - 1; i >= 0; i--) {
        if (actions.scrollWidth > wrap.clientWidth && actions.children.length > 0) {
          moreDropdown.insertBefore(items[i], moreDropdown.firstChild);
        } else {
          break;
        }
      }
    }
  }

  static bindEvents() {
    window.addEventListener('resize', AppController.debounce(() => {
      if (UI.el.workspaceView.style.display !== "none") AppController.adjustToolbar();
    }, 100));

    UI.el.btnNewProject.addEventListener("click", AppController.createNewProject);
    UI.el.btnBackToDashboard.addEventListener("click", AppController.closeProject);
    UI.el.btnRestoreProject.addEventListener("click", () => UI.el.restoreProjectInput.click());
    UI.el.restoreProjectInput.addEventListener("change", AppController.restoreProject);
    
    document.addEventListener("click", (e) => {
      const isImportBtn = e.target.closest('#btnImportMain');
      const isMoreBtn = e.target.closest('#btnMore');

      if (isImportBtn) {
        e.preventDefault();
        UI.el.importDropdown.classList.toggle("show");
        if (!e.target.closest('#moreDropdown') && UI.el.moreDropdown) {
          UI.el.moreDropdown.classList.remove("show");
        }
      } else if (isMoreBtn) {
        e.preventDefault();
        if (UI.el.moreDropdown) UI.el.moreDropdown.classList.toggle("show");
        if (UI.el.importDropdown) UI.el.importDropdown.classList.remove("show");
      } else {
        if (!e.target.closest('#importGroup') && UI.el.importDropdown) {
          UI.el.importDropdown.classList.remove("show");
        }
        if (!e.target.closest('#moreGroup') && UI.el.moreDropdown) {
          UI.el.moreDropdown.classList.remove("show");
        }
      }
    });

    UI.el.btnImportFile.addEventListener("click", () => {
      UI.el.importDropdown.classList.remove("show");
      if (UI.el.moreDropdown) UI.el.moreDropdown.classList.remove("show");
      UI.el.importFileInput.click();
    });
    UI.el.importFileInput.addEventListener("change", async e => {
      if (!e.target.files.length) return;
      await Importer.processImport(e.target.files);
      e.target.value = "";
    });
    
    UI.el.btnImportFolder.addEventListener("click", () => {
      UI.el.importDropdown.classList.remove("show");
      if (UI.el.moreDropdown) UI.el.moreDropdown.classList.remove("show");
      UI.el.importFolderInput.click();
    });
    UI.el.importFolderInput.addEventListener("change", async e => {
      if (!e.target.files.length) return;
      await Importer.processImport(e.target.files);
      e.target.value = "";
    });
    
    UI.el.btnImportZip.addEventListener("click", () => {
      UI.el.importDropdown.classList.remove("show");
      if (UI.el.moreDropdown) UI.el.moreDropdown.classList.remove("show");
      UI.el.importZipInput.click();
    });
    UI.el.importZipInput.addEventListener("change", async e => {
      if (!e.target.files.length) return;
      await Importer.processImport(e.target.files[0], true);
      e.target.value = "";
    });
    
    UI.el.btnExport.addEventListener("click", () => {
      if (UI.el.moreDropdown) UI.el.moreDropdown.classList.remove("show");
      Exporter.exportData();
    });
    UI.el.btnCopyForAi.addEventListener("click", AppController.copyForAi);
    UI.el.btnApply.addEventListener("click", AppController.applyTranslation);
    UI.el.btnUndo.addEventListener("click", AppController.undoTranslation);
    UI.el.btnRedo.addEventListener("click", AppController.redoTranslation);
    UI.el.btnProofread.addEventListener("click", () => {
      if (UI.el.moreDropdown) UI.el.moreDropdown.classList.remove("show");
      AppController.openProofread();
    });
    
    UI.el.btnSelectAll.addEventListener("click", () => {
      AppState.lines.forEach(l => {
        if (!AppState.isTranslated(l)) AppState.selectedLines.add(l.line_num);
      });
      AppController.syncCheckboxes();
    });
    
    UI.el.btnClearSelection.addEventListener("click", () => {
      AppState.selectedLines.clear();
      AppController.syncCheckboxes();
    });
    
    UI.el.btnSelectRange.addEventListener("click", AppController.selectRange);
    
    UI.el.btnSettings.addEventListener("click", () => {
      if (UI.el.moreDropdown) UI.el.moreDropdown.classList.remove("show");
      UI.el.settingsIgnoreNameCheck.checked = AppState.ignoreNameTranslation;
      UI.el.settingsPromptCheck.checked = AppState.aiPromptEnabled;
      UI.el.settingsContextCheck.checked = AppState.contextEnabled;
      UI.el.settingsPromptInput.value = AppState.aiInstructionHeader;
      UI.el.settingsEpubTagsInput.value = AppState.epubTags || CONFIG.DEFAULT_EPUB_TAGS;
      UI.el.settingsContextInput.value = AppState.contextSize;
      UI.el.settingsContextWrap.style.opacity = AppState.contextEnabled ? "1" : "0.4";
      UI.el.settingsContextWrap.style.pointerEvents = AppState.contextEnabled ? "auto" : "none";
      UI.el.settingsContextInput.disabled = !AppState.contextEnabled || (AppState.translatedCount < 1);
      
      UI.el.settingsVndbCheck.checked = AppState.vndbEnabled;
      UI.el.settingsVndbIdInput.value = AppState.vndbId || "";
      AppController.tempVndbGlossary = AppState.vndbGlossary ? [...AppState.vndbGlossary] : [];
      UI.el.settingsVndbPreviewArea.value = AppController.tempVndbGlossary.map(g => `${g[0]}: ${g[1]}`).join("\n");
      UI.el.settingsVndbWrap.style.opacity = AppState.vndbEnabled ? "1" : "0.4";
      UI.el.settingsVndbWrap.style.pointerEvents = AppState.vndbEnabled ? "auto" : "none";

      const hasVndbData = AppController.tempVndbGlossary.length > 0;
      UI.el.settingsVndbIdInput.disabled = hasVndbData;
      UI.el.btnSettingsVndbFetch.disabled = hasVndbData;

      AppController.evalContextApplyBtn();
      UI.el.settingsCustomCheck.checked = AppState.customEnabled;
      AppController.tempCustomRaw = AppState.customRaw || "";
      AppController.tempCustomGlossary = AppState.customGlossary ? [...AppState.customGlossary] : [];
      UI.el.settingsCustomInput.value = AppController.tempCustomRaw;
      UI.el.settingsCustomWrap.style.opacity = AppState.customEnabled ? "1" : "0.4";
      UI.el.settingsCustomWrap.style.pointerEvents = AppState.customEnabled ? "auto" : "none";
      UI.el.btnSettingsCustomApply.disabled = true;
      UI.toggleModal(UI.el.settingsModal, true);
    });
    
    UI.el.settingsContextCheck.addEventListener("change", (e) => {
      const isChecked = e.target.checked;
      UI.el.settingsContextWrap.style.opacity = isChecked ? "1" : "0.4";
      UI.el.settingsContextWrap.style.pointerEvents = isChecked ? "auto" : "none";
      if (!isChecked) {
        UI.el.settingsContextInput.disabled = true;
        UI.el.btnSettingsContextApply.disabled = true;
      } else {
        UI.el.settingsContextInput.disabled = AppState.translatedCount < 1;
        AppController.evalContextApplyBtn();
      }
    });

    UI.el.settingsVndbCheck.addEventListener("change", (e) => {
      const isChecked = e.target.checked;
      UI.el.settingsVndbWrap.style.opacity = isChecked ? "1" : "0.4";
      UI.el.settingsVndbWrap.style.pointerEvents = isChecked ? "auto" : "none";
    });

    UI.el.btnSettingsVndbFetch.addEventListener("click", async () => {
      let vnId = UI.el.settingsVndbIdInput.value.trim();
      if (!vnId) return;
      if (!vnId.startsWith("v")) vnId = "v" + vnId;

      try {
        UI.el.btnSettingsVndbFetch.disabled = true;
        UI.el.settingsVndbIdInput.disabled = true;
        UI.el.settingsVndbStatus.textContent = "Mengambil data...";
        UI.el.settingsVndbStatus.classList.remove("empty");
        UI.el.settingsVndbStatus.style.color = "var(--primary)";

        const chars = await VndbService.fetchCharacters(vnId);
        if (chars.length === 0) throw new Error("Karakter tidak ditemukan.");

        const glossary = VndbService.buildGlossary(chars);
        AppController.tempVndbGlossary = glossary;

        UI.el.settingsVndbPreviewArea.value = glossary.map(g => `${g[0]}: ${g[1]}`).join("\n");
        UI.el.settingsVndbStatus.textContent = `Ditemukan ${glossary.length} entri.`;
        UI.el.settingsVndbStatus.style.color = "var(--success)";
      } catch (err) {
        UI.el.settingsVndbStatus.textContent = err.message;
        UI.el.settingsVndbStatus.style.color = "var(--danger)";
        UI.el.btnSettingsVndbFetch.disabled = false;
        UI.el.settingsVndbIdInput.disabled = false;
      }
    });

    UI.el.btnSettingsVndbReset.addEventListener("click", () => {
      UI.el.settingsVndbCheck.checked = CONFIG.DEFAULT_VNDB_ENABLED;
      UI.el.settingsVndbIdInput.value = CONFIG.DEFAULT_VNDB_ID;
      UI.el.settingsVndbPreviewArea.value = "";
      AppController.tempVndbGlossary = [];
      UI.el.settingsVndbStatus.className = "status-toast empty mb-2";
      UI.el.settingsVndbIdInput.disabled = false;
      UI.el.btnSettingsVndbFetch.disabled = false;
      UI.el.settingsVndbWrap.style.opacity = CONFIG.DEFAULT_VNDB_ENABLED ? "1" : "0.4";
      UI.el.settingsVndbWrap.style.pointerEvents = CONFIG.DEFAULT_VNDB_ENABLED ? "auto" : "none";
    });
    
    UI.el.settingsContextInput.addEventListener("input", AppController.evalContextApplyBtn);
    
    UI.el.btnSettingsContextApply.addEventListener("click", () => {
      const val = parseInt(UI.el.settingsContextInput.value);
      if (!isNaN(val)) {
        AppState.contextSize = val;
        AppState.queueAutoSave();
        AppController.evalContextApplyBtn();
      }
    });
    
    UI.el.btnSettingsDasarReset.addEventListener("click", () => {
      UI.el.settingsIgnoreNameCheck.checked = CONFIG.DEFAULT_IGNORE_NAME_TL;
      UI.el.settingsPromptCheck.checked = CONFIG.DEFAULT_PROMPT_ENABLED;
      UI.el.settingsContextCheck.checked = CONFIG.DEFAULT_CONTEXT_ENABLED;
      UI.el.settingsContextInput.value = CONFIG.DEFAULT_CONTEXT_SIZE;
      UI.el.settingsContextWrap.style.opacity = CONFIG.DEFAULT_CONTEXT_ENABLED ? "1" : "0.4";
      UI.el.settingsContextWrap.style.pointerEvents = CONFIG.DEFAULT_CONTEXT_ENABLED ? "auto" : "none";
      UI.el.settingsContextInput.disabled = !CONFIG.DEFAULT_CONTEXT_ENABLED || (AppState.translatedCount < 1);
      AppController.evalContextApplyBtn();
    });
    
    UI.el.btnSettingsPromptReset.addEventListener("click", () => { 
      UI.el.settingsPromptInput.value = CONFIG.DEFAULT_PROMPT_HEADER; 
    });
    
    UI.el.btnSettingsEpubReset.addEventListener("click", () => { 
      UI.el.settingsEpubTagsInput.value = CONFIG.DEFAULT_EPUB_TAGS; 
    });
    
    UI.el.btnSettingsCancel.addEventListener("click", () => {
      UI.toggleModal(UI.el.settingsModal, false);
    });
    
    UI.el.btnSettingsSave.addEventListener("click", () => {
      AppState.ignoreNameTranslation = UI.el.settingsIgnoreNameCheck.checked;
      AppState.aiPromptEnabled = UI.el.settingsPromptCheck.checked;
      AppState.contextEnabled = UI.el.settingsContextCheck.checked;
      AppState.aiInstructionHeader = UI.el.settingsPromptInput.value.trim();
      AppState.epubTags = UI.el.settingsEpubTagsInput.value.trim() || CONFIG.DEFAULT_EPUB_TAGS;
      AppState.vndbEnabled = UI.el.settingsVndbCheck.checked;
      AppState.vndbId = UI.el.settingsVndbIdInput.value.trim();
      AppState.vndbGlossary = AppController.tempVndbGlossary;
      AppState.customEnabled = UI.el.settingsCustomCheck.checked;
      AppState.customRaw = AppController.tempCustomRaw;
      AppState.customGlossary = AppController.tempCustomGlossary;
      UI.toggleModal(UI.el.settingsModal, false);
      AppState.queueAutoSave();
    });
    
    UI.el.btnLineCancel.addEventListener("click", () => {
      UI.toggleModal(UI.el.lineEditorModal, false);
    });
    
    UI.el.btnLineSave.addEventListener("click", AppController.saveLineEditor);
    
    UI.el.btnProofreadClose.addEventListener("click", () => {
      UI.toggleModal(UI.el.proofreadModal, false);
    });
    
    UI.el.btnProofreadReset.addEventListener("click", () => {
      UI.el.proofreadSearchInput.value = ""; 
      UI.el.proofreadReplaceInput.value = "";
      UI.el.proofreadScope.value = "all"; 
      UI.el.proofreadRegexCheck.checked = false;
      UI.el.proofreadCaseCheck.checked = false; 
      UI.el.proofreadExactCheck.checked = false;
      UI.el.proofreadTranslatedOnlyCheck.checked = true;
      AppController.renderProofread();
    });
    
    UI.el.btnProofreadReplaceAll.addEventListener("click", AppController.execReplaceAll);
    
    const debouncedSearch = AppController.debounce(AppController.renderProofread, CONFIG.DEBOUNCE_DELAY);
    UI.el.proofreadSearchInput.addEventListener("input", debouncedSearch);
    UI.el.proofreadScope.addEventListener("change", AppController.renderProofread);
    UI.el.proofreadRegexCheck.addEventListener("change", AppController.renderProofread);
    UI.el.proofreadCaseCheck.addEventListener("change", AppController.renderProofread);
    UI.el.proofreadExactCheck.addEventListener("change", AppController.renderProofread);
    UI.el.proofreadTranslatedOnlyCheck.addEventListener("change", AppController.renderProofread);
    
    UI.el.settingsCustomCheck.addEventListener("change", (e) => {
      const isChecked = e.target.checked;
      UI.el.settingsCustomWrap.style.opacity = isChecked ? "1" : "0.4";
      UI.el.settingsCustomWrap.style.pointerEvents = isChecked ? "auto" : "none";
    });

    UI.el.btnSettingsCustomReset.addEventListener("click", () => {
      UI.el.settingsCustomCheck.checked = false;
      UI.el.settingsCustomInput.value = "";
      UI.el.settingsCustomWrap.style.opacity = "0.4";
      UI.el.settingsCustomWrap.style.pointerEvents = "none";
      UI.el.btnSettingsCustomApply.disabled = true;
      AppController.tempCustomRaw = "";
      AppController.tempCustomGlossary = [];
    });

    UI.el.settingsCustomInput.addEventListener("input", () => {
      const val = UI.el.settingsCustomInput.value;
      let isValid = true;
      let hasContent = false;
      const lines = val.split(/\r?\n/);
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === "") continue;
        hasContent = true;
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1 || colonIdx === 0 || colonIdx === line.length - 1) {
          isValid = false;
          break;
        }
        const k = line.substring(0, colonIdx).trim();
        const v = line.substring(colonIdx + 1).trim();
        if (!k || !v) {
          isValid = false;
          break;
        }
      }

      if (val === AppController.tempCustomRaw || (!isValid && hasContent)) {
        UI.el.btnSettingsCustomApply.disabled = true;
      } else {
        UI.el.btnSettingsCustomApply.disabled = false;
      }
    });

    UI.el.btnSettingsCustomApply.addEventListener("click", () => {
      const val = UI.el.settingsCustomInput.value;
      const lines = val.split(/\r?\n/);
      const parsed = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === "") continue;
        const colonIdx = line.indexOf(":");
        if (colonIdx > 0) {
          const k = line.substring(0, colonIdx).trim();
          const v = line.substring(colonIdx + 1).trim();
          if (k && v) parsed.push([k, v]);
        }
      }
      
      AppController.tempCustomRaw = val;
      AppController.tempCustomGlossary = parsed;
      UI.el.btnSettingsCustomApply.disabled = true;
    });

    UI.el.previewContainer.addEventListener("change", (e) => {
      if (e.target.classList.contains('sep-cb')) {
        const file = e.target.dataset.file;
        const fileLines = AppState.filesLinesCache.get(file) || [];
        fileLines.forEach(l => {
          if (!AppState.isTranslated(l)) {
            if (e.target.checked) AppState.selectedLines.add(l.line_num);
            else AppState.selectedLines.delete(l.line_num);
          }
        });
        AppController.syncCheckboxes();
      } else if (e.target.closest('.checkbox-cell') && e.target.type === 'checkbox') {
        const num = Number(e.target.dataset.num);
        if (e.target.checked) AppState.selectedLines.add(num);
        else AppState.selectedLines.delete(num);
        AppController.syncCheckboxes();
      }
    });

    UI.el.previewContainer.addEventListener("click", (e) => {
      const content = e.target.closest('.text-content');
      if (content) {
        const row = content.closest('.preview-row');
        if (row && !row.classList.contains('separator')) {
          const cb = row.querySelector('input[type="checkbox"]');
          if (cb && cb.dataset.num) AppController.openLineEditor(Number(cb.dataset.num));
        }
      }
    });

    UI.el.proofreadContainer.addEventListener("click", (e) => {
      const content = e.target.closest('.text-content');
      if (content && content.dataset.num) AppController.openLineEditor(Number(content.dataset.num));
    });

    UI.el.nameTableBody.addEventListener("click", async (e) => {
      if (e.target.tagName === "TD") {
        const n = e.target.textContent;
        try { 
          await navigator.clipboard.writeText(n); 
          UI.flashMessage(`Nama "${n}" disalin!`); 
        } catch (err) { 
          alert(`Clipboard diblokir oleh browser untuk teks:\n${n}`); 
        }
      }
    });

    UI.el.btnCopyAllNames.addEventListener("click", async () => {
      const namesSet = new Set();
      for (let i = 0; i < AppState.lines.length; i++) {
        if (AppState.lines[i].name) namesSet.add(AppState.lines[i].name);
      }
      const namesList = Array.from(namesSet).sort();
      if (namesList.length === 0) return;
      try {
        await navigator.clipboard.writeText(namesList.join('\n'));
        UI.flashMessage(`${namesList.length} nama disalin!`);
      } catch (err) {
        alert("Clipboard diblokir oleh browser.");
      }
    });
  }

  static async loadDashboard() {
    UI.el.projectList.innerHTML = "";
    try {
      const projects = await StorageManager.fetchProjects();
      if (projects.length === 0) {
        UI.el.projectList.innerHTML = `<p class="hint" style="grid-column: 1/-1;">Belum ada proyek. Klik "Buat Project Baru" untuk memulai.</p>`;
        return;
      }
      for (const p of projects) {
        const card = UI.createDomNode("div", "project-card");
        let badge = p.fileCount > 0 || p.lineCount > 0 ? (p.data.projectType === 'epub' ? `<span class="badge badge-epub">EPUB</span>` : (p.data.projectType === 'json' ? `<span class="badge badge-json">JSON-VNTP</span>` : '')) : '';
        card.innerHTML = `
          <div>
            <h3>${p.name}</h3>
            <div class="project-meta mt-2">
              ${badge ? `<div style="margin-bottom: 8px;">${badge}</div>` : ''}
              Terakhir diubah: ${new Date(p.updatedAt).toLocaleString('id-ID')}<br>
              File: ${p.fileCount} | Baris: ${p.lineCount}
            </div>
          </div>
          <div class="project-actions">
            <button class="btn btn-primary btn-sm btn-open">Buka</button>
            <button class="btn btn-outline btn-sm btn-rename">Ubah Nama</button>
            <button class="btn btn-outline btn-sm btn-backup">Backup</button>
            <button class="btn btn-danger btn-sm btn-delete">Hapus</button>
          </div>
        `;
        
        card.querySelector(".btn-open").addEventListener("click", () => {
          AppController.openProject(p.id, p.data);
        });
        
        card.querySelector(".btn-rename").addEventListener("click", async () => {
          const newName = prompt("Masukkan nama baru:", p.name);
          if (newName && newName.trim() && newName !== p.name) {
            p.data.projectName = newName.trim();
            await StorageManager.saveProject(p.id, p.data);
            AppController.loadDashboard();
          }
        });
        
        card.querySelector(".btn-backup").addEventListener("click", async () => {
          try {
            document.body.style.cursor = "wait";
            const zip = new window.JSZip();
            const meta = {
              version: p.data.version,
              projectName: p.data.projectName,
              projectType: p.data.projectType,
              epubTags: p.data.epubTags,
              epubSourceId: p.data.epubSourceId,
              updatedAt: p.data.updatedAt,
              imported_files: p.data.imported_files,
              prompt_header: p.data.prompt_header,
              ignoreNameTranslation: p.data.ignoreNameTranslation,
              promptEnabled: p.data.promptEnabled,
              contextEnabled: p.data.contextEnabled,
              contextSize: p.data.contextSize,
              vndbEnabled: p.data.vndbEnabled,
              vndbId: p.data.vndbId,
              vndbGlossary: p.data.vndbGlossary,
              customEnabled: p.data.customEnabled,
              customRaw: p.data.customRaw,
              customGlossary: p.data.customGlossary
            };
            zip.file("metadata.json", JSON.stringify(meta));
            
            let origStr = "";
            let transStr = "";
            let nameStr = "";
            
            for (const file of p.data.imported_files) {
              origStr += `>>> ${file} <<<\n`;
              transStr += `>>> ${file} <<<\n`;
              nameStr += `>>> ${file} <<<\n`;
              
              const fileLines = p.data.lines.filter(l => l.file === file);
              for (const l of fileLines) {
                origStr += `${l.message || ""}\n`;
                transStr += `${l.trans_message || ""}\n`;
                const n1 = l.name || "";
                const n2 = l.trans_name || "";
                nameStr += (n1 || n2) ? `${n1} ||| ${n2}\n` : `\n`;
              }
            }
            
            zip.file("original.txt", origStr);
            zip.file("translated.txt", transStr);
            zip.file("names.txt", nameStr);
            
            if (p.data.projectType === "epub" && p.data.epubSourceId) {
              const root = await StorageManager.getRoot();
              const fh = await root.getFileHandle(p.data.epubSourceId);
              const file = await fh.getFile();
              zip.file(p.data.epubSourceId, file);
            }
            
            const blob = await zip.generateAsync({ type: "blob", mimeType: "application/octet-stream", compression: "DEFLATE", compressionOptions: { level: 9 } });
            const url = URL.createObjectURL(blob);
            const a = UI.createDomNode("a", null, { href: url, download: `${p.name.replace(/[^\p{L}\p{N}_\-\.]/gu, '_')}_backup${CONFIG.PROJECT_EXT}` });
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
          } catch (err) { 
            alert("Gagal membuat backup: " + err.message); 
          } finally { 
            document.body.style.cursor = "default"; 
          }
        });
        
        card.querySelector(".btn-delete").addEventListener("click", async () => {
          if (confirm("Hapus permanen?")) {
            await StorageManager.removeProject(p.id, p.data.epubSourceId);
            AppController.loadDashboard();
          }
        });
        
        UI.el.projectList.appendChild(card);
      }
    } catch (err) { 
      UI.el.projectList.innerHTML = `<p class="hint" style="color: var(--danger);">Gagal mengakses storage browser.</p>`; 
    }
  }

  static async restoreProject(ev) {
    const f = ev.target.files?.[0];
    if (!f) return;
    try {
      document.body.style.cursor = "wait";
      const zip = new window.JSZip();
      await zip.loadAsync(f);
      
      const metaFile = zip.file("metadata.json");
      const origFile = zip.file("original.txt");
      const transFile = zip.file("translated.txt");
      const nameFile = zip.file("names.txt");
      
      if (!metaFile || !origFile || !transFile || !nameFile) throw new Error("Format arsip tidak valid.");
      
      const p = JSON.parse(await metaFile.async("text"));
      const origLines = (await origFile.async("text")).split(/\r?\n/);
      const transLines = (await transFile.async("text")).split(/\r?\n/);
      const nameLines = (await nameFile.async("text")).split(/\r?\n/);
      
      if (origLines[origLines.length - 1] === "") origLines.pop();
      if (transLines[transLines.length - 1] === "") transLines.pop();
      if (nameLines[nameLines.length - 1] === "") nameLines.pop();
      
      if (origLines.length !== transLines.length || origLines.length !== nameLines.length) {
        throw new Error("Berkas korup: Jumlah baris tidak sinkron.");
      }
      
      const fileMarkerPrefix = ">>> ";
      const fileMarkerSuffix = " <<<";
      const reconstructedLines = [];
      let currentFile = CONFIG.FALLBACK_FILENAME;
      let lineNum = 1;
      
      for (let i = 0; i < origLines.length; i++) {
        const o = origLines[i];
        const t = transLines[i];
        const n = nameLines[i];
        
        if (o.startsWith(fileMarkerPrefix) && o.endsWith(fileMarkerSuffix)) {
          if (t !== o || n !== o) throw new Error("Berkas korup: Header file tidak sinkron.");
          currentFile = o.substring(fileMarkerPrefix.length, o.length - fileMarkerSuffix.length);
        } else {
          let oName = null;
          let tName = null;
          if (n.trim()) {
            const parts = n.split(" ||| ");
            oName = parts[0]?.trim() || null;
            tName = parts[1]?.trim() || null;
          }
          reconstructedLines.push({
            line_num: lineNum++,
            file: currentFile,
            name: oName,
            message: o,
            trans_name: tName,
            trans_message: t || null,
            is_translated: !!(t && t.trim())
          });
        }
      }
      
      const name = p.projectName || f.name.replace(CONFIG.PROJECT_EXT, '');
      
      if (p.projectType === "epub" && p.epubSourceId) {
        const epubFile = zip.file(p.epubSourceId);
        if (epubFile) {
          const newEpubId = "epub_" + Date.now() + ".epub";
          const root = await StorageManager.getRoot();
          const fh = await root.getFileHandle(newEpubId, { create: true });
          const writable = await fh.createWritable();
          await writable.write(await epubFile.async("blob"));
          await writable.close();
          p.epubSourceId = newEpubId;
        }
      }
      
      const data = {
        version: CONFIG.APP_VERSION,
        projectName: name,
        projectType: p.projectType || CONFIG.PROJECT_TYPE_UNINITIALIZED,
        epubTags: p.epubTags || CONFIG.DEFAULT_EPUB_TAGS,
        epubSourceId: p.epubSourceId || null,
        updatedAt: Date.now(),
        imported_files: p.imported_files || [],
        lines: reconstructedLines.map(AppState.normalizeLine),
        prompt_header: p.prompt_header || CONFIG.DEFAULT_PROMPT_HEADER,
        ignoreNameTranslation: p.ignoreNameTranslation ?? CONFIG.DEFAULT_IGNORE_NAME_TL,
        promptEnabled: p.promptEnabled ?? CONFIG.DEFAULT_PROMPT_ENABLED,
        contextEnabled: p.contextEnabled ?? CONFIG.DEFAULT_CONTEXT_ENABLED,
        contextSize: p.contextSize ?? CONFIG.DEFAULT_CONTEXT_SIZE,
        vndbEnabled: p.vndbEnabled ?? CONFIG.DEFAULT_VNDB_ENABLED,
        vndbId: p.vndbId || CONFIG.DEFAULT_VNDB_ID,
        vndbGlossary: p.vndbGlossary || [],
        customEnabled: p.customEnabled ?? false,
        customRaw: p.customRaw || "",
        customGlossary: p.customGlossary || []
      };
      
      await StorageManager.saveProject("proj_" + Date.now() + CONFIG.PROJECT_EXT, data);
      await AppController.loadDashboard();
      alert(`Project "${name}" berhasil dipulihkan!`);
      
    } catch (e) { 
      alert("File backup korup atau tidak valid: " + e.message); 
    } finally { 
      document.body.style.cursor = "default"; 
      ev.target.value = ""; 
    }
  }

  static async createNewProject() {
    const name = prompt("Masukkan nama proyek baru:");
    if (!name || !name.trim()) return;
    
    const id = "proj_" + Date.now() + CONFIG.PROJECT_EXT;
    const initialData = {
      version: CONFIG.APP_VERSION,
      projectName: name.trim(),
      projectType: CONFIG.PROJECT_TYPE_UNINITIALIZED,
      epubTags: CONFIG.DEFAULT_EPUB_TAGS,
      epubSourceId: null,
      updatedAt: Date.now(),
      imported_files: [],
      lines: [],
      prompt_header: CONFIG.DEFAULT_PROMPT_HEADER,
      ignoreNameTranslation: CONFIG.DEFAULT_IGNORE_NAME_TL,
      promptEnabled: CONFIG.DEFAULT_PROMPT_ENABLED,
      contextEnabled: CONFIG.DEFAULT_CONTEXT_ENABLED,
      contextSize: CONFIG.DEFAULT_CONTEXT_SIZE,
      vndbEnabled: CONFIG.DEFAULT_VNDB_ENABLED,
      vndbId: CONFIG.DEFAULT_VNDB_ID,
      vndbGlossary: [],
      customEnabled: false,
      customRaw: "",
      customGlossary: []
    };
    
    await StorageManager.saveProject(id, initialData);
    AppController.openProject(id, initialData);
  }

  static openProject(id, data) {
    AppState.currentProjectId = id;
    AppState.projectName = data.projectName || "Unknown Project";
    AppState.projectType = data.projectType || CONFIG.PROJECT_TYPE_UNINITIALIZED;
    AppState.epubTags = data.epubTags || CONFIG.DEFAULT_EPUB_TAGS;
    AppState.epubSourceId = data.epubSourceId || null;
    AppState.lines = (data.lines || []).map(AppState.normalizeLine);
    AppState.importedFiles = data.imported_files || [];
    AppState.aiInstructionHeader = data.prompt_header || CONFIG.DEFAULT_PROMPT_HEADER;
    AppState.ignoreNameTranslation = data.ignoreNameTranslation ?? CONFIG.DEFAULT_IGNORE_NAME_TL;
    AppState.aiPromptEnabled = data.promptEnabled ?? CONFIG.DEFAULT_PROMPT_ENABLED;
    AppState.contextEnabled = data.contextEnabled ?? CONFIG.DEFAULT_CONTEXT_ENABLED;
    AppState.contextSize = data.contextSize ?? CONFIG.DEFAULT_CONTEXT_SIZE;
    AppState.vndbEnabled = data.vndbEnabled ?? CONFIG.DEFAULT_VNDB_ENABLED;
    AppState.vndbId = data.vndbId || CONFIG.DEFAULT_VNDB_ID;
    AppState.vndbGlossary = data.vndbGlossary || [];
    AppState.customEnabled = data.customEnabled ?? false;
    AppState.customRaw = data.customRaw || "";
    AppState.customGlossary = data.customGlossary || [];
    AppState.selectedLines.clear();
    AppState.undoSnapshot = null;
    AppState.redoSnapshot = null;
    
    UI.el.projectNameDisplay.textContent = AppState.projectName;
    UI.el.dashboardView.classList.remove("open");
    UI.el.workspaceView.style.display = "flex";
    requestAnimationFrame(() => AppController.adjustToolbar());
    AppController.refreshWorkspace();
  }

  static closeProject() {
    if (AppState.saveTimeout) {
      clearTimeout(AppState.saveTimeout);
      const data = {
        version: CONFIG.APP_VERSION,
        projectName: AppState.projectName,
        projectType: AppState.projectType,
        epubTags: AppState.epubTags,
        epubSourceId: AppState.epubSourceId,
        imported_files: AppState.importedFiles,
        lines: AppState.lines,
        prompt_header: AppState.aiInstructionHeader,
        ignoreNameTranslation: AppState.ignoreNameTranslation,
        promptEnabled: AppState.aiPromptEnabled,
        contextEnabled: AppState.contextEnabled,
        contextSize: AppState.contextSize,
        vndbEnabled: AppState.vndbEnabled,
        vndbId: AppState.vndbId,
        vndbGlossary: AppState.vndbGlossary
      };
      StorageManager.saveProject(AppState.currentProjectId, data).then(AppController.finishClose);
    } else {
      AppController.finishClose();
    }
  }

  static finishClose() {
    AppState.saveTimeout = null;
    AppState.currentProjectId = null;
    AppState.projectName = "";
    AppState.epubSourceId = null;
    AppState.lines = [];
    AppState.importedFiles = [];
    AppState.displayRows = [];
    AppState.proofreadMatches = [];
    AppState.selectedLines.clear();
    AppState.lineByNum.clear();
    AppState.filesLinesCache.clear();
    AppState.undoSnapshot = null;
    AppState.redoSnapshot = null;
    AppState.translatedCount = 0;
    
    if (AppController.mainScroller) AppController.mainScroller.setItems([]);
    if (AppController.proofreadScroller) AppController.proofreadScroller.setItems([]);
    
    UI.el.nameTableBody.replaceChildren();
    UI.el.pasteArea.value = "";
    UI.el.copyStatus.classList.add("empty");
    UI.el.workspaceView.style.display = "none";
    UI.el.dashboardView.classList.add("open");
    AppController.loadDashboard();
  }

  static refreshWorkspace() {
    AppState.updateTranslatedCount();
    AppState.rebuildCache();
    AppController.mainScroller.setItems(AppState.displayRows);
    AppController.updateButtons();
    AppController.renderNameTable();
    AppController.updateStatusBar();
    UI.el.btnUndo.disabled = !AppState.undoSnapshot;
    UI.el.btnRedo.disabled = !AppState.redoSnapshot;
  }

  static updateButtons() {
    const dataOk = AppState.lines.length > 0;
    const selOk = AppState.selectedLines.size > 0;
    
    UI.el.btnExport.disabled = !dataOk;
    UI.el.btnProofread.disabled = !dataOk;
    UI.el.btnSelectAll.disabled = !dataOk;
    UI.el.pasteArea.disabled = !dataOk;
    UI.el.btnApply.disabled = !dataOk;
    UI.el.rangeFromInput.disabled = !dataOk;
    UI.el.rangeToInput.disabled = !dataOk;
    UI.el.btnSelectRange.disabled = !dataOk;
    
    UI.el.btnClearSelection.disabled = !selOk;
    UI.el.btnCopyForAi.disabled = !selOk;
    UI.el.copyCount.textContent = AppState.selectedLines.size;
  }

  static updateStatusBar() {
    const total = AppState.lines.length;
    const trans = AppState.translatedCount;
    const perc = total ? Math.floor((trans / total) * 100) : 0;
    const mode = AppState.projectType === CONFIG.PROJECT_TYPE_UNINITIALIZED ? "-" : (AppState.projectType === "epub" ? "EPUB" : "JSON-VNTP");
    const files = AppState.importedFiles.length > 1 ? `${AppState.importedFiles.length} file` : (AppState.importedFiles[0] || '-');
    
    UI.el.statusBar.textContent = `Mode: ${mode} | File: ${files} | Baris: ${total} | TL: ${trans}/${total} (${perc}%)`;
    UI.el.progressFill.style.width = `${perc}%`;
    UI.el.progressText.textContent = `${trans}/${total}`;
  }

  static createMainRow() {
    const row = document.createElement("div");
    row.className = "preview-row";
    const cell = document.createElement("div");
    cell.className = "checkbox-cell";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    const text = document.createElement("div");
    text.className = "text-content";
    const orig = document.createElement("div");
    orig.className = "original";
    const trans = document.createElement("div");
    trans.className = "translated";
    text.append(orig, trans);
    cell.append(cb, text);
    const sep = document.createElement("div");
    sep.style.cssText = "display:none; align-items:center; gap:12px; width:100%;";
    const sepCb = document.createElement("input");
    sepCb.type = "checkbox";
    sepCb.className = "sep-cb";
    const sepLbl = document.createElement("div");
    sepLbl.className = "mono grow";
    sepLbl.style.cssText = "font-weight:700; color:var(--primary);";
    sep.append(sepCb, sepLbl);
    row.append(cell, sep);
    row._cell = cell;
    row._cb = cb;
    row._orig = orig;
    row._trans = trans;
    row._sep = sep;
    row._sepCb = sepCb;
    row._sepLbl = sepLbl;
    return row;
  }

  static updateMainRow(row, rowData) {
    if (rowData.type === "separator") {
      row.className = "preview-row separator";
      row._cell.style.display = "none";
      row._sep.style.display = "flex";
      row._sepCb.dataset.file = rowData.file;
      
      const fileLines = AppState.filesLinesCache.get(rowData.file) || [];
      let allChecked = true;
      let hasUntranslated = false;
      
      for (let i = 0; i < fileLines.length; i++) {
        if (!AppState.isTranslated(fileLines[i])) {
          hasUntranslated = true;
          if (!AppState.selectedLines.has(fileLines[i].line_num)) {
            allChecked = false;
            break;
          }
        }
      }
      row._sepCb.checked = hasUntranslated && allChecked;
      row._sepLbl.textContent = `File: ${rowData.file}`;
    } else {
      const l = rowData.line;
      let cls = "preview-row";
      if (AppState.isTranslated(l)) cls += " row-translated";
      if (AppState.selectedLines.has(l.line_num)) cls += " row-selected";
      row.className = cls;
      row._cell.style.display = "flex";
      row._sep.style.display = "none";
      row._cb.dataset.num = l.line_num;
      row._cb.checked = AppState.selectedLines.has(l.line_num);
      row._cb.disabled = AppState.isTranslated(l);
      row._orig.textContent = l.name ? `${l.line_num}. ${l.name}: ${l.message}` : `${l.line_num}. ${l.message}`;
      
      if (AppState.isTranslated(l)) {
        row._trans.classList.remove("cell-muted");
        const tName = l.trans_name || l.name;
        row._trans.textContent = tName ? `${l.line_num}. ${tName}: ${l.trans_message}` : `${l.line_num}. ${l.trans_message}`;
      } else {
        row._trans.classList.add("cell-muted");
        row._trans.textContent = "——";
      }
    }
  }

  static syncCheckboxes() {
    AppController.mainScroller.forceUpdate();
    AppController.updateButtons();
  }

  static renderNameTable() {
    const namesSet = new Set();
    for (let i = 0; i < AppState.lines.length; i++) {
      if (AppState.lines[i].name) namesSet.add(AppState.lines[i].name);
    }
    const names = Array.from(namesSet).sort();
    UI.el.nameTotalCount.textContent = names.length;
    UI.el.btnCopyAllNames.disabled = names.length === 0;
    UI.el.nameTableBody.replaceChildren();
    const frag = document.createDocumentFragment();
    for (let i = 0; i < names.length; i++) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.className = "mono";
      td.textContent = names[i];
      td.title = "Klik untuk copy";
      tr.appendChild(td);
      frag.appendChild(tr);
    }
    UI.el.nameTableBody.appendChild(frag);
  }

  static selectRange() {
    const f = parseInt(UI.el.rangeFromInput.value);
    const t = parseInt(UI.el.rangeToInput.value);
    let maxLine = 0;
    if (AppState.lines.length > 0) {
      maxLine = AppState.lines.reduce((max, l) => Math.max(max, l.line_num), 0);
    }
    if (isNaN(f) || isNaN(t) || f > t || f < 1 || f > maxLine || t > maxLine) return alert("Range tidak valid.");
    
    AppState.selectedLines.clear();
    for (let i = f; i <= t; i++) {
      const l = AppState.lineByNum.get(i);
      if (l && !AppState.isTranslated(l)) AppState.selectedLines.add(i);
    }
    AppController.syncCheckboxes();
    const idx = AppState.displayRows.findIndex(r => r.type === "line" && r.line.line_num === f);
    if (idx !== -1) {
      AppController.mainScroller.scrollToIndex(idx);
      setTimeout(() => {
        const rowEl = UI.el.previewContainer.querySelector(`input[data-num="${f}"]`)?.closest('.preview-row');
        if (rowEl) {
          const bg = rowEl.style.backgroundColor;
          rowEl.style.transition = "background-color 0.3s ease";
          rowEl.style.backgroundColor = "rgba(59, 130, 246, 0.4)";
          setTimeout(() => { rowEl.style.backgroundColor = bg; }, 800);
        }
      }, 50);
    }
  }

  static async copyForAi() {
    const sel = [];
    for (let i = 0; i < AppState.lines.length; i++) {
      if (AppState.selectedLines.has(AppState.lines[i].line_num)) sel.push(AppState.lines[i]);
    }
    
    const out = [];
    for (let i = 0; i < sel.length; i++) {
      const l = sel[i];
      out.push(l.name ? `${l.line_num}. ${l.name}: ${l.message}` : `${l.line_num}. ${l.message}`);
    }
    
    let p = "";
    if (AppState.aiPromptEnabled) {
      p += `${(AppState.aiInstructionHeader || CONFIG.DEFAULT_PROMPT_HEADER).trim()}\n\n`;
    }

    const useVndb = AppState.vndbEnabled && AppState.vndbGlossary && AppState.vndbGlossary.length > 0;
    const useCustom = AppState.customEnabled && AppState.customGlossary && AppState.customGlossary.length > 0;

    if (useVndb || useCustom) {
      p += `<glossary>\n`;
      if (useVndb) {
        for (let i = 0; i < AppState.vndbGlossary.length; i++) {
          p += `${AppState.vndbGlossary[i][0]}: ${AppState.vndbGlossary[i][1]}\n`;
        }
      }
      if (useCustom) {
        for (let i = 0; i < AppState.customGlossary.length; i++) {
          p += `${AppState.customGlossary[i][0]}: ${AppState.customGlossary[i][1]}\n`;
        }
      }
      p += `</glossary>\n\n`;
    }
    
    if (AppState.contextEnabled && AppState.selectedLines.size > 0) {
      let minSelectedNum = Infinity;
      for (const num of AppState.selectedLines) {
        if (num < minSelectedNum) minSelectedNum = num;
      }
      const translatedBefore = [];
      for (let i = 0; i < AppState.lines.length; i++) {
        if (AppState.lines[i].line_num < minSelectedNum && AppState.isTranslated(AppState.lines[i])) {
          translatedBefore.push(AppState.lines[i]);
        }
      }
      translatedBefore.sort((a, b) => b.line_num - a.line_num);
      const contextLines = translatedBefore.slice(0, AppState.contextSize).reverse();
      
      if (contextLines.length > 0) {
        p += `<context>\n`;
        for (let i = 0; i < contextLines.length; i++) {
          const l = contextLines[i];
          const tName = l.trans_name || l.name;
          p += tName ? `${l.line_num}. ${tName}: ${l.trans_message}\n` : `${l.line_num}. ${l.trans_message}\n`;
        }
        p += `</context>\n\n`;
      }
    }
    
    p += `${out.join("\n")}\n`;
    
    try {
      await navigator.clipboard.writeText(p);
      UI.flashMessage(`Disalin ${sel.length} baris.`);
    } catch (_) {
      UI.el.pasteArea.value = p;
      alert("Clipboard diblokir oleh browser. Teks dipindah ke kolom 'Paste hasil AI' secara otomatis.");
    }
  }

  static applyTranslation() {
    if (!AppState.lines.length) return;
    const rawLines = UI.el.pasteArea.value.split(/\r?\n/);
    const parsed = [];
    const errors = [];
    const seen = new Set();
    
    for (let i = 0; i < rawLines.length; i++) {
      const txt = rawLines[i].trim();
      if (!txt) continue;
      
      const match = txt.match(/^\s*(\d+)\s*[.)]\s*(.*)$/);
      if (!match) {
        errors.push(`[Baris ${i + 1}] Format rusak -> "${txt.substring(0, 25)}..."`);
        continue;
      }
      
      const num = Number(match[1]);
      if (seen.has(num)) errors.push(`[Baris ${num}] Duplikat nomor.`);
      seen.add(num);
      
      let name = null;
      let msg = match[2].trim();
      let rawMsg = msg;
      
      const colon1 = msg.indexOf(':');
      const colon2 = msg.indexOf('：');
      let splitIdx = Infinity;
      if (colon1 !== -1) splitIdx = colon1;
      if (colon2 !== -1 && colon2 < splitIdx) splitIdx = colon2;
      
      if (splitIdx !== Infinity) {
        name = msg.substring(0, splitIdx).trim();
        msg = msg.substring(splitIdx + 1).trim();
      }
      parsed.push({ num, name, msg, rawMsg });
    }
    
    if (parsed.length === 0 && errors.length === 0) return alert("Kosong atau tidak valid.");
    if (parsed.length !== AppState.selectedLines.size) errors.push(`Jumlah baris tidak sesuai seleksi.`);
    
    for (const num of AppState.selectedLines) {
      if (!seen.has(num)) errors.push(`[Baris ${num}] Hilang.`);
    }
    for (const num of seen) {
      if (!AppState.selectedLines.has(num)) errors.push(`[Baris ${num}] Tidak dicentang.`);
    }
    
    const updates = [];
    for (let i = 0; i < parsed.length; i++) {
      const it = parsed[i];
      const l = AppState.lineByNum.get(it.num);
      if (!l) {
        errors.push(`[Baris ${it.num}] Tidak ada di JSON.`);
        continue;
      }
      if (AppState.ignoreNameTranslation && l.name) it.name = l.name;
      
      const oN = !!(l.name || "").trim();
      let tN = !!(it.name || "").trim();
      
      if (!oN && tN) {
        it.msg = it.rawMsg;
        it.name = null;
        tN = false;
      }
      
      if (oN && !tN) errors.push(`[Baris ${it.num}] Nama karakter hilang.`);
      else if (!oN && tN) errors.push(`[Baris ${it.num}] Tiba-tiba ada nama.`);
      else if (!it.msg) errors.push(`[Baris ${it.num}] Pesan kosong.`);
      else updates.push({ l, it });
    }
    
    if (errors.length > 0) {
      let msg = "DITOLAK:\n" + errors.slice(0, 10).join("\n");
      if (errors.length > 10) msg += `\n... (+${errors.length - 10} lain)`;
      return alert(msg);
    }
    
    AppState.undoSnapshot = {
      lines: JSON.parse(JSON.stringify(AppState.lines)),
      selected: new Set(AppState.selectedLines)
    };
    AppState.redoSnapshot = null;
    
    for (let i = 0; i < updates.length; i++) {
      const l = updates[i].l;
      const it = updates[i].it;
      l.trans_message = it.msg;
      l.is_translated = true;
      if (it.name) l.trans_name = AppState.ignoreNameTranslation ? null : it.name;
      AppState.selectedLines.delete(l.line_num);
    }
    
    UI.el.pasteArea.value = "";
    AppController.refreshWorkspace();
    AppState.queueAutoSave();
    UI.flashMessage(`${updates.length} baris sukses.`);
  }

  static undoTranslation() {
    if (!AppState.undoSnapshot) return;
    AppState.redoSnapshot = { lines: JSON.parse(JSON.stringify(AppState.lines)), selected: new Set(AppState.selectedLines) };
    AppState.lines = AppState.undoSnapshot.lines.map(AppState.normalizeLine);
    AppState.selectedLines = new Set(AppState.undoSnapshot.selected);
    AppState.undoSnapshot = null;
    AppController.refreshWorkspace();
    AppState.queueAutoSave();
  }

  static redoTranslation() {
    if (!AppState.redoSnapshot) return;
    AppState.undoSnapshot = { lines: JSON.parse(JSON.stringify(AppState.lines)), selected: new Set(AppState.selectedLines) };
    AppState.lines = AppState.redoSnapshot.lines.map(AppState.normalizeLine);
    AppState.selectedLines = new Set(AppState.redoSnapshot.selected);
    AppState.redoSnapshot = null;
    AppController.refreshWorkspace();
    AppState.queueAutoSave();
  }

  static openLineEditor(num) {
    const l = AppState.lineByNum.get(num);
    if (!l) return;
    AppController.activeEditorLineNum = num;
    UI.el.lineEditorTitle.textContent = `Edit Baris ${num}`;
    UI.el.lineOriginalView.value = l.name ? `${l.name}: ${l.message}` : l.message;
    UI.el.lineNameWrap.style.display = l.name ? "block" : "none";
    UI.el.lineNameInput.value = l.name ? (l.trans_name || "") : "";
    if (l.name) UI.el.lineNameInput.placeholder = l.name;
    UI.el.lineMessageInput.value = (l.trans_message || "").trim();
    UI.el.lineTranslatedCheck.checked = AppState.isTranslated(l);
    UI.toggleModal(UI.el.lineEditorModal, true);
  }

  static saveLineEditor() {
    const l = AppState.lineByNum.get(AppController.activeEditorLineNum);
    if (!l) return;
    const m = UI.el.lineMessageInput.value.trim().replace(/\r?\n/g, "\\n");
    if (UI.el.lineTranslatedCheck.checked && !m) return alert("Pesan kosong.");
    l.trans_message = m || null;
    l.is_translated = !!(UI.el.lineTranslatedCheck.checked && m);
    if (l.name) l.trans_name = UI.el.lineNameInput.value.trim().replace(/\r?\n/g, "\\n") || null;
    AppState.redoSnapshot = null;
    UI.toggleModal(UI.el.lineEditorModal, false);
    AppController.refreshWorkspace();
    if (UI.el.proofreadModal.classList.contains("open")) AppController.renderProofread();
    AppState.queueAutoSave();
  }

  static createHighlight(text, regex) {
    if (!regex) return document.createTextNode(text);
    const frag = document.createDocumentFragment();
    const parts = text.split(regex);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        const mark = document.createElement("mark");
        mark.className = "highlight";
        mark.textContent = parts[i];
        frag.appendChild(mark);
      } else if (parts[i]) {
        frag.appendChild(document.createTextNode(parts[i]));
      }
    }
    return frag;
  }

  static openProofread() {
    UI.toggleModal(UI.el.proofreadModal, true);
    AppController.renderProofread();
  }

  static renderProofread() {
    if (!UI.el.proofreadModal.classList.contains("open")) return;
    const q = UI.el.proofreadSearchInput.value;
    const isReg = UI.el.proofreadRegexCheck.checked;
    const isC = UI.el.proofreadCaseCheck.checked || UI.el.proofreadExactCheck.checked;
    const isEx = UI.el.proofreadExactCheck.checked;
    const onlyT = UI.el.proofreadTranslatedOnlyCheck.checked;
    const scope = UI.el.proofreadScope.value;
    
    let searchRegex = null;
    AppController.currentHighlightRegex = null;
    
    if (q) {
      try {
        let rStr = isReg ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (isEx) rStr = `(?<![\\p{L}\\p{N}_])${rStr}(?![\\p{L}\\p{N}_])`;
        searchRegex = new RegExp(rStr, isC ? "gu" : "giu");
        AppController.currentHighlightRegex = new RegExp(`(${rStr})`, isC ? "gu" : "giu");
      } catch (e) {
        return;
      }
    }
    
    AppState.proofreadMatches = [];
    for (let i = 0; i < AppState.lines.length; i++) {
      const line = AppState.lines[i];
      if (onlyT && !AppState.isTranslated(line)) continue;
      
      const dName = line.name || "";
      const fName = AppState.isTranslated(line) ? (line.trans_name || "").trim() || line.name : null;
      const tMsg = onlyT ? line.trans_message : line.message;
      const tName = onlyT ? fName : dName;
      
      if (q && searchRegex) {
        let match = false;
        searchRegex.lastIndex = 0;
        if ((scope === 'all' || scope === 'message') && tMsg && searchRegex.test(tMsg)) match = true;
        searchRegex.lastIndex = 0;
        if (!match && (scope === 'all' || scope === 'name') && tName && searchRegex.test(tName)) match = true;
        if (!match) continue;
      }
      
      AppState.proofreadMatches.push({
        num: line.line_num,
        file: line.file,
        origName: dName,
        origMsg: line.message,
        transName: fName,
        transMsg: line.trans_message,
        isTrans: AppState.isTranslated(line)
      });
    }
    
    UI.el.proofreadStatus.textContent = `Ditemukan ${AppState.proofreadMatches.length} baris.`;
    AppController.proofreadScroller.setItems(AppState.proofreadMatches);
  }

  static createProofreadRow() {
    const row = document.createElement("div");
    row.className = "preview-row";
    const wrap = document.createElement("div");
    wrap.className = "text-content";
    const meta = document.createElement("div");
    meta.className = "file-meta";
    const orig = document.createElement("div");
    orig.className = "original";
    const trans = document.createElement("div");
    trans.className = "translated";
    wrap.append(meta, orig, trans);
    row.append(wrap);
    row._wrap = wrap;
    row._meta = meta;
    row._orig = orig;
    row._trans = trans;
    return row;
  }

  static updateProofreadRow(row, r) {
    row._wrap.dataset.num = r.num;
    row._meta.textContent = `File: ${r.file} | Baris: ${r.num}`;
    row._orig.replaceChildren();
    row._trans.replaceChildren();
    
    const onlyT = UI.el.proofreadTranslatedOnlyCheck.checked;
    const scope = UI.el.proofreadScope.value;
    
    const build = (n, m, hl) => {
      const f = document.createDocumentFragment();
      if (n) {
        if (hl && (scope === 'all' || scope === 'name')) f.appendChild(AppController.createHighlight(n, AppController.currentHighlightRegex));
        else f.appendChild(document.createTextNode(n));
        f.appendChild(document.createTextNode(": "));
      }
      if (hl && (scope === 'all' || scope === 'message')) f.appendChild(AppController.createHighlight(m, AppController.currentHighlightRegex));
      else f.appendChild(document.createTextNode(m));
      return f;
    };
    
    if (!r.isTrans) row._trans.classList.add("cell-muted");
    else row._trans.classList.remove("cell-muted");
    
    if (onlyT) {
      row._orig.textContent = r.origName ? `${r.origName}: ${r.origMsg}` : r.origMsg;
      if (r.isTrans) row._trans.appendChild(build(r.transName, r.transMsg, true));
      else row._trans.textContent = "——";
    } else {
      row._orig.appendChild(build(r.origName, r.origMsg, true));
      if (r.isTrans) row._trans.textContent = r.transName ? `${r.transName}: ${r.transMsg}` : r.transMsg;
      else row._trans.textContent = "——";
    }
  }

  static execReplaceAll() {
    const q = UI.el.proofreadSearchInput.value;
    const rep = UI.el.proofreadReplaceInput.value;
    if (!q) return alert("Pencarian kosong!");
    
    let regex;
    try {
      let rStr = UI.el.proofreadRegexCheck.checked ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (UI.el.proofreadExactCheck.checked) rStr = `(?<![\\p{L}\\p{N}_])${rStr}(?![\\p{L}\\p{N}_])`;
      regex = new RegExp(rStr, (UI.el.proofreadCaseCheck.checked || UI.el.proofreadExactCheck.checked) ? 'gu' : 'giu');
    } catch (e) {
      return alert("Regex tidak valid.");
    }
    
    let count = 0;
    AppState.undoSnapshot = { lines: JSON.parse(JSON.stringify(AppState.lines)), selected: new Set(AppState.selectedLines) };
    AppState.redoSnapshot = null;
    
    const onlyT = UI.el.proofreadTranslatedOnlyCheck.checked;
    const scope = UI.el.proofreadScope.value;
    
    for (let i = 0; i < AppState.lines.length; i++) {
      const line = AppState.lines[i];
      if (onlyT && !AppState.isTranslated(line)) continue;
      
      let replaced = false;
      const tMsg = onlyT ? 'trans_message' : 'message';
      const tName = onlyT ? 'trans_name' : 'name';
      
      if ((scope === 'all' || scope === 'message') && line[tMsg]) {
        const newVal = line[tMsg].replace(regex, rep);
        if (newVal !== line[tMsg]) {
          line[tMsg] = newVal;
          replaced = true;
        }
      }
      
      if ((scope === 'all' || scope === 'name') && line[tName]) {
        const newVal = line[tName].replace(regex, rep);
        if (newVal !== line[tName]) {
          line[tName] = newVal;
          replaced = true;
        }
      }
      if (replaced) count++;
    }
    
    if (count > 0) {
      AppController.refreshWorkspace();
      AppController.renderProofread();
      AppState.queueAutoSave();
      alert(`Berhasil replace pada ${count} baris.`);
    } else {
      alert(`Tidak ada yang cocok.`);
    }
  }
}

document.addEventListener("DOMContentLoaded", AppController.init);