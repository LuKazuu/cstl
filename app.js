const CONFIG = Object.freeze({
  APP_VERSION: 7,
  PROJECT_EXT: ".cstl",
  DEFAULT_PROMPT_HEADER: `Rewrite entire text to Native Indonesian. Do not change prefix number. Euphemism prohibited. Use of "Bahasa Jakarta Selatan" is prohibited. Put results inside plaintext block.`,
  DEFAULT_EPUB_TAGS: "p",
  DEFAULT_IGNORE_NAME_TL: false,
  DEFAULT_PROMPT_ENABLED: true,
  DEFAULT_CONTEXT_ENABLED: false,
  DEFAULT_CONTEXT_SIZE: 5,
  SCROLLER_MAIN_HEIGHT: 90,
  SCROLLER_PROOFREAD_HEIGHT: 90,
  SCROLLER_BUFFER: 20,
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
    const ids = [
      "dashboardView", "workspaceView", "projectList", "btnNewProject", "btnRestoreProject",
      "btnBackToDashboard", "projectNameDisplay", "restoreProjectInput", "btnImportFile",
      "btnImportFolder", "btnImportZip", "btnExport", "btnProofread", "btnSettings",
      "previewViewport", "previewContainer", "progressFill", "progressText", "btnSelectAll",
      "btnClearSelection", "copyCount", "btnCopyForAi", "copyStatus", "pasteArea", "btnApply",
      "btnUndo", "nameTableBody", "statusBar", "importFileInput", "importFolderInput",
      "importZipInput", "settingsModal", "settingsIgnoreNameCheck", "settingsPromptCheck", "settingsContextCheck", 
      "settingsContextWrap", "settingsContextInput", "btnSettingsContextApply", "maxContextDisplay",
      "settingsPromptInput", "settingsEpubTagsInput",
      "btnSettingsDasarReset", "btnSettingsPromptReset", "btnSettingsEpubReset", "btnSettingsCancel", "btnSettingsSave", 
      "lineEditorModal", "lineEditorTitle",
      "lineOriginalView", "lineNameWrap", "lineNameInput", "lineMessageInput", "lineTranslatedCheck",
      "btnLineCancel", "btnLineSave", "proofreadModal", "proofreadSearchInput", "proofreadScope",
      "proofreadRegexCheck", "proofreadCaseCheck", "proofreadExactCheck", "proofreadTranslatedOnlyCheck",
      "btnProofreadReset", "proofreadStatus", "proofreadContainer", "btnProofreadClose",
      "proofreadReplaceInput", "btnProofreadReplaceAll", "rangeFromInput", "rangeToInput", "btnSelectRange"
    ];
    for (const id of ids) UI.el[id] = document.getElementById(id);
  }

  static toggleModal(element, state) {
    state ? element.classList.add("open") : element.classList.remove("open");
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
    for (const key in attributes) node[key] = attributes[key];
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
        } catch (e) { }
      }
    }
    return projects.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  static async removeProject(id, epubSourceId) {
    const root = await StorageManager.getRoot();
    if (epubSourceId) {
      try { await root.removeEntry(epubSourceId); } catch (e) { }
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
  static undoSnapshot = null;
  static selectedLines = new Set();
  static displayRows = [];
  static lineByNum = new Map();
  static filesLinesCache = new Map();
  static proofreadMatches = [];
  static saveTimeout = null;

  static isTranslated(line) {
    return !!line.is_translated && !!String(line.trans_message).trim();
  }

  static normalizeLine(line) {
    return {
      line_num: Number(line.line_num),
      file: String(line.file),
      name: line.name == null ? null : String(line.name).replace(/\r?\n/g, "\\n").trim(),
      message: String(line.message).replace(/\r?\n/g, "\\n").trim(),
      trans_name: line.trans_name == null ? null : String(line.trans_name).replace(/\r?\n/g, "\\n").trim(),
      trans_message: line.trans_message == null ? null : String(line.trans_message).replace(/\r?\n/g, "\\n").trim(),
      is_translated: Boolean(line.is_translated),
    };
  }

  static rebuildCache() {
    AppState.lineByNum.clear();
    AppState.filesLinesCache.clear();
    const grouped = new Map(AppState.importedFiles.map(f => [f, []]));
    for (const line of AppState.lines) {
      AppState.lineByNum.set(line.line_num, line);
      if (!grouped.has(line.file)) grouped.set(line.file, []);
      grouped.get(line.file).push(line);
    }
    AppState.displayRows = [];
    for (const [fileName, rows] of grouped.entries()) {
      AppState.filesLinesCache.set(fileName, rows);
      if (!rows.length) continue;
      AppState.displayRows.push({ type: "separator", file: fileName });
      for (const line of rows) {
        AppState.displayRows.push({ type: "line", line });
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
      contextSize: AppState.contextSize
    };
    await StorageManager.saveProject(AppState.currentProjectId, data);
    UI.el.statusBar.textContent = UI.el.statusBar.textContent.replace(" | Tersimpan!", "") + " | Tersimpan!";
    setTimeout(() => AppController.updateStatusBar(), 2000);
  }
}

class VirtualScroller {
  constructor(viewport, container, estimatedHeight, renderItem) {
    this.viewport = viewport;
    this.container = container;
    this.estimatedHeight = estimatedHeight;
    this.renderItem = renderItem;
    this.items = [];
    this.heights = [];
    this.positions = [];
    this.totalHeight = 0;
    this.scrollTop = 0;
    this.ticking = false;
    this.lastStart = -1;
    this.lastEnd = -1;
    
    this.onScroll = this.onScroll.bind(this);
    this.viewport.addEventListener('scroll', this.onScroll, { passive: true });
    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        if (this.viewport.clientHeight > 0) this.render(true);
      }).observe(this.viewport);
    }
  }

  setItems(items) {
    this.items = items;
    this.heights = new Array(items.length).fill(this.estimatedHeight);
    this.updatePositions();
    this.scrollTop = this.viewport.scrollTop = 0;
    this.lastStart = -1;
    this.lastEnd = -1;
    this.render(true);
  }

  updatePositions() {
    let top = 0;
    this.positions = new Array(this.items.length);
    for (let i = 0; i < this.items.length; i++) {
      this.positions[i] = top;
      top += this.heights[i];
    }
    this.totalHeight = top;
  }

  scrollToIndex(index) {
    if (index < 0 || index >= this.items.length) return;
    this.viewport.scrollTop = this.positions[index];
    this.scrollTop = this.viewport.scrollTop;
    this.render(true);
  }

  onScroll() {
    if (!this.ticking) {
      window.requestAnimationFrame(() => {
        this.scrollTop = this.viewport.scrollTop;
        this.render();
        this.ticking = false;
      });
      this.ticking = true;
    }
  }

  findStartIndex() {
    let low = 0, high = this.items.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const midTop = this.positions[mid];
      const midBottom = midTop + this.heights[mid];
      if (this.scrollTop >= midTop && this.scrollTop < midBottom) return mid;
      if (this.scrollTop < midTop) high = mid - 1;
      else low = mid + 1;
    }
    return Math.max(0, Math.min(low, this.items.length - 1));
  }

  render(force = false) {
    const viewportHeight = this.viewport.clientHeight || 800;
    const total = this.items.length;
    if (!total) {
      this.container.innerHTML = "";
      return;
    }
    const buffer = CONFIG.SCROLLER_BUFFER;
    let targetStart = Math.max(0, this.findStartIndex() - Math.floor(buffer / 2));
    let end = targetStart;
    let currentHeight = 0;
    while (end < total && currentHeight < viewportHeight + (buffer * this.estimatedHeight)) {
      currentHeight += this.heights[end];
      end++;
    }
    end = Math.min(total, end);
    if (!force && this.lastStart === targetStart && this.lastEnd === end) return;
    this.lastStart = targetStart;
    this.lastEnd = end;
    const topPad = this.positions[targetStart];
    const bottomPad = end < total ? this.totalHeight - this.positions[end] : 0;
    this.container.innerHTML = "";
    
    const topSpacer = UI.createDomNode("div");
    topSpacer.style.height = `${topPad}px`;
    this.container.appendChild(topSpacer);

    const frag = document.createDocumentFragment();
    const rowElements = [];
    for (let i = targetStart; i < end; i++) {
      const el = this.renderItem(this.items[i]);
      el.dataset.vindex = i;
      frag.appendChild(el);
      rowElements.push(el);
    }
    this.container.appendChild(frag);

    const bottomSpacer = UI.createDomNode("div");
    bottomSpacer.style.height = `${bottomPad}px`;
    this.container.appendChild(bottomSpacer);

    window.requestAnimationFrame(() => {
      let changed = false;
      for (const el of rowElements) {
        const idx = parseInt(el.dataset.vindex);
        const rect = el.getBoundingClientRect();
        if (rect.height > 0) {
          const actualHeight = rect.height + 8;
          if (Math.abs(actualHeight - this.heights[idx]) > 1) {
            this.heights[idx] = actualHeight;
            changed = true;
          }
        }
      }
      if (changed) {
        this.updatePositions();
        if (this.container.firstElementChild) {
           this.container.firstElementChild.style.height = `${this.positions[this.lastStart]}px`;
        }
        if (this.container.lastElementChild) {
           const updatedBottomPad = this.lastEnd < this.items.length ? this.totalHeight - this.positions[this.lastEnd] : 0;
           this.container.lastElementChild.style.height = `${updatedBottomPad}px`;
        }
      }
    });
  }
}

class Importer {
  static decodeBuffer(buffer) {
    for (const enc of CONFIG.ENCODINGS) {
      try { return new TextDecoder(enc, { fatal: true }).decode(buffer); }
      catch (_) {}
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
          if (p.length) { existingFiles.add(baseName); lines.push(...p); cur += p.length; }
          await new Promise(r => setTimeout(r, 0));
        }
      } else {
        const files = Array.from(filesObj).sort((a,b) => a.name.localeCompare(b.name));
        for (const f of files) {
          if (f.name.toLowerCase().endsWith(".epub")) {
            if (AppState.projectType === "epub" && AppState.epubSourceId) {
              alert("Proyek ini sudah memuat file EPUB. Buat proyek baru untuk mengimpor EPUB lain.");
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
              if (existingFiles.has(href)) { skippedFiles.push(href); continue; }
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
                    line_num: cur++, file: href, name: null, message: text,
                    trans_name: null, trans_message: null, is_translated: false
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
            if (existingFiles.has(baseName)) { skippedFiles.push(baseName); continue; }
            const content = JSON.parse(Importer.decodeBuffer(await f.arrayBuffer()));
            const p = Importer.parseJsonData(content, baseName, cur);
            if (p.length) { existingFiles.add(baseName); lines.push(...p); cur += p.length; }
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
          e.name = AppState.isTranslated(l) ? (l.trans_name || l.name) : l.name;
          e.message = AppState.isTranslated(l) ? l.trans_message : l.message;
          if (e.name) e.name = e.name.replace(/\\n/g, "\n");
          if (e.message) e.message = e.message.replace(/\\n/g, "\n");
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

class AppController {
  static mainScroller = null;
  static proofreadScroller = null;
  static activeEditorLineNum = null;

  static async init() {
    UI.cache();
    if (!navigator.storage || !navigator.storage.getDirectory) {
      alert("Browser kamu tidak mendukung Sistem File OPFS.");
      UI.el.projectList.innerHTML = `<p class="hint" style="grid-column: 1/-1; color: var(--danger);">Browser tidak mendukung OPFS.</p>`;
      return;
    }
    AppController.mainScroller = new VirtualScroller(UI.el.previewViewport, UI.el.previewContainer, CONFIG.SCROLLER_MAIN_HEIGHT, AppController.renderMainRow);
    const prViewport = UI.el.proofreadContainer.closest('.proofread-results-wrap');
    AppController.proofreadScroller = new VirtualScroller(prViewport, UI.el.proofreadContainer, CONFIG.SCROLLER_PROOFREAD_HEIGHT, AppController.renderProofreadRow);
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

  static evalContextApplyBtn(transCount) {
    if (!UI.el.settingsContextCheck.checked) {
      UI.el.btnSettingsContextApply.disabled = true;
      return;
    }
    const val = parseInt(UI.el.settingsContextInput.value);
    if (isNaN(val) || val === AppState.contextSize || val > transCount || val < 5) {
      UI.el.btnSettingsContextApply.disabled = true;
    } else {
      UI.el.btnSettingsContextApply.disabled = false;
    }
  }

  static bindEvents() {
    UI.el.btnNewProject.addEventListener("click", AppController.createNewProject);
    UI.el.btnBackToDashboard.addEventListener("click", AppController.closeProject);
    UI.el.btnRestoreProject.addEventListener("click", () => UI.el.restoreProjectInput.click());
    
    UI.el.restoreProjectInput.addEventListener("change", AppController.restoreProject);
    
    UI.el.btnImportFile.addEventListener("click", () => UI.el.importFileInput.click());
    UI.el.importFileInput.addEventListener("change", async e => {
      if (!e.target.files.length) return;
      await Importer.processImport(e.target.files);
      e.target.value = "";
    });

    UI.el.btnImportFolder.addEventListener("click", () => UI.el.importFolderInput.click());
    UI.el.importFolderInput.addEventListener("change", async e => {
      if (!e.target.files.length) return;
      await Importer.processImport(e.target.files);
      e.target.value = "";
    });

    UI.el.btnImportZip.addEventListener("click", () => UI.el.importZipInput.click());
    UI.el.importZipInput.addEventListener("change", async e => {
      if (!e.target.files.length) return;
      await Importer.processImport(e.target.files[0], true);
      e.target.value = "";
    });
    
    UI.el.btnExport.addEventListener("click", Exporter.exportData);
    UI.el.btnCopyForAi.addEventListener("click", AppController.copyForAi);
    UI.el.btnApply.addEventListener("click", AppController.applyTranslation);
    UI.el.btnUndo.addEventListener("click", AppController.undoTranslation);
    UI.el.btnProofread.addEventListener("click", AppController.openProofread);
    
    UI.el.btnSelectAll.addEventListener("click", () => {
      AppState.lines.forEach(l => { if (!AppState.isTranslated(l)) AppState.selectedLines.add(l.line_num); });
      AppController.syncCheckboxes();
    });
    
    UI.el.btnClearSelection.addEventListener("click", () => {
      AppState.selectedLines.clear();
      AppController.syncCheckboxes();
    });
    
    UI.el.btnSelectRange.addEventListener("click", AppController.selectRange);
    
    UI.el.btnSettings.addEventListener("click", () => {
      UI.el.settingsIgnoreNameCheck.checked = AppState.ignoreNameTranslation;
      UI.el.settingsPromptCheck.checked = AppState.aiPromptEnabled;
      UI.el.settingsContextCheck.checked = AppState.contextEnabled;
      UI.el.settingsPromptInput.value = AppState.aiInstructionHeader;
      UI.el.settingsEpubTagsInput.value = AppState.epubTags || CONFIG.DEFAULT_EPUB_TAGS;
      
      const transCount = AppState.lines.filter(AppState.isTranslated).length;
      UI.el.maxContextDisplay.textContent = transCount;
      UI.el.settingsContextInput.value = AppState.contextSize;
      
      UI.el.settingsContextWrap.style.opacity = AppState.contextEnabled ? "1" : "0.4";
      UI.el.settingsContextWrap.style.pointerEvents = AppState.contextEnabled ? "auto" : "none";
      UI.el.settingsContextInput.disabled = !AppState.contextEnabled || (transCount < 5);

      AppController.evalContextApplyBtn(transCount);
      
      UI.toggleModal(UI.el.settingsModal, true);
    });

    UI.el.settingsContextCheck.addEventListener("change", (e) => {
      const isChecked = e.target.checked;
      const transCount = AppState.lines.filter(AppState.isTranslated).length;
      
      UI.el.settingsContextWrap.style.opacity = isChecked ? "1" : "0.4";
      UI.el.settingsContextWrap.style.pointerEvents = isChecked ? "auto" : "none";
      
      if (!isChecked) {
        UI.el.settingsContextInput.disabled = true;
        UI.el.btnSettingsContextApply.disabled = true;
      } else {
        UI.el.settingsContextInput.disabled = transCount < 5;
        AppController.evalContextApplyBtn(transCount);
      }
    });

    UI.el.settingsContextInput.addEventListener("input", () => {
      const transCount = AppState.lines.filter(AppState.isTranslated).length;
      AppController.evalContextApplyBtn(transCount);
    });

    UI.el.btnSettingsContextApply.addEventListener("click", () => {
      const val = parseInt(UI.el.settingsContextInput.value);
      if (!isNaN(val)) {
        AppState.contextSize = val;
        AppState.queueAutoSave();
        const transCount = AppState.lines.filter(AppState.isTranslated).length;
        AppController.evalContextApplyBtn(transCount);
      }
    });
    
    UI.el.btnSettingsDasarReset.addEventListener("click", () => {
      UI.el.settingsIgnoreNameCheck.checked = CONFIG.DEFAULT_IGNORE_NAME_TL;
      UI.el.settingsPromptCheck.checked = CONFIG.DEFAULT_PROMPT_ENABLED;
      UI.el.settingsContextCheck.checked = CONFIG.DEFAULT_CONTEXT_ENABLED;
      UI.el.settingsContextInput.value = CONFIG.DEFAULT_CONTEXT_SIZE;
      
      const transCount = AppState.lines.filter(AppState.isTranslated).length;
      UI.el.settingsContextWrap.style.opacity = CONFIG.DEFAULT_CONTEXT_ENABLED ? "1" : "0.4";
      UI.el.settingsContextWrap.style.pointerEvents = CONFIG.DEFAULT_CONTEXT_ENABLED ? "auto" : "none";
      UI.el.settingsContextInput.disabled = !CONFIG.DEFAULT_CONTEXT_ENABLED || (transCount < 5);
      AppController.evalContextApplyBtn(transCount);
    });

    UI.el.btnSettingsPromptReset.addEventListener("click", () => {
      UI.el.settingsPromptInput.value = CONFIG.DEFAULT_PROMPT_HEADER;
    });

    UI.el.btnSettingsEpubReset.addEventListener("click", () => {
      UI.el.settingsEpubTagsInput.value = CONFIG.DEFAULT_EPUB_TAGS;
    });
    
    UI.el.btnSettingsCancel.addEventListener("click", () => UI.toggleModal(UI.el.settingsModal, false));
    
    UI.el.btnSettingsSave.addEventListener("click", () => {
      AppState.ignoreNameTranslation = UI.el.settingsIgnoreNameCheck.checked;
      AppState.aiPromptEnabled = UI.el.settingsPromptCheck.checked;
      AppState.contextEnabled = UI.el.settingsContextCheck.checked;
      AppState.aiInstructionHeader = UI.el.settingsPromptInput.value.trim();
      AppState.epubTags = UI.el.settingsEpubTagsInput.value.trim() || CONFIG.DEFAULT_EPUB_TAGS;
      UI.toggleModal(UI.el.settingsModal, false);
      AppState.queueAutoSave();
    });
    
    UI.el.btnLineCancel.addEventListener("click", () => UI.toggleModal(UI.el.lineEditorModal, false));
    UI.el.btnLineSave.addEventListener("click", AppController.saveLineEditor);
    UI.el.btnProofreadClose.addEventListener("click", () => UI.toggleModal(UI.el.proofreadModal, false));
    
    UI.el.btnProofreadReset.addEventListener("click", () => {
      UI.el.proofreadSearchInput.value = ""; UI.el.proofreadReplaceInput.value = "";
      UI.el.proofreadScope.value = "all"; UI.el.proofreadRegexCheck.checked = false;
      UI.el.proofreadCaseCheck.checked = false; UI.el.proofreadExactCheck.checked = false;
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

    UI.el.previewContainer.addEventListener("change", (e) => {
      if (e.target.matches('.preview-row.separator input[type="checkbox"]')) {
        const file = e.target.dataset.file;
        const fileLines = AppState.filesLinesCache.get(file) || [];
        fileLines.forEach(l => {
          if (!AppState.isTranslated(l)) {
            e.target.checked ? AppState.selectedLines.add(l.line_num) : AppState.selectedLines.delete(l.line_num);
          }
        });
        AppController.syncCheckboxes();
      } else if (e.target.matches('.preview-row:not(.separator) input[type="checkbox"]')) {
        const num = Number(e.target.dataset.num);
        e.target.checked ? AppState.selectedLines.add(num) : AppState.selectedLines.delete(num);
        AppController.syncCheckboxes();
      }
    });

    UI.el.previewContainer.addEventListener("click", (e) => {
      const content = e.target.closest('.text-content');
      if (content) {
        const row = content.closest('.preview-row');
        if (row && !row.classList.contains('separator')) {
          const cb = row.querySelector('input[type="checkbox"]');
          if (cb && cb.dataset.num) {
            AppController.openLineEditor(Number(cb.dataset.num));
          }
        }
      }
    });

    UI.el.proofreadContainer.addEventListener("click", (e) => {
      const content = e.target.closest('.text-content');
      if (content) {
        const numData = content.dataset.num;
        if (numData) {
          AppController.openLineEditor(Number(numData));
        }
      }
    });
  }

  static async loadDashboard() {
    UI.el.projectList.innerHTML = "";
    try {
      const projects = await StorageManager.fetchProjects();
      if (projects.length === 0) {
        UI.el.projectList.innerHTML = `<p class="hint" style="grid-column: 1/-1;">Belum ada proyek. Klik "Buat Proyek Baru" untuk memulai.</p>`;
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
        card.querySelector(".btn-open").addEventListener("click", () => AppController.openProject(p.id, p.data));
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
              contextSize: p.data.contextSize
            };
            zip.file("metadata.json", JSON.stringify(meta));
            
            let origStr = "", transStr = "", nameStr = "";
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
      let currentFile = CONFIG.FALLBACK_FILENAME, lineNum = 1;

      for (let i = 0; i < origLines.length; i++) {
        const o = origLines[i], t = transLines[i], n = nameLines[i];
        
        if (o.startsWith(fileMarkerPrefix) && o.endsWith(fileMarkerSuffix)) {
          if (t !== o || n !== o) throw new Error("Berkas korup: Header file tidak sinkron.");
          currentFile = o.substring(fileMarkerPrefix.length, o.length - fileMarkerSuffix.length);
        } else {
          let oName = null, tName = null;
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
        contextSize: p.contextSize ?? CONFIG.DEFAULT_CONTEXT_SIZE
      };

      await StorageManager.saveProject("proj_" + Date.now() + CONFIG.PROJECT_EXT, data);
      await AppController.loadDashboard();
      alert(`Proyek "${name}" berhasil dipulihkan!`);
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
      version: CONFIG.APP_VERSION, projectName: name.trim(), projectType: CONFIG.PROJECT_TYPE_UNINITIALIZED, epubTags: CONFIG.DEFAULT_EPUB_TAGS, epubSourceId: null,
      updatedAt: Date.now(), imported_files: [], lines: [], prompt_header: CONFIG.DEFAULT_PROMPT_HEADER, ignoreNameTranslation: CONFIG.DEFAULT_IGNORE_NAME_TL,
      promptEnabled: CONFIG.DEFAULT_PROMPT_ENABLED, contextEnabled: CONFIG.DEFAULT_CONTEXT_ENABLED, contextSize: CONFIG.DEFAULT_CONTEXT_SIZE
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
    AppState.selectedLines.clear();
    AppState.undoSnapshot = null;
    UI.el.projectNameDisplay.textContent = AppState.projectName;
    UI.el.dashboardView.classList.remove("open");
    UI.el.workspaceView.style.display = "flex";
    AppController.refreshWorkspace();
  }

  static closeProject() {
    if (AppState.saveTimeout) {
      clearTimeout(AppState.saveTimeout);
      const data = {
        version: CONFIG.APP_VERSION, projectName: AppState.projectName, projectType: AppState.projectType,
        epubTags: AppState.epubTags, epubSourceId: AppState.epubSourceId, imported_files: AppState.importedFiles,
        lines: AppState.lines, prompt_header: AppState.aiInstructionHeader, ignoreNameTranslation: AppState.ignoreNameTranslation,
        promptEnabled: AppState.aiPromptEnabled, contextEnabled: AppState.contextEnabled, contextSize: AppState.contextSize
      };
      StorageManager.saveProject(AppState.currentProjectId, data).then(AppController.finishClose);
    } else {
      AppController.finishClose();
    }
  }

  static finishClose() {
    AppState.currentProjectId = null;
    AppState.lines = [];
    UI.el.workspaceView.style.display = "none";
    UI.el.dashboardView.classList.add("open");
    AppController.loadDashboard();
  }

  static refreshWorkspace() {
    AppState.rebuildCache();
    if (AppController.mainScroller.items && AppController.mainScroller.items.length === AppState.displayRows.length && AppController.mainScroller.items.length > 0) {
      AppController.mainScroller.items = AppState.displayRows;
      AppController.mainScroller.render(true);
    } else {
      AppController.mainScroller.setItems(AppState.displayRows);
    }
    AppController.updateButtons();
    AppController.renderNameTable();
    AppController.updateStatusBar();
    UI.el.btnUndo.disabled = !AppState.undoSnapshot;
  }

  static updateButtons() {
    const dataOk = AppState.lines.length > 0;
    const selOk = AppState.selectedLines.size > 0;
    UI.el.btnExport.disabled = UI.el.btnProofread.disabled = UI.el.btnSelectAll.disabled = UI.el.pasteArea.disabled = UI.el.btnApply.disabled = UI.el.rangeFromInput.disabled = UI.el.rangeToInput.disabled = UI.el.btnSelectRange.disabled = !dataOk;
    UI.el.btnClearSelection.disabled = UI.el.btnCopyForAi.disabled = !selOk;
    UI.el.copyCount.textContent = AppState.selectedLines.size;
  }

  static updateStatusBar() {
    const total = AppState.lines.length;
    const trans = AppState.lines.filter(AppState.isTranslated).length;
    const perc = total ? Math.floor((trans / total) * 100) : 0;
    const mode = AppState.projectType === CONFIG.PROJECT_TYPE_UNINITIALIZED ? "-" : (AppState.projectType === "epub" ? "EPUB" : "JSON-VNTP");
    const files = AppState.importedFiles.length > 1 ? `${AppState.importedFiles.length} file` : (AppState.importedFiles[0] || '-');
    UI.el.statusBar.textContent = `Mode: ${mode} | File: ${files} | Baris: ${total} | TL: ${trans}/${total} (${perc}%)`;
    UI.el.progressFill.style.width = `${perc}%`;
    UI.el.progressText.textContent = `${trans}/${total}`;
  }

  static renderMainRow(rowData) {
    const row = UI.createDomNode("div", "preview-row");
    if (rowData.type === "separator") {
      row.classList.add("separator");
      const cb = UI.createDomNode("input", null, { type: "checkbox" });
      cb.dataset.file = rowData.file;
      const fileLines = AppState.filesLinesCache.get(rowData.file) || [];
      let allChecked = true;
      let hasUntranslated = false;
      for (const l of fileLines) {
        if (!AppState.isTranslated(l)) {
          hasUntranslated = true;
          if (!AppState.selectedLines.has(l.line_num)) {
            allChecked = false;
            break;
          }
        }
      }
      cb.checked = hasUntranslated && allChecked;
      const lbl = UI.createDomNode("div", "mono grow");
      lbl.style.cssText = "font-weight:700; color:var(--primary);";
      lbl.textContent = `File: ${rowData.file}`;
      row.append(cb, lbl);
    } else {
      const line = rowData.line;
      if (AppState.isTranslated(line)) row.classList.add("row-translated");
      const isChecked = AppState.selectedLines.has(line.line_num);
      if (isChecked) row.classList.add("row-selected");
      const cbWrap = UI.createDomNode("div", "checkbox-cell");
      const cb = UI.createDomNode("input", null, { type: "checkbox", checked: isChecked, disabled: AppState.isTranslated(line) });
      cb.dataset.num = line.line_num;
      const content = UI.createDomNode("div", "text-content");
      const orig = UI.createDomNode("div", "original");
      orig.textContent = line.name ? `${line.line_num}. ${line.name}: ${line.message}` : `${line.line_num}. ${line.message}`;
      const trans = UI.createDomNode("div", "translated");
      if (AppState.isTranslated(line)) {
        const tName = line.trans_name || line.name;
        trans.textContent = tName ? `${line.line_num}. ${tName}: ${line.trans_message}` : `${line.line_num}. ${line.trans_message}`;
      } else {
        trans.classList.add("cell-muted");
        trans.textContent = "——";
      }
      content.append(orig, trans);
      cbWrap.append(cb, content);
      row.appendChild(cbWrap);
    }
    return row;
  }

  static syncCheckboxes() {
    document.querySelectorAll('.preview-row.separator input[type="checkbox"]').forEach(cb => {
      const fileLines = AppState.filesLinesCache.get(cb.dataset.file) || [];
      let allChecked = true;
      let hasUntranslated = false;
      for (const l of fileLines) {
        if (!AppState.isTranslated(l)) {
          hasUntranslated = true;
          if (!AppState.selectedLines.has(l.line_num)) {
            allChecked = false;
            break;
          }
        }
      }
      cb.checked = hasUntranslated && allChecked;
    });
    document.querySelectorAll('.preview-row:not(.separator) input[type="checkbox"]').forEach(cb => {
      const num = Number(cb.dataset.num);
      cb.checked = AppState.selectedLines.has(num);
      cb.checked ? cb.closest('.preview-row').classList.add('row-selected') : cb.closest('.preview-row').classList.remove('row-selected');
    });
    AppController.updateButtons();
  }

  static renderNameTable() {
    const names = Array.from(new Set(AppState.lines.map(l => l.name).filter(Boolean))).sort();
    UI.el.nameTableBody.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const n of names) {
      const tr = UI.createDomNode("tr");
      const td = UI.createDomNode("td", "mono", { textContent: n, title: "Klik untuk copy" });
      td.addEventListener("click", async () => {
        try { 
          await navigator.clipboard.writeText(n); 
          UI.flashMessage(`Nama "${n}" disalin!`); 
        } catch (e) { 
          alert(`Clipboard diblokir oleh browser untuk teks:\n${n}`);
        }
      });
      tr.appendChild(td);
      frag.appendChild(tr);
    }
    UI.el.nameTableBody.appendChild(frag);
  }

  static selectRange() {
    const f = parseInt(UI.el.rangeFromInput.value);
    const t = parseInt(UI.el.rangeToInput.value);
    if (isNaN(f) || isNaN(t) || f > t) return alert("Range tidak valid.");
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
        const rowEl = document.querySelector(`input[data-num="${f}"]`)?.closest('.preview-row');
        if (rowEl) {
          rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
          const bg = rowEl.style.backgroundColor;
          rowEl.style.transition = "background-color 0.3s ease";
          rowEl.style.backgroundColor = "rgba(59, 130, 246, 0.4)";
          setTimeout(() => { rowEl.style.backgroundColor = bg; }, 800);
        }
      }, 50);
    }
  }

  static async copyForAi() {
    const sel = AppState.lines.filter(l => AppState.selectedLines.has(l.line_num));
    const out = sel.map(l => l.name ? `${l.line_num}. ${l.name}: ${l.message}` : `${l.line_num}. ${l.message}`);
    
    let p = "";
    if (AppState.aiPromptEnabled) {
      p += `${(AppState.aiInstructionHeader || CONFIG.DEFAULT_PROMPT_HEADER).trim()}\n\n`;
    }

    if (AppState.contextEnabled) {
      const minSelectedNum = Math.min(...Array.from(AppState.selectedLines));
      const translatedBefore = AppState.lines.filter(l => l.line_num < minSelectedNum && AppState.isTranslated(l));
      translatedBefore.sort((a, b) => b.line_num - a.line_num);
      const contextLines = translatedBefore.slice(0, AppState.contextSize).reverse();
      
      if (contextLines.length > 0) {
        p += `<context>\n`;
        contextLines.forEach(l => {
          const tName = l.trans_name || l.name;
          p += tName ? `${l.line_num}. ${tName}: ${l.trans_message}\n` : `${l.line_num}. ${l.trans_message}\n`;
        });
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
    const parsed = [], errors = [], seen = new Set();
    for (let i = 0; i < rawLines.length; i++) {
      const txt = rawLines[i].trim();
      if (!txt) continue;
      const match = txt.match(/^\s*(\d+)\s*[.)]\s*(.*)$/);
      if (!match) { errors.push(`[Baris ${i+1}] Format rusak -> "${txt.substring(0,25)}..."`); continue; }
      const num = Number(match[1]);
      if (seen.has(num)) errors.push(`[Baris ${num}] Duplikat nomor.`);
      seen.add(num);
      let name = null, msg = match[2].trim(), rawMsg = msg;
      const splitIdx = Math.min(...[msg.indexOf(':'), msg.indexOf('：')].filter(x => x !== -1).concat(Infinity));
      if (splitIdx !== Infinity) {
        name = msg.substring(0, splitIdx).trim();
        msg = msg.substring(splitIdx + 1).trim();
      }
      parsed.push({ num, name, msg, rawMsg });
    }
    if (!parsed.length && !errors.length) return alert("Kosong atau tidak valid.");
    if (parsed.length !== AppState.selectedLines.size) errors.push(`Jumlah baris tidak sesuai seleksi.`);
    for (const num of AppState.selectedLines) if (!seen.has(num)) errors.push(`[Baris ${num}] Hilang.`);
    for (const num of seen) if (!AppState.selectedLines.has(num)) errors.push(`[Baris ${num}] Tidak dicentang.`);
    
    const updates = [];
    for (const it of parsed) {
      const l = AppState.lineByNum.get(it.num);
      if (!l) { errors.push(`[Baris ${it.num}] Tidak ada di JSON.`); continue; }
      
      if (AppState.ignoreNameTranslation && l.name) {
        it.name = l.name;
      }
      
      const oN = !!(l.name || "").trim();
      let tN = !!(it.name || "").trim();
      if (!oN && tN) { it.msg = it.rawMsg; it.name = null; tN = false; }
      if (oN && !tN) errors.push(`[Baris ${it.num}] Nama karakter hilang.`);
      else if (!oN && tN) errors.push(`[Baris ${it.num}] Tiba-tiba ada nama.`);
      else if (!it.msg) errors.push(`[Baris ${it.num}] Pesan kosong.`);
      else updates.push({ l, it });
    }
    if (errors.length) return alert("DITOLAK:\n" + errors.slice(0, 10).join("\n") + (errors.length > 10 ? `\n... (+${errors.length-10} lain)` : ""));
    
    AppState.undoSnapshot = { 
      lines: JSON.parse(JSON.stringify(AppState.lines)),
      selected: new Set(AppState.selectedLines)
    };

    for (const {l, it} of updates) {
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
    AppState.lines = AppState.undoSnapshot.lines.map(AppState.normalizeLine);
    AppState.selectedLines = new Set(AppState.undoSnapshot.selected);
    AppState.undoSnapshot = null;
    AppController.refreshWorkspace();
    AppController.syncCheckboxes();
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
    UI.toggleModal(UI.el.lineEditorModal, false);
    AppController.refreshWorkspace();
    if (UI.el.proofreadModal.classList.contains("open")) AppController.renderProofread();
    AppState.queueAutoSave();
  }

  static createHighlight(text, query, isRegex, isCase, isExact) {
    if (!query) return document.createTextNode(text);
    let regex;
    try {
      let rStr = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (isExact) rStr = `(?<![\\p{L}\\p{N}_])${rStr}(?![\\p{L}\\p{N}_])`;
      regex = new RegExp(`(${rStr})`, isCase ? 'gu' : 'giu');
    } catch (e) { return document.createTextNode(text); }
    const frag = document.createDocumentFragment();
    const parts = text.split(regex);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) frag.appendChild(UI.createDomNode("mark", "highlight", { textContent: parts[i] }));
      else if (parts[i]) frag.appendChild(document.createTextNode(parts[i]));
    }
    return frag;
  }

  static openProofread() {
    UI.toggleModal(UI.el.proofreadModal, true);
    AppController.renderProofread();
  }

  static renderProofread() {
    if (!UI.el.proofreadModal.classList.contains("open")) return;
    const q = UI.el.proofreadSearchInput.value, isReg = UI.el.proofreadRegexCheck.checked;
    const isC = UI.el.proofreadCaseCheck.checked, isEx = UI.el.proofreadExactCheck.checked;
    const onlyT = UI.el.proofreadTranslatedOnlyCheck.checked, scope = UI.el.proofreadScope.value;
    let regex = null;
    if (q) {
      try {
        let rStr = isReg ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (isEx) rStr = `(?<![\\p{L}\\p{N}_])${rStr}(?![\\p{L}\\p{N}_])`;
        regex = new RegExp(rStr, isC ? "gu" : "giu");
      } catch (e) { return; }
    }
    AppState.proofreadMatches = [];
    for (const line of AppState.lines) {
      if (onlyT && !AppState.isTranslated(line)) continue;
      const dName = line.name || "", fName = AppState.isTranslated(line) ? (line.trans_name || "").trim() || line.name : null;
      const tMsg = onlyT ? line.trans_message : line.message, tName = onlyT ? fName : dName;
      if (q && regex) {
        let match = false;
        regex.lastIndex = 0;
        if ((scope === 'all' || scope === 'message') && tMsg && regex.test(tMsg)) match = true;
        regex.lastIndex = 0;
        if (!match && (scope === 'all' || scope === 'name') && tName && regex.test(tName)) match = true;
        if (!match) continue;
      }
      AppState.proofreadMatches.push({ num: line.line_num, file: line.file, origName: dName, origMsg: line.message, transName: fName, transMsg: line.trans_message, isTrans: AppState.isTranslated(line) });
    }
    UI.el.proofreadStatus.textContent = `Ditemukan ${AppState.proofreadMatches.length} baris.`;
    AppController.proofreadScroller.setItems(AppState.proofreadMatches);
  }

  static renderProofreadRow(r) {
    const row = UI.createDomNode("div", "preview-row");
    const wrap = UI.createDomNode("div", "text-content");
    wrap.dataset.num = r.num;
    const q = UI.el.proofreadSearchInput.value, isReg = UI.el.proofreadRegexCheck.checked;
    const isC = UI.el.proofreadCaseCheck.checked, isEx = UI.el.proofreadExactCheck.checked;
    const onlyT = UI.el.proofreadTranslatedOnlyCheck.checked, scope = UI.el.proofreadScope.value;
    const build = (n, m, hl) => {
      const f = document.createDocumentFragment();
      if (n) {
        f.appendChild((hl && (scope === 'all' || scope === 'name')) ? AppController.createHighlight(n, q, isReg, isC, isEx) : document.createTextNode(n));
        f.appendChild(document.createTextNode(": "));
      }
      f.appendChild((hl && (scope === 'all' || scope === 'message')) ? AppController.createHighlight(m, q, isReg, isC, isEx) : document.createTextNode(m));
      return f;
    };
    wrap.appendChild(UI.createDomNode("div", "file-meta", { textContent: `File: ${r.file} | Baris: ${r.num}` }));
    const orig = UI.createDomNode("div", "original"), trans = UI.createDomNode("div", "translated");
    if (!r.isTrans) trans.classList.add("cell-muted");
    if (onlyT) {
      orig.textContent = r.origName ? `${r.origName}: ${r.origMsg}` : r.origMsg;
      r.isTrans ? trans.appendChild(build(r.transName, r.transMsg, true)) : trans.textContent = "——";
    } else {
      orig.appendChild(build(r.origName, r.origMsg, true));
      trans.textContent = r.isTrans ? (r.transName ? `${r.transName}: ${r.transMsg}` : r.transMsg) : "——";
    }
    wrap.append(orig, trans);
    row.appendChild(wrap);
    return row;
  }

  static execReplaceAll() {
    const q = UI.el.proofreadSearchInput.value, rep = UI.el.proofreadReplaceInput.value;
    if (!q) return alert("Pencarian kosong!");
    let regex;
    try {
      let rStr = UI.el.proofreadRegexCheck.checked ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (UI.el.proofreadExactCheck.checked) rStr = `(?<![\\p{L}\\p{N}_])${rStr}(?![\\p{L}\\p{N}_])`;
      regex = new RegExp(rStr, UI.el.proofreadCaseCheck.checked ? 'gu' : 'giu');
    } catch (e) { return alert("Regex tidak valid."); }
    let count = 0;
    AppState.undoSnapshot = { 
      lines: JSON.parse(JSON.stringify(AppState.lines)),
      selected: new Set(AppState.selectedLines)
    };
    const onlyT = UI.el.proofreadTranslatedOnlyCheck.checked, scope = UI.el.proofreadScope.value;
    for (const line of AppState.lines) {
      if (onlyT && !AppState.isTranslated(line)) continue;
      let replaced = false;
      const tMsg = onlyT ? 'trans_message' : 'message', tName = onlyT ? 'trans_name' : 'name';
      if ((scope === 'all' || scope === 'message') && line[tMsg]) {
        const newVal = line[tMsg].replace(regex, rep);
        if (newVal !== line[tMsg]) { line[tMsg] = newVal; replaced = true; }
      }
      if ((scope === 'all' || scope === 'name') && line[tName]) {
        const newVal = line[tName].replace(regex, rep);
        if (newVal !== line[tName]) { line[tName] = newVal; replaced = true; }
      }
      if (replaced) count++;
    }
    if (count > 0) {
      AppController.refreshWorkspace();
      AppController.renderProofread();
      AppState.queueAutoSave();
      alert(`Berhasil replace pada ${count} baris.`);
    } else alert(`Tidak ada yang cocok.`);
  }
}

document.addEventListener("DOMContentLoaded", AppController.init);