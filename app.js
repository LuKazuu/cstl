(() => {
  "use strict";
  const DEFAULT_PROMPT_HEADER = `Rewrite entire text to Native Indonesian. Do not change prefix number. Euphemism prohibited. Use of "Bahasa Jakarta Selatan" is prohibited. Put results inside plaintext block.`;
  const APP_VERSION = 5;
  const PROJECT_EXT = ".cstl";
  
  const state = {
    currentProjectId: null,
    projectName: "",
    projectType: "",
    epubTags: "p",
    epubSourceId: null,
    lines: [],
    importedFiles: [],
    aiInstructionHeader: DEFAULT_PROMPT_HEADER,
    undoSnapshot: null,
    selectedLines: new Set(),
    displayRows: [],
    lineByNum: new Map(),
    proofreadMatches: [],
  };
  
  const ui = {};
  let activeLineEditorLineNum = null;
  let saveTimeout = null;
  let mainScroller = null;
  let proofreadScroller = null;
  let hintToken = 0;

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
      let low = 0;
      let high = this.items.length - 1;
      while (low <= high) {
        let mid = Math.floor((low + high) / 2);
        let midTop = this.positions[mid];
        let midBottom = midTop + this.heights[mid];
        if (this.scrollTop >= midTop && this.scrollTop < midBottom) {
          return mid;
        } else if (this.scrollTop < midTop) {
          high = mid - 1;
        } else {
          low = mid + 1;
        }
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

      const buffer = 15; 
      let targetStart = this.findStartIndex() - Math.floor(buffer / 2);
      targetStart = Math.max(0, targetStart);

      let end = targetStart;
      let currentHeight = 0;
      while (end < total && currentHeight < viewportHeight + (buffer * this.estimatedHeight)) {
        currentHeight += this.heights[end];
        end++;
      }
      end = Math.min(total, end);

      if (!force && this.lastStart === targetStart && this.lastEnd === end) {
        return;
      }

      this.lastStart = targetStart;
      this.lastEnd = end;

      const topPad = this.positions[targetStart];
      const bottomPad = end < total ? this.totalHeight - this.positions[end] : 0;

      this.container.innerHTML = "";
      
      const topSpacer = document.createElement("div");
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

      const bottomSpacer = document.createElement("div");
      bottomSpacer.style.height = `${bottomPad}px`;
      this.container.appendChild(bottomSpacer);

      Promise.resolve().then(() => {
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

  document.addEventListener("DOMContentLoaded", async () => {
    cacheElements();
    initScrollers();
    bindEvents();
    
    if (!navigator.storage || !navigator.storage.getDirectory) {
      alert("Browser kamu tidak mendukung Sistem File OPFS. Beberapa fitur tidak akan berjalan optimal.");
      ui.projectList.innerHTML = `<p class="hint" style="grid-column: 1/-1; color: var(--danger);">Browser tidak mendukung OPFS. Sistem penyimpanan tidak dapat diakses.</p>`;
      return; 
    }
    
    await loadDashboardProjects();
  });

  function cacheElements() {
    const ids = [
      "dashboardView", "workspaceView", "projectList", "btnNewProject", "btnRestoreProject",
      "btnBackToDashboard", "projectNameDisplay", "restoreProjectInput", "btnImportFile",
      "btnImportFolder", "btnImportZip", "btnExport", "btnProofread", "btnSettings",
      "previewViewport", "previewContainer", "progressFill", "progressText", "btnSelectAll",
      "btnClearSelection", "copyCount", "btnCopyForAi", "copyStatus", "pasteArea", "btnApply",
      "btnUndo", "nameTableBody", "statusBar", "importFileInput", "importFolderInput",
      "importZipInput", "settingsModal", "settingsPromptInput", "settingsEpubTagsInput",
      "btnSettingsReset", "btnSettingsCancel", "btnSettingsSave", "lineEditorModal", "lineEditorTitle",
      "lineOriginalView", "lineNameWrap", "lineNameInput", "lineMessageInput", "lineTranslatedCheck",
      "btnLineCancel", "btnLineSave", "proofreadModal", "proofreadSearchInput", "proofreadScope",
      "proofreadRegexCheck", "proofreadCaseCheck", "proofreadExactCheck", "proofreadTranslatedOnlyCheck",
      "btnProofreadReset", "proofreadStatus", "proofreadContainer", "btnProofreadClose",
      "proofreadReplaceInput", "btnProofreadReplaceAll", "rangeFromInput", "rangeToInput", "btnSelectRange"
    ];
    for (const id of ids) {
      ui[id] = document.getElementById(id);
    }
  }

  function initScrollers() {
    mainScroller = new VirtualScroller(ui.previewViewport, ui.previewContainer, 85, renderMainRow);
    const proofreadViewport = ui.proofreadContainer.closest('.proofread-results-wrap');
    proofreadScroller = new VirtualScroller(proofreadViewport, ui.proofreadContainer, 90, renderProofreadRow);
  }

  function bindEvents() {
    ui.btnNewProject.addEventListener("click", createNewProject);
    ui.btnBackToDashboard.addEventListener("click", closeProject);
    ui.btnRestoreProject.addEventListener("click", () => ui.restoreProjectInput.click());
    ui.restoreProjectInput.addEventListener("change", onRestoreProject);
    ui.btnImportFile.addEventListener("click", () => ui.importFileInput.click());
    ui.btnImportFolder.addEventListener("click", () => ui.importFolderInput.click());
    ui.btnImportZip.addEventListener("click", () => ui.importZipInput.click());
    ui.importFileInput.addEventListener("change", onImportFileChange);
    ui.importFolderInput.addEventListener("change", onImportFolderChange);
    ui.importZipInput.addEventListener("change", onImportZipChange);
    ui.btnExport.addEventListener("click", onExport);
    ui.btnCopyForAi.addEventListener("click", onCopyForAi);
    ui.btnApply.addEventListener("click", onApplyTranslation);
    ui.btnUndo.addEventListener("click", onUndoLastApply);
    ui.btnProofread.addEventListener("click", onOpenProofread);
    ui.btnSelectAll.addEventListener("click", () => {
      state.lines.forEach(l => {
        if (!isTranslated(l)) state.selectedLines.add(l.line_num);
      });
      syncCheckboxUI();
    });
    ui.btnClearSelection.addEventListener("click", () => {
      state.selectedLines.clear();
      syncCheckboxUI();
    });
    ui.btnSelectRange.addEventListener("click", () => {
      const f = parseInt(ui.rangeFromInput.value);
      const t = parseInt(ui.rangeToInput.value);
      if (isNaN(f) || isNaN(t) || f > t) return alert("Range tidak valid.");
      state.selectedLines.clear();
      for (let i = f; i <= t; i++) {
        const l = state.lineByNum.get(i);
        if (l && !isTranslated(l)) state.selectedLines.add(i);
      }
      syncCheckboxUI();
      const targetIndex = state.displayRows.findIndex(row => row.type === "line" && row.line.line_num === f);
      if (targetIndex !== -1) {
        mainScroller.scrollToIndex(targetIndex);
        setTimeout(() => {
          const targetEl = document.querySelector(`input[data-num="${f}"]`);
          if (targetEl) {
            const rowEl = targetEl.closest('.preview-row');
            rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
            const originalBg = rowEl.style.backgroundColor;
            rowEl.style.transition = "background-color 0.3s ease";
            rowEl.style.backgroundColor = "rgba(59, 130, 246, 0.4)";
            setTimeout(() => { rowEl.style.backgroundColor = originalBg; }, 800);
          }
        }, 50);
      }
    });
    ui.btnSettings.addEventListener("click", onOpenSettings);
    ui.btnSettingsReset.addEventListener("click", () => {
      ui.settingsPromptInput.value = DEFAULT_PROMPT_HEADER;
      ui.settingsEpubTagsInput.value = "p";
    });
    ui.btnSettingsCancel.addEventListener("click", () => closeModal(ui.settingsModal));
    ui.btnSettingsSave.addEventListener("click", onSavePromptSettings);
    ui.btnLineCancel.addEventListener("click", () => closeModal(ui.lineEditorModal));
    ui.btnLineSave.addEventListener("click", onSaveLineEditor);
    ui.btnProofreadClose.addEventListener("click", () => closeModal(ui.proofreadModal));
    ui.btnProofreadReset.addEventListener("click", onResetProofread);
    ui.btnProofreadReplaceAll.addEventListener("click", onProofreadReplaceAll);
    const debouncedSearch = debounce(renderProofreadResults, 250);
    ui.proofreadSearchInput.addEventListener("input", debouncedSearch);
    ui.proofreadScope.addEventListener("change", renderProofreadResults);
    ui.proofreadRegexCheck.addEventListener("change", renderProofreadResults);
    ui.proofreadCaseCheck.addEventListener("change", renderProofreadResults);
    ui.proofreadExactCheck.addEventListener("change", renderProofreadResults);
    ui.proofreadTranslatedOnlyCheck.addEventListener("change", renderProofreadResults);
  }

  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  async function getOpfsRoot() {
    return await navigator.storage.getDirectory();
  }

  async function loadDashboardProjects() {
    ui.projectList.innerHTML = "";
    try {
      const root = await getOpfsRoot();
      const projects = [];
      for await (const [name, handle] of root.entries()) {
        if (name.endsWith(PROJECT_EXT) && handle.kind === 'file') {
          const file = await handle.getFile();
          const text = await file.text();
          try {
            const data = JSON.parse(text);
            projects.push({
              id: name,
              name: data.projectName || name.replace(PROJECT_EXT, ''),
              updatedAt: data.updatedAt || file.lastModified,
              fileCount: data.imported_files?.length || 0,
              lineCount: data.lines?.length || 0,
              data: data
            });
          } catch(e) {}
        }
      }
      projects.sort((a, b) => b.updatedAt - a.updatedAt);
      if (projects.length === 0) {
        ui.projectList.innerHTML = `<p class="hint" style="grid-column: 1/-1;">Belum ada proyek. Klik "Buat Proyek Baru" untuk memulai.</p>`;
        return;
      }
      
      for (const p of projects) {
        const card = document.createElement("div");
        card.className = "project-card";
        
        let typeBadge = '';
        if (p.fileCount > 0 || p.lineCount > 0) {
          typeBadge = p.data.projectType === 'epub' 
            ? `<span class="badge badge-epub">EPUB</span>` 
            : `<span class="badge badge-json">JSON VNTP</span>`;
        }

        card.innerHTML = `
          <div>
            <h3>${p.name}</h3>
            <div class="project-meta mt-2">
              ${typeBadge ? `<div style="margin-bottom: 8px;">${typeBadge}</div>` : ''}
              Terakhir diubah: ${new Date(p.updatedAt).toLocaleString('id-ID')}<br>
              File: ${p.fileCount} | Baris: ${p.lineCount}
            </div>
          </div>
          <div class="project-actions">
            <button class="btn btn-primary btn-sm btn-open" data-id="${p.id}">Buka</button>
            <button class="btn btn-outline btn-sm btn-rename" data-id="${p.id}">Ubah Nama</button>
            <button class="btn btn-outline btn-sm btn-backup" data-id="${p.id}">Backup</button>
            <button class="btn btn-danger btn-sm btn-delete" data-id="${p.id}">Hapus</button>
          </div>
        `;
        card.querySelector(".btn-open").addEventListener("click", () => openProject(p.id, p.data));
        card.querySelector(".btn-rename").addEventListener("click", () => renameDashboardProject(p.id, p.name, p.data));
        card.querySelector(".btn-backup").addEventListener("click", () => backupDashboardProject(p.name, p.data));
        card.querySelector(".btn-delete").addEventListener("click", () => deleteProject(p.id, p.data));
        ui.projectList.appendChild(card);
      }
    } catch (err) {
      ui.projectList.innerHTML = `<p class="hint" style="color: var(--danger);">Gagal mengakses storage browser.</p>`;
    }
  }

  async function createNewProject() {
    const name = prompt("Masukkan nama proyek baru:");
    if (!name || !name.trim()) return;
    const id = "proj_" + Date.now() + PROJECT_EXT;
    const initialData = {
      version: APP_VERSION,
      projectName: name.trim(),
      projectType: "json",
      epubTags: "p",
      epubSourceId: null,
      updatedAt: Date.now(),
      imported_files: [],
      lines: [],
      prompt_header: DEFAULT_PROMPT_HEADER
    };
    try {
      const root = await getOpfsRoot();
      const fileHandle = await root.getFileHandle(id, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(initialData));
      await writable.close();
      openProject(id, initialData);
    } catch (e) {
      alert("Gagal membuat proyek: " + e.message);
    }
  }

  async function deleteProject(id, data) {
    if (!confirm("Hapus proyek ini secara permanen?")) return;
    try {
      const root = await getOpfsRoot();
      if (data.epubSourceId) {
        try { await root.removeEntry(data.epubSourceId); } catch(e) {}
      }
      await root.removeEntry(id);
      loadDashboardProjects();
    } catch (e) {
      alert("Gagal menghapus: " + e.message);
    }
  }

  async function renameDashboardProject(id, oldName, data) {
    const newName = prompt("Masukkan nama baru untuk proyek:", oldName);
    if (!newName || newName.trim() === "" || newName === oldName) return;
    data.projectName = newName.trim();
    await saveProjectToOpfs(id, data);
    loadDashboardProjects();
  }

  async function backupDashboardProject(name, data) {
    const strData = JSON.stringify(data);
    const b = new Blob([strData], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    const safeName = name.replace(/[^\p{L}\p{N}_\-\.]/gu, '_').trim();
    a.download = `${safeName}_backup${PROJECT_EXT}`;
    a.click();
  }

  async function saveProjectToOpfs(id, dataObj) {
    try {
      dataObj.updatedAt = Date.now();
      const root = await getOpfsRoot();
      const fileHandle = await root.getFileHandle(id, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(dataObj));
      await writable.close();
    } catch (e) {
      flashHint("Gagal menyimpan ke storage!");
    }
  }

  function queueAutoSave() {
    if (!state.currentProjectId) return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      const data = {
        version: APP_VERSION,
        projectName: state.projectName,
        projectType: state.projectType,
        epubTags: state.epubTags,
        epubSourceId: state.epubSourceId,
        imported_files: state.importedFiles,
        lines: state.lines,
        prompt_header: state.aiInstructionHeader
      };
      await saveProjectToOpfs(state.currentProjectId, data);
      ui.statusBar.textContent = ui.statusBar.textContent.replace(" | Tersimpan!", "") + " | Tersimpan!";
      setTimeout(() => {
        updateStatusBar();
      }, 2000);
    }, 1000);
  }

  function openProject(id, data) {
    state.currentProjectId = id;
    state.projectName = data.projectName || "Unknown Project";
    state.projectType = data.projectType || "json";
    state.epubTags = data.epubTags || "p";
    state.epubSourceId = data.epubSourceId || null;
    state.lines = (data.lines || []).map(normalizeLineDict);
    state.importedFiles = data.imported_files || [];
    state.aiInstructionHeader = data.prompt_header || DEFAULT_PROMPT_HEADER;
    state.selectedLines.clear();
    state.undoSnapshot = null;
    ui.projectNameDisplay.textContent = state.projectName;
    
    ui.dashboardView.classList.remove("open");
    ui.workspaceView.style.display = "flex";
    
    refreshAll();
  }

  function closeProject() {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
      const data = {
        version: APP_VERSION, projectName: state.projectName,
        projectType: state.projectType, epubTags: state.epubTags, epubSourceId: state.epubSourceId,
        imported_files: state.importedFiles, lines: state.lines,
        prompt_header: state.aiInstructionHeader
      };
      saveProjectToOpfs(state.currentProjectId, data).then(() => {
        finishClose();
      });
    } else {
      finishClose();
    }
  }

  function finishClose() {
    state.currentProjectId = null;
    state.lines = [];
    ui.workspaceView.style.display = "none";
    ui.dashboardView.classList.add("open");
    loadDashboardProjects();
  }

  async function onRestoreProject(ev) {
    const f = ev.target.files?.[0];
    ev.target.value = "";
    if (!f) return;
    try {
      const p = JSON.parse(await f.text());
      const name = p.projectName || f.name.replace(PROJECT_EXT, '');
      const id = "proj_" + Date.now() + PROJECT_EXT;
      const safeData = {
        version: APP_VERSION,
        projectName: name,
        projectType: p.projectType || "json",
        epubTags: p.epubTags || "p",
        epubSourceId: p.epubSourceId || null,
        updatedAt: Date.now(),
        imported_files: p.imported_files || [],
        lines: (p.lines || []).map(normalizeLineDict),
        prompt_header: p.prompt_header || DEFAULT_PROMPT_HEADER
      };
      await saveProjectToOpfs(id, safeData);
      loadDashboardProjects();
      alert(`Proyek "${name}" berhasil dipulihkan!`);
    } catch (e) {
      alert("File backup korup atau tidak valid: " + e.message);
    }
  }

  function updateButtonStates() {
    const hasData = state.lines.length > 0;
    const hasSelection = state.selectedLines.size > 0;
    ui.btnExport.disabled = !hasData;
    ui.btnProofread.disabled = !hasData;
    ui.btnSelectAll.disabled = !hasData;
    ui.btnClearSelection.disabled = !hasSelection;
    ui.btnCopyForAi.disabled = !hasSelection;
    ui.pasteArea.disabled = !hasData;
    ui.btnApply.disabled = !hasData;
    ui.rangeFromInput.disabled = !hasData;
    ui.rangeToInput.disabled = !hasData;
    ui.btnSelectRange.disabled = !hasData;
    ui.copyCount.textContent = state.selectedLines.size;
  }

  function isTranslated(line) {
    return !!line.is_translated && !!String(line.trans_message).trim();
  }

  function normalizeLineDict(line) {
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

  function normalizeFileBaseName(pathOrName) {
    const normalized = String(pathOrName || "").replace(/\\/g, "/");
    return (normalized.split("/").pop() || normalized).replace(/\.json$/i, "");
  }

  function decodeArrayBuffer(buffer) {
    const encodings = ["utf-8", "shift_jis", "windows-31j"];
    for (const enc of encodings) {
      try { return new TextDecoder(enc, { fatal: true }).decode(buffer); }
      catch (_) {}
    }
    return new TextDecoder("utf-8").decode(buffer);
  }

  async function parseJsonFromFileObject(file) {
    return JSON.parse(decodeArrayBuffer(await file.arrayBuffer()));
  }

  function parseJsonEntries(jsonArray, fileName, startLineNum) {
    if (!Array.isArray(jsonArray)) throw new Error(`File ${fileName} bukan array JSON.`);
    const lines = [];
    let currentLine = startLineNum;
    for (const entry of jsonArray) {
      if (!entry || typeof entry !== "object" || !Object.hasOwn(entry, "message")) continue;
      lines.push({
        line_num: currentLine++,
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

  function rebuildDisplayState() {
    state.lineByNum.clear();
    const grouped = new Map(state.importedFiles.map(f => [f, []]));
    for (const line of state.lines) {
      state.lineByNum.set(line.line_num, line);
      if (!grouped.has(line.file)) grouped.set(line.file, []);
      grouped.get(line.file).push(line);
    }
    state.displayRows = [];
    for (const [fileName, rows] of grouped.entries()) {
      if (!rows.length) continue;
      state.displayRows.push({ type: "separator", file: fileName });
      for (const line of rows) {
        state.displayRows.push({ type: "line", line });
      }
    }
  }

  function renderPreviewRows() {
    if (mainScroller.items && mainScroller.items.length === state.displayRows.length && mainScroller.items.length > 0) {
      mainScroller.items = state.displayRows;
      mainScroller.render(true);
    } else {
      mainScroller.setItems(state.displayRows);
    }
    updateButtonStates();
  }

  function renderMainRow(rowData) {
    const row = document.createElement("div");
    row.className = "preview-row";
    if (rowData.type === "separator") {
      row.classList.add("separator");
      const fileLines = state.lines.filter(l => l.file === rowData.file && !isTranslated(l));
      const isAllSelected = fileLines.length > 0 && fileLines.every(l => state.selectedLines.has(l.line_num));
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.file = rowData.file;
      cb.checked = isAllSelected;
      cb.addEventListener("change", (e) => {
        const isChecked = e.target.checked;
        fileLines.forEach(l => {
          if (isChecked) state.selectedLines.add(l.line_num);
          else state.selectedLines.delete(l.line_num);
        });
        syncCheckboxUI();
      });
      const label = document.createElement("div");
      label.className = "mono grow";
      label.style.fontWeight = "700";
      label.style.color = "var(--primary)";
      label.textContent = `File: ${rowData.file}`;
      row.append(cb, label);
    } else {
      const line = rowData.line;
      if (isTranslated(line)) row.classList.add("row-translated");
      const isChecked = state.selectedLines.has(line.line_num);
      if (isChecked) row.classList.add('row-selected');
      const cbWrap = document.createElement("div");
      cbWrap.className = "checkbox-cell";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.dataset.num = line.line_num;
      cb.checked = isChecked;
      if (isTranslated(line)) cb.disabled = true;
      cb.addEventListener("change", (e) => {
        if (e.target.checked) state.selectedLines.add(line.line_num);
        else state.selectedLines.delete(line.line_num);
        syncCheckboxUI();
      });
      const contentWrap = document.createElement("div");
      contentWrap.className = "text-content";
      const origDiv = document.createElement("div");
      origDiv.className = "original";
      const dName = line.name || "";
      origDiv.textContent = dName ? `${line.line_num}. ${dName}: ${line.message}` : `${line.line_num}. ${line.message}`;
      const transDiv = document.createElement("div");
      transDiv.className = "translated";
      let tTxt = "——";
      if (isTranslated(line)) {
          const tName = line.trans_name || dName;
          tTxt = tName ? `${line.line_num}. ${tName}: ${line.trans_message}` : `${line.line_num}. ${line.trans_message}`;
      } else {
          transDiv.classList.add("cell-muted");
      }
      transDiv.textContent = tTxt;
      contentWrap.append(origDiv, transDiv);
      cbWrap.append(cb, contentWrap);
      row.appendChild(cbWrap);
      contentWrap.addEventListener("click", () => openLineEditor(line.line_num));
    }
    return row;
  }

  function syncCheckboxUI() {
    document.querySelectorAll('.preview-row.separator input[type="checkbox"]').forEach(cb => {
      const fileLines = state.lines.filter(l => l.file === cb.dataset.file && !isTranslated(l));
      cb.checked = fileLines.length > 0 && fileLines.every(l => state.selectedLines.has(l.line_num));
    });
    document.querySelectorAll('.preview-row:not(.separator) input[type="checkbox"]').forEach(cb => {
      const num = Number(cb.dataset.num);
      const isChecked = state.selectedLines.has(num);
      cb.checked = isChecked;
      const row = cb.closest('.preview-row');
      if (isChecked) row.classList.add('row-selected');
      else row.classList.remove('row-selected');
    });
    updateButtonStates();
  }

  function renderNameTable() {
    const autoDetectedNames = Array.from(new Set(state.lines.map(l => l.name).filter(Boolean))).sort();
    ui.nameTableBody.textContent = "";
    const frag = document.createDocumentFragment();
    for (const n of autoDetectedNames) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.textContent = n;
      td.className = "mono";
      td.title = "Klik untuk copy nama ke clipboard";
      td.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(n);
          flashHint(`Nama "${n}" disalin!`);
        } catch (e) {
          alert("Gagal menyalin teks.");
        }
      });
      tr.appendChild(td);
      frag.appendChild(tr);
    }
    ui.nameTableBody.appendChild(frag);
  }

  function updateStatusBar() {
    const total = state.lines.length;
    const trans = state.lines.filter(isTranslated).length;
    const perc = total ? Math.floor((trans / total) * 100) : 0;
    
    let modeText = "-";
    if (state.importedFiles.length > 0) {
      modeText = state.projectType === "epub" ? "EPUB" : "JSON VNTP";
    }

    ui.statusBar.textContent = `Mode: ${modeText} | File: ${state.importedFiles.length > 1 ? state.importedFiles.length + ' file' : (state.importedFiles[0] || '-')} | Baris: ${total} | TL: ${trans}/${total} (${perc}%)`;
    ui.progressFill.style.width = `${perc}%`;
    ui.progressText.textContent = `${trans}/${total}`;
  }

  function refreshAll() {
    rebuildDisplayState();
    renderPreviewRows();
    renderNameTable();
    updateStatusBar();
    ui.btnUndo.disabled = !state.undoSnapshot;
  }

  function flashHint(msg, keepAlive = false) {
    ui.copyStatus.textContent = msg;
    ui.copyStatus.classList.remove("empty");
    const currentToken = ++hintToken;
    if (!keepAlive) {
      setTimeout(() => {
        if (hintToken === currentToken) {
          ui.copyStatus.classList.add("empty");
        }
      }, 4000);
    }
  }

  async function handleImportLogic(filesObj, isZip = false) {
    flashHint("Memproses file... Mohon tunggu.", true);
    document.body.style.cursor = "wait";
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      let cur = 1, lines = [];
      let maxExistingLineNum = state.lines.length > 0 ? Math.max(...state.lines.map(l => l.line_num)) : 0;
      cur = maxExistingLineNum + 1;
      const existingFiles = new Set(state.importedFiles);
      const skippedFiles = [];

      if (isZip && filesObj instanceof File && window.JSZip) {
        const zip = await window.JSZip.loadAsync(filesObj);
        const names = Object.keys(zip.files).filter(n => n.endsWith(".json")).sort();
        for (const n of names) {
          const baseName = normalizeFileBaseName(n);
          if (existingFiles.has(baseName)) {
            skippedFiles.push(baseName);
            continue;
          }
          const jsonContent = JSON.parse(decodeArrayBuffer(await zip.file(n).async("uint8array")));
          const p = parseJsonEntries(jsonContent, baseName, cur);
          if (p.length) {
            existingFiles.add(baseName);
            lines.push(...p);
            cur += p.length;
          }
          await new Promise(r => setTimeout(r, 0));
        }
      } else {
        const files = Array.from(filesObj).sort((a,b) => a.name.localeCompare(b.name));
        for (const f of files) {
          const isEpub = f.name.toLowerCase().endsWith(".epub");
          const isJson = f.name.toLowerCase().endsWith(".json");
          
          if (isEpub) {
            if (state.lines.length > 0 && state.projectType === "epub") {
              alert("Proyek ini sudah memuat file EPUB. Buat proyek baru untuk mengimpor EPUB lain.");
              continue;
            }
            if (state.lines.length === 0) {
              state.projectType = "epub";
              state.epubSourceId = "epub_" + Date.now() + ".epub";
            }
            
            const root = await getOpfsRoot();
            const fh = await root.getFileHandle(state.epubSourceId, { create: true });
            const writable = await fh.createWritable();
            await writable.write(f);
            await writable.close();

            const zip = await window.JSZip.loadAsync(f);
            const containerXml = await zip.file("META-INF/container.xml").async("text");
            const rootfile = new DOMParser().parseFromString(containerXml, "application/xml").querySelector("rootfile");
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

            const tagsSelector = state.epubTags || "p";

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
              if (fileHasContent) {
                existingFiles.add(href);
              }
              await new Promise(r => setTimeout(r, 0));
            }
          } else if (isJson) {
            const baseName = normalizeFileBaseName(f.name);
            if (existingFiles.has(baseName)) {
              skippedFiles.push(baseName);
              continue;
            }
            const p = parseJsonEntries(await parseJsonFromFileObject(f), baseName, cur);
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
        state.lines = [...state.lines, ...lines];
        state.importedFiles = Array.from(existingFiles);
        refreshAll();
        queueAutoSave();
        let msg = `Berhasil impor ${lines.length} baris.`;
        if (skippedFiles.length > 0) {
          msg += ` (${skippedFiles.length} file duplikat diabaikan)`;
        }
        flashHint(msg);
      } else if (skippedFiles.length > 0) {
        ui.copyStatus.classList.add("empty");
        setTimeout(() => {
          alert(`Gagal impor: File yang dipilih sudah ada di dalam proyek.\n\nFile duplikat:\n- ${skippedFiles.slice(0, 5).join('\n- ')}${skippedFiles.length > 5 ? '\n...dan lainnya' : ''}`);
        }, 10);
      } else {
        flashHint("Tidak ada data valid yang diimpor.", false);
      }
    } catch (err) {
      ui.copyStatus.classList.add("empty");
      setTimeout(() => alert(`Terjadi kesalahan saat mengimpor:\n${err.message}`), 10);
    } finally {
      document.body.style.cursor = "default";
    }
  }

  async function onImportFileChange(ev) {
    if(!ev.target.files.length) return;
    await handleImportLogic(ev.target.files);
    ev.target.value = "";
  }

  async function onImportFolderChange(ev) {
    if(!ev.target.files.length) return;
    await handleImportLogic(ev.target.files);
    ev.target.value = "";
  }

  async function onImportZipChange(ev) {
    if(!ev.target.files.length) return;
    await handleImportLogic(ev.target.files[0], true);
    ev.target.value = "";
  }

  async function onCopyForAi() {
    const sel = state.lines.filter(l => state.selectedLines.has(l.line_num));
    const out = [];
    for (const l of sel) {
      const dN = l.name || "";
      out.push(dN ? `${l.line_num}. ${dN}: ${l.message}` : `${l.line_num}. ${l.message}`);
    }
    const p = `${(state.aiInstructionHeader || DEFAULT_PROMPT_HEADER).trim()}\n\n${out.join("\n")}\n`;
    try {
      await navigator.clipboard.writeText(p);
      flashHint(`Disalin ${sel.length} baris.`);
    } catch (_) {
      ui.pasteArea.value = p;
    }
  }

  function onApplyTranslation() {
    if (!state.lines.length) return;
    const rawLines = ui.pasteArea.value.split(/\r?\n/);
    const parsed = [], errors = [], seen = new Set();
    const expectedCount = state.selectedLines.size;
    for (let i = 0; i < rawLines.length; i++) {
      const txt = rawLines[i].trim();
      if (!txt) continue;
      const match = txt.match(/^\s*(\d+)\s*[.)]\s*(.*)$/);
      if (!match) {
        errors.push(`[Baris ${i+1}] Format rusak (Harus "Angka. Teks") -> "${txt.substring(0,25)}..."`);
        continue;
      }
      const num = Number(match[1]);
      if (seen.has(num)) errors.push(`[#${num}] Duplikat nomor baris.`);
      seen.add(num);
      let name = null;
      let msg = match[2].trim();
      const rawMsg = msg;
      const colonIdx = msg.indexOf(':');
      const jpColonIdx = msg.indexOf('：');
      let splitIdx = -1;
      if (colonIdx !== -1 && jpColonIdx !== -1) splitIdx = Math.min(colonIdx, jpColonIdx);
      else if (colonIdx !== -1) splitIdx = colonIdx;
      else if (jpColonIdx !== -1) splitIdx = jpColonIdx;
      if (splitIdx !== -1) {
        name = msg.substring(0, splitIdx).trim();
        msg = msg.substring(splitIdx + 1).trim();
      }
      parsed.push({ num, name, msg, rawMsg });
    }
    if (!parsed.length && !errors.length) return alert("Teks di kotak kosong atau tidak valid.");
    if (parsed.length > 0) {
      if (parsed.length !== expectedCount) {
        errors.push(`[Validasi Checkbox] Copy ${expectedCount} baris, tapi yang di-paste ${parsed.length} baris.`);
      }
      for (const num of state.selectedLines) {
        if (!seen.has(num) && state.lineByNum.has(num)) errors.push(`[#${num}] Hilang dari hasil paste.`);
      }
      for (const num of seen) {
        if (!state.selectedLines.has(num)) errors.push(`[#${num}] Nyasar, baris ini tidak kamu centang sebelumnya.`);
      }
    }
    const updates = [];
    for (const it of parsed) {
      const l = state.lineByNum.get(it.num);
      if (!l) { errors.push(`[#${it.num}] Tidak ada di JSON asli.`); continue; }
      const oN = !!(l.name || "").trim();
      let tN = !!(it.name || "").trim();
      if (!oN && tN) { it.msg = it.rawMsg; it.name = null; tN = false; }
      if (oN && !tN) errors.push(`[#${it.num}] Nama karakter hilang.`);
      else if (!oN && tN) errors.push(`[#${it.num}] Tiba-tiba ada nama karakter.`);
      else if (!it.msg) errors.push(`[#${it.num}] Pesannya kosong.`);
      else updates.push({ l, it });
    }
    if (errors.length) {
      return alert("TRANSLASI DITOLAK:\n\n" + errors.slice(0, 10).join("\n") + (errors.length > 10 ? `\n\n... (+${errors.length-10} error lain)` : ""));
    }
    state.undoSnapshot = { lines: JSON.parse(JSON.stringify(state.lines)) };
    for (const {l, it} of updates) {
      l.trans_message = it.msg;
      l.is_translated = true;
      if (it.name) l.trans_name = it.name;
      state.selectedLines.delete(l.line_num);
    }
    ui.pasteArea.value = "";
    refreshAll();
    queueAutoSave();
    flashHint(`${updates.length} baris sukses diterapkan.`);
  }

  function onUndoLastApply() {
    if (!state.undoSnapshot) return;
    state.lines = state.undoSnapshot.lines.map(normalizeLineDict);
    state.undoSnapshot = null;
    refreshAll();
    queueAutoSave();
  }

  function openLineEditor(num) {
    const l = state.lineByNum.get(num);
    if (!l) return;
    activeLineEditorLineNum = num;
    ui.lineEditorTitle.textContent = `Edit Baris ${num}`;
    ui.lineOriginalView.value = l.name ? `${l.name}: ${l.message}` : `${l.message}`;
    ui.lineNameWrap.style.display = l.name ? "block" : "none";
    ui.lineNameInput.value = l.name ? (l.trans_name || "") : "";
    if (l.name) ui.lineNameInput.placeholder = l.name;
    ui.lineMessageInput.value = (l.trans_message || "").trim();
    ui.lineTranslatedCheck.checked = isTranslated(l);
    openModal(ui.lineEditorModal);
  }

  function onSaveLineEditor() {
    const l = state.lineByNum.get(activeLineEditorLineNum);
    if (!l) return;
    const m = ui.lineMessageInput.value.trim().replace(/\r?\n/g, "\\n");
    if (ui.lineTranslatedCheck.checked && !m) return alert("Gagal: Pesan terjemahan kosong.");
    let n = null;
    if (l.name) n = ui.lineNameInput.value.trim().replace(/\r?\n/g, "\\n");
    l.trans_message = m || null;
    l.is_translated = !!(ui.lineTranslatedCheck.checked && m);
    if (l.name) l.trans_name = n || null;
    closeModal(ui.lineEditorModal);
    refreshAll();
    if (ui.proofreadModal.classList.contains("open")) renderProofreadResults();
    queueAutoSave();
  }

  function onOpenProofread() { openModal(ui.proofreadModal); renderProofreadResults(); }
  function onResetProofread() {
    ui.proofreadSearchInput.value = ""; ui.proofreadReplaceInput.value = "";
    ui.proofreadScope.value = "all"; ui.proofreadRegexCheck.checked = false;
    ui.proofreadCaseCheck.checked = false; ui.proofreadExactCheck.checked = false;
    ui.proofreadTranslatedOnlyCheck.checked = true;
    renderProofreadResults();
  }

  function createHighlightedNodes(text, query, isRegex, isCase, isExact) {
    if (!query) return document.createTextNode(text);
    let regex;
    try {
      let regexStr = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (isExact) regexStr = `\\b(?:${regexStr})\\b`;
      regex = new RegExp(`(${regexStr})`, isCase ? 'g' : 'gi');
    } catch(e) { return document.createTextNode(text); }
    const frag = document.createDocumentFragment();
    const parts = text.split(regex);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        const mark = document.createElement("mark");
        mark.className = "highlight"; mark.textContent = parts[i];
        frag.appendChild(mark);
      } else if (parts[i]) {
        frag.appendChild(document.createTextNode(parts[i]));
      }
    }
    return frag;
  }

  function renderProofreadResults() {
    if (!ui.proofreadModal.classList.contains("open")) return;
    const query = ui.proofreadSearchInput.value;
    const isRegex = ui.proofreadRegexCheck.checked;
    const isCase = ui.proofreadCaseCheck.checked;
    const isExact = ui.proofreadExactCheck.checked;
    const onlyTrans = ui.proofreadTranslatedOnlyCheck.checked;
    const scope = ui.proofreadScope.value;
    let regex = null;
    if (query) {
      try {
        let regexStr = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (isExact) regexStr = `\\b(?:${regexStr})\\b`;
        regex = new RegExp(regexStr, isCase ? "g" : "gi");
      }
      catch (e) { return; }
    }
    state.proofreadMatches = [];
    for (const line of state.lines) {
      if (onlyTrans && !isTranslated(line)) continue;
      const dName = line.name || "";
      let fName = null;
      if (isTranslated(line)) fName = (line.trans_name || "").trim() || line.name;
      const targetMsg = onlyTrans ? line.trans_message : line.message;
      const targetName = onlyTrans ? fName : dName;
      if (query && regex) {
        let isMatch = false;
        regex.lastIndex = 0;
        if ((scope === 'all' || scope === 'message') && targetMsg && regex.test(targetMsg)) isMatch = true;
        regex.lastIndex = 0;
        if (!isMatch && (scope === 'all' || scope === 'name') && targetName && regex.test(targetName)) isMatch = true;
        if (!isMatch) continue;
      }
      state.proofreadMatches.push({
        num: line.line_num, file: line.file, origName: dName, origMsg: line.message,
        transName: fName, transMsg: line.trans_message, isTrans: isTranslated(line)
      });
    }
    ui.proofreadStatus.textContent = `Ditemukan ${state.proofreadMatches.length} baris.`;
    proofreadScroller.setItems(state.proofreadMatches);
  }

  function renderProofreadRow(r) {
    const row = document.createElement("div");
    row.className = "preview-row";
    const contentWrap = document.createElement("div");
    contentWrap.className = "text-content";
    const query = ui.proofreadSearchInput.value;
    const isRegex = ui.proofreadRegexCheck.checked;
    const isCase = ui.proofreadCaseCheck.checked;
    const isExact = ui.proofreadExactCheck.checked;
    const onlyTrans = ui.proofreadTranslatedOnlyCheck.checked;
    const scope = ui.proofreadScope.value;
    const highlightName = scope === 'all' || scope === 'name';
    const highlightMsg = scope === 'all' || scope === 'message';
    const buildNodes = (name, msg, shouldHighlightAll) => {
      const wrap = document.createDocumentFragment();
      if (name) {
        if (shouldHighlightAll && highlightName) wrap.appendChild(createHighlightedNodes(name, query, isRegex, isCase, isExact));
        else wrap.appendChild(document.createTextNode(name));
        wrap.appendChild(document.createTextNode(": "));
      }
      if (shouldHighlightAll && highlightMsg) wrap.appendChild(createHighlightedNodes(msg, query, isRegex, isCase, isExact));
      else wrap.appendChild(document.createTextNode(msg));
      return wrap;
    };
    const fileMeta = document.createElement("div");
    fileMeta.className = "file-meta";
    fileMeta.textContent = `File: ${r.file} | Baris: ${r.num}`;
    const origDiv = document.createElement("div");
    origDiv.className = "original";
    const transDiv = document.createElement("div");
    transDiv.className = "translated";
    if (!r.isTrans) transDiv.classList.add("cell-muted");
    if (onlyTrans) {
      origDiv.textContent = r.origName ? `${r.origName}: ${r.origMsg}` : r.origMsg;
      if (r.isTrans) transDiv.appendChild(buildNodes(r.transName, r.transMsg, true));
      else transDiv.textContent = "——";
    } else {
      origDiv.appendChild(buildNodes(r.origName, r.origMsg, true));
      if (r.isTrans) transDiv.textContent = r.transName ? `${r.transName}: ${r.transMsg}` : r.transMsg;
      else transDiv.textContent = "——";
    }
    contentWrap.append(fileMeta, origDiv, transDiv);
    row.appendChild(contentWrap);
    contentWrap.addEventListener("click", () => openLineEditor(r.num));
    return row;
  }

  function onProofreadReplaceAll() {
    const query = ui.proofreadSearchInput.value;
    if (!query) return alert("Pencarian masih kosong!");
    const rep = ui.proofreadReplaceInput.value;
    const isRegex = ui.proofreadRegexCheck.checked;
    const isCase = ui.proofreadCaseCheck.checked;
    const isExact = ui.proofreadExactCheck.checked;
    const onlyTrans = ui.proofreadTranslatedOnlyCheck.checked;
    const scope = ui.proofreadScope.value;
    let regex;
    try {
      let regexStr = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (isExact) regexStr = `\\b(?:${regexStr})\\b`;
      regex = new RegExp(regexStr, isCase ? 'g' : 'gi');
    } catch(e) { return alert("Format Regex tidak valid."); }
    let count = 0;
    state.undoSnapshot = { lines: JSON.parse(JSON.stringify(state.lines)) };
    for (const line of state.lines) {
      if (onlyTrans) {
        if (!isTranslated(line)) continue;
        let replaced = false;
        if ((scope === 'all' || scope === 'message') && line.trans_message) {
            regex.lastIndex = 0;
            if (regex.test(line.trans_message)) { line.trans_message = line.trans_message.replace(regex, rep); replaced = true; }
        }
        if ((scope === 'all' || scope === 'name') && line.trans_name) {
            regex.lastIndex = 0;
            if (regex.test(line.trans_name)) { line.trans_name = line.trans_name.replace(regex, rep); replaced = true; }
        }
        if (replaced) count++;
      } else {
        let replaced = false;
        if ((scope === 'all' || scope === 'message') && line.message) {
            regex.lastIndex = 0;
            if (regex.test(line.message)) { line.message = line.message.replace(regex, rep); replaced = true; }
        }
        if ((scope === 'all' || scope === 'name') && line.name) {
            regex.lastIndex = 0;
            if (regex.test(line.name)) { line.name = line.name.replace(regex, rep); replaced = true; }
        }
        if (replaced) count++;
      }
    }
    if (count > 0) {
      refreshAll(); renderProofreadResults(); queueAutoSave();
      alert(`Berhasil melakukan Replace All pada ${count} baris teks.`);
    } else alert(`Tidak ada kata yang cocok dengan pencarian.`);
  }

  function onOpenSettings() {
    ui.settingsPromptInput.value = state.aiInstructionHeader;
    ui.settingsEpubTagsInput.value = state.epubTags || "p";
    openModal(ui.settingsModal);
  }

  function onSavePromptSettings() {
    state.aiInstructionHeader = ui.settingsPromptInput.value.trim();
    state.epubTags = ui.settingsEpubTagsInput.value.trim() || "p";
    closeModal(ui.settingsModal);
    queueAutoSave();
  }

  async function onExport() {
    if (!state.lines.length) return;
    
    if (state.projectType === "epub" && state.epubSourceId) {
      try {
        flashHint("Membangun file EPUB...", true);
        document.body.style.cursor = "wait";
        const root = await getOpfsRoot();
        const fh = await root.getFileHandle(state.epubSourceId);
        const f = await fh.getFile();
        const zip = await window.JSZip.loadAsync(f);
        
        const linesByFile = {};
        state.lines.forEach(l => {
          if (!linesByFile[l.file]) linesByFile[l.file] = [];
          linesByFile[l.file].push(l);
        });

        const tagsSelector = state.epubTags || "p";

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
            if (l && l.is_translated && l.trans_message) {
              el.textContent = l.trans_message;
            }
          }
          
          let newHtml = new XMLSerializer().serializeToString(doc);
          if (xmlHeader && !newHtml.startsWith("<?xml")) {
            newHtml = xmlHeader + newHtml;
          }
          zip.file(href, newHtml);
        }

        if (zip.file("mimetype")) {
          const mimeData = await zip.file("mimetype").async("text");
          zip.file("mimetype", mimeData, { compression: "STORE" });
        }

        const blob = await zip.generateAsync({
          type: "blob",
          mimeType: "application/epub+zip",
          compression: "DEFLATE",
          compressionOptions: { level: 9 }
        });

        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        const safeName = state.projectName.replace(/[^\p{L}\p{N}_\-\.]/gu, '_').trim() || 'export';
        a.download = `${safeName}_tl.epub`;
        a.click();
        flashHint("Berhasil mengekspor EPUB!");
      } catch (err) {
        alert("Gagal mengekspor EPUB: " + err.message);
      } finally {
        document.body.style.cursor = "default";
      }
    } else {
      const g = new Map();
      for (const l of state.lines) {
        if (!g.has(l.file)) g.set(l.file, []);
        g.get(l.file).push(l);
      }
      const res = Array.from(g.entries()).map(([fn, lns]) => ({
        fn: `${fn.replace(/\.xhtml|\.html/g, '')}.json`,
        content: JSON.stringify(lns.map(l => {
          const e = {};
          e.name = isTranslated(l) ? (l.trans_name || l.name) : l.name;
          e.message = isTranslated(l) ? l.trans_message : l.message;
          if (e.name) e.name = e.name.replace(/\\n/g, "\n");
          if (e.message) e.message = e.message.replace(/\\n/g, "\n");
          return e;
        }), null, 2)
      }));
      if (window.JSZip && res.length > 1) {
        const zip = new window.JSZip();
        res.forEach(f => zip.file(f.fn, f.content));
        const b = await zip.generateAsync({ type: "blob" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        const safeName = state.projectName.replace(/[^\p{L}\p{N}_\-\.]/gu, '_').trim() || 'export';
        a.download = `${safeName}_export.zip`;
        a.click();
      } else {
        res.forEach(f => {
          const b = new Blob([f.content], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(b);
          a.download = f.fn;
          a.click();
        });
      }
    }
  }

  function openModal(el) { el.classList.add("open"); }
  function closeModal(el) { el.classList.remove("open"); }
})();