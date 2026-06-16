const CFG = {
  APP_VER: 9,
  EXT_PROJ: ".cstl",
  TYPE_UNINIT: "uninitialized",
  API_VNDB: "https://api.vndb.org/kana/character",
  ENCODINGS: ["utf-8", "shift_jis", "windows-31j", "cp932"],
  DELAY_SAVE: 500,
  DELAY_TOAST: 3000,
  DELAY_RESIZE: 100,
  DELAY_SEARCH: 200,
  DELAY_REVOKE: 10000,
  DELAY_STATUS: 2000,
  DELAY_HL: 800,
  DEF_ROW_HT: 80,
  DEF_FILE: "unknown",
  DEF_TAGS: "p",
  DEF_CTX_SIZE: 5,
  DEF_IGNORE_NAME: false,
  DEF_PROMPT_EN: true,
  DEF_CTX_EN: false,
  DEF_VNDB_EN: false,
  DEF_CUST_EN: false,
  DEF_PROMPT: `Rewrite entire text to Native Indonesian. Euphemism prohibited. Use of "Bahasa Jakarta Selatan" is prohibited. Output ONLY a valid JSON array of arrays. Format lines with names as [ID, "Name", "Message"] and lines without names as [ID, "Message"]. Do not include any conversational text.`
};

class UI {
  static el = {};
  static hintToken = 0;
  static cache() { document.querySelectorAll('[id]').forEach(e => UI.el[e.id] = e); }
  static toggleModal(e, s) { e.classList.toggle("open", s); }
  static flashMessage(m, k = false) {
    UI.el.copyStatus.textContent = m; UI.el.copyStatus.classList.remove("empty");
    let t = ++UI.hintToken;
    if(!k) setTimeout(() => { if(UI.hintToken === t) UI.el.copyStatus.classList.add("empty"); }, CFG.DELAY_TOAST);
  }
  static createDomNode(t, c, a = {}) {
    let n = document.createElement(t); if(c) n.className = c;
    for(let k in a) n[k] = a[k]; return n;
  }
}

class StorageManager {
  static async getRoot() { return await navigator.storage.getDirectory(); }
  static async saveProject(id, d) {
    try {
      d.updatedAt = Date.now();
      let r = await StorageManager.getRoot(), fh = await r.getFileHandle(id, {create:true}), w = await fh.createWritable();
      await w.write(JSON.stringify(d)); await w.close();
    } catch(e) { UI.flashMessage("Gagal menyimpan ke storage!"); }
  }
  static async fetchProjects() {
    let r = await StorageManager.getRoot(), p = [];
    for await(let [n, h] of r.entries()) {
      if(n.endsWith(CFG.EXT_PROJ) && h.kind === 'file') {
        try {
          let f = await h.getFile(), d = JSON.parse(await f.text());
          p.push({id: n, name: d.projectName || n.replace(CFG.EXT_PROJ, ''), updatedAt: d.updatedAt || f.lastModified, fileCount: d.imported_files?.length || 0, lineCount: d.lines?.length || 0, data: d});
        } catch(e) {}
      }
    }
    return p.sort((a,b) => b.updatedAt - a.updatedAt);
  }
  static async removeProject(id, epubId) {
    let r = await StorageManager.getRoot();
    if(epubId) try { await r.removeEntry(epubId); } catch(e) {}
    await r.removeEntry(id);
  }
}

class AppState {
  static currentProjectId = null; static projectName = ""; static projectType = CFG.TYPE_UNINIT;
  static epubTags = CFG.DEF_TAGS; static epubSourceId = null; static lines = []; static importedFiles = [];
  static aiInstructionHeader = CFG.DEF_PROMPT;
  static ignoreNameTranslation = CFG.DEF_IGNORE_NAME; static aiPromptEnabled = CFG.DEF_PROMPT_EN; static contextEnabled = CFG.DEF_CTX_EN;
  static contextSize = CFG.DEF_CTX_SIZE; static vndbEnabled = CFG.DEF_VNDB_EN; static vndbId = ""; static vndbGlossary = [];
  static customEnabled = CFG.DEF_CUST_EN; static customRaw = ""; static customGlossary = [];
  static undoSnapshot = null; static redoSnapshot = null; static selectedLines = new Set();
  static displayRows = []; static lineByNum = new Map(); static filesLinesCache = new Map();
  static proofreadMatches = []; static saveTimeout = null; static translatedCount = 0;
  static isTranslated(l) { return !!l.is_translated; }
  static normalizeLine(l) {
    return {
      line_num: Number(l.line_num), file: String(l.file),
      name: l.name == null ? null : String(l.name).replace(/\r?\n/g,"\\n").trim(),
      message: String(l.message||"").replace(/\r?\n/g,"\\n").trim(),
      trans_name: l.trans_name == null ? null : String(l.trans_name).replace(/\r?\n/g,"\\n").trim(),
      trans_message: l.trans_message == null ? null : String(l.trans_message).replace(/\r?\n/g,"\\n").trim(),
      is_translated: Boolean(l.is_translated)
    };
  }
  static updateTranslatedCount() { AppState.translatedCount = AppState.lines.filter(l => l.is_translated).length; }
  static rebuildCache() {
    AppState.lineByNum.clear(); AppState.filesLinesCache.clear(); AppState.displayRows = [];
    let g = new Map(AppState.importedFiles.map(f => [f, []]));
    AppState.lines.forEach(l => { AppState.lineByNum.set(l.line_num, l); if(g.has(l.file)) g.get(l.file).push(l); });
    for(let [fn, r] of g.entries()) {
      AppState.filesLinesCache.set(fn, r);
      if(r.length) { AppState.displayRows.push({type:"separator", file:fn}); r.forEach(l => AppState.displayRows.push({type:"line", line:l})); }
    }
  }
  static queueAutoSave() {
    if(!AppState.currentProjectId) return;
    clearTimeout(AppState.saveTimeout);
    AppState.saveTimeout = setTimeout(() => window.requestIdleCallback ? window.requestIdleCallback(AppState.executeAutoSave) : setTimeout(AppState.executeAutoSave,0), CFG.DELAY_SAVE);
  }
  static async executeAutoSave() {
    await StorageManager.saveProject(AppState.currentProjectId, {
      version: CFG.APP_VER, projectName: AppState.projectName, projectType: AppState.projectType, epubTags: AppState.epubTags, epubSourceId: AppState.epubSourceId, imported_files: AppState.importedFiles, lines: AppState.lines, prompt_header: AppState.aiInstructionHeader, ignoreNameTranslation: AppState.ignoreNameTranslation, promptEnabled: AppState.aiPromptEnabled, contextEnabled: AppState.contextEnabled, contextSize: AppState.contextSize, vndbEnabled: AppState.vndbEnabled, vndbId: AppState.vndbId, vndbGlossary: AppState.vndbGlossary, customEnabled: AppState.customEnabled, customRaw: AppState.customRaw, customGlossary: AppState.customGlossary
    });
    UI.el.statusBar.textContent = UI.el.statusBar.textContent.replace(" | Tersimpan!", "") + " | Tersimpan!";
    setTimeout(AppController.updateStatusBar, CFG.DELAY_STATUS);
  }
}

class FastVirtualScroller {
  constructor(v, c, cr, up) {
    this.v = v; this.c = c; this.cr = cr; this.up = up;
    this.items = []; this.pos = []; this.hts = []; this.pool = [];
    this.st = 0; this.defHt = CFG.DEF_ROW_HT;
    this.v.addEventListener('scroll', () => requestAnimationFrame(() => this.onScroll()), {passive:true});
  }
  ensure(s) { while(this.pool.length<s) { let e = this.cr(); e.style.transform = 'translateY(-9999px)'; this.pool.push(e); this.c.appendChild(e); } }
  setItems(i) {
    this.items = i; this.hts = new Float32Array(i.length).fill(this.defHt);
    this.pos = new Float32Array(i.length); this.updPos();
    this.st = this.v.scrollTop = 0; this.render();
  }
  updPos() { let t=8; for(let i=0; i<this.items.length; i++) { this.pos[i] = t; t += this.hts[i]; } this.c.style.height = `${t+8}px`; }
  onScroll() { this.st = this.v.scrollTop; this.render(); }
  find() {
    let l=0, r=this.items.length-1;
    while(l<=r) {
      let m = Math.floor((l+r)/2);
      if(this.pos[m] <= this.st && this.pos[m]+this.hts[m] > this.st) return m;
      if(this.pos[m] < this.st) l = m+1; else r = m-1;
    }
    return Math.max(0, Math.min(l, this.items.length-1));
  }
  render() {
    if(!this.items.length) { this.pool.forEach(p => p.style.transform = 'translateY(-9999px)'); this.c.style.height = '0px'; return; }
    let vh = this.v.clientHeight || 800, s = Math.max(0, this.find()-4), e = s, vH = 0;
    while(e < this.items.length && vH < vh+(this.defHt*8)) { vH += this.hts[e]; e++; }
    let req = e-s; this.ensure(req);
    let chg = false, hDiff = 0;
    for(let i=0; i<req; i++) {
      let dI = s+i, el = this.pool[i]; this.up(el, this.items[dI], dI);
      let h = el.offsetHeight;
      if(h && Math.abs(h+8 - this.hts[dI]) > 1) {
        let d = (h+8) - this.hts[dI]; this.hts[dI] = h+8; chg = true;
        if(this.pos[dI] < this.st) hDiff += d;
      }
    }
    for(let i=req; i<this.pool.length; i++) this.pool[i].style.transform = 'translateY(-9999px)';
    if(chg) { this.updPos(); if(hDiff !== 0) { this.v.scrollTop += hDiff; this.st = this.v.scrollTop; } }
    for(let i=0; i<req; i++) this.pool[i].style.transform = `translateY(${this.pos[s+i]}px)`;
  }
  scrollToIndex(i) {
    if(i<0 || i>=this.items.length) return;
    this.v.scrollTop = this.pos[i] - (this.v.clientHeight/2); this.st = this.v.scrollTop; this.render();
  }
  forceUpdate() { this.render(); }
}

class Importer {
  static decodeBuffer(b) {
    for(let enc of CFG.ENCODINGS) try { return new TextDecoder(enc, {fatal:true}).decode(b); } catch(e) {}
    return new TextDecoder("utf-8").decode(b);
  }
  static getBaseName(p) { return String(p||"").replace(/\\/g,"/").split("/").pop().replace(/\.json$/i,""); }
  static parseJsonData(j, f, sL) {
    if(!Array.isArray(j)) throw new Error(`File ${f} bukan array JSON.`);
    return j.filter(e => e && typeof e==="object" && Object.hasOwn(e,"message")).map(e => ({line_num:sL++, file:f, name:e.name==null?null:String(e.name).replace(/\r?\n/g,"\\n").trim(), message:String(e.message||"").replace(/\r?\n/g,"\\n").trim(), trans_name:null, trans_message:null, is_translated:false}));
  }
  static async processImport(filesObj, isZip=false) {
    UI.flashMessage("Memproses file...", true); document.body.style.cursor = "wait";
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      let cur = AppState.lines.length ? Math.max(...AppState.lines.map(l => l.line_num)) + 1 : 1, lns = [], eF = new Set(AppState.importedFiles), sF = [];
      if(isZip && filesObj instanceof File && window.JSZip) {
        if(AppState.projectType === CFG.TYPE_UNINIT) AppState.projectType = "json";
        let zip = new window.JSZip(); await zip.loadAsync(filesObj);
        for(let n of Object.keys(zip.files).filter(x => x.endsWith(".json")).sort()) {
          let b = Importer.getBaseName(n);
          if(eF.has(b)) { sF.push(b); continue; }
          let j = JSON.parse(Importer.decodeBuffer(await zip.file(n).async("uint8array"))), p = Importer.parseJsonData(j, b, cur);
          if(p.length) { eF.add(b); lns.push(...p); cur += p.length; }
        }
      } else {
        for(let f of Array.from(filesObj).sort((a,b) => a.name.localeCompare(b.name))) {
          if(f.name.toLowerCase().endsWith(".epub")) {
            if(AppState.projectType === "epub" && AppState.epubSourceId) { alert("Project ini sudah memuat EPUB."); continue; }
            if(AppState.projectType === CFG.TYPE_UNINIT) { AppState.projectType = "epub"; AppState.epubSourceId = "epub_"+Date.now()+".epub"; }
            let root = await StorageManager.getRoot(), fh = await root.getFileHandle(AppState.epubSourceId, {create:true}), w = await fh.createWritable();
            await w.write(f); await w.close();
            let zip = new window.JSZip(); await zip.loadAsync(f);
            let cx = await zip.file("META-INF/container.xml").async("text"), rf = new DOMParser().parseFromString(cx, "application/xml").querySelector("rootfile");
            if(!rf) throw new Error("EPUB tidak valid.");
            let opf = decodeURIComponent(rf.getAttribute("full-path")), od = opf.includes("/") ? opf.substring(0, opf.lastIndexOf("/"))+"/" : "", oDoc = new DOMParser().parseFromString(await zip.file(opf).async("text"), "application/xml"), mf = {};
            Array.from(oDoc.querySelectorAll("manifest > item")).forEach(i => mf[i.getAttribute("id")] = decodeURIComponent(i.getAttribute("href")));
            let hfs = Array.from(oDoc.querySelectorAll("spine > itemref")).map(r => mf[r.getAttribute("idref")] ? od+mf[r.getAttribute("idref")] : null).filter(Boolean), ts = AppState.epubTags || CFG.DEF_TAGS;
            for(let h of hfs) {
              if(eF.has(h)) { sF.push(h); continue; }
              let fe = zip.file(h); if(!fe) continue;
              let doc = new DOMParser().parseFromString(await fe.async("text"), h.endsWith('.xhtml')?"application/xhtml+xml":"text/html"), hc = false;
              Array.from(doc.querySelectorAll(ts)).forEach(el => {
                let txt = el.textContent.replace(/\r?\n/g," ").trim();
                if(txt) { lns.push({line_num:cur++, file:h, name:null, message:txt, trans_name:null, trans_message:null, is_translated:false}); hc = true; }
              });
              if(hc) eF.add(h);
            }
          } else if(f.name.toLowerCase().endsWith(".json")) {
            if(AppState.projectType === CFG.TYPE_UNINIT) AppState.projectType = "json";
            let b = Importer.getBaseName(f.name);
            if(eF.has(b)) { sF.push(b); continue; }
            let p = Importer.parseJsonData(JSON.parse(Importer.decodeBuffer(await f.arrayBuffer())), b, cur);
            if(p.length) { eF.add(b); lns.push(...p); cur += p.length; }
          }
        }
      }
      if(lns.length) {
        AppState.lines.push(...lns); AppState.importedFiles = Array.from(eF);
        AppController.refreshWorkspace(); AppState.queueAutoSave();
        UI.flashMessage(`Berhasil impor ${lns.length} baris.${sF.length ? ` (${sF.length} file duplikat diabaikan)` : ""}`);
      } else if(sF.length) { UI.el.copyStatus.classList.add("empty"); setTimeout(() => alert(`Gagal impor: File duplikat.\n- ${sF.slice(0,5).join('\n- ')}`), 10); }
      else UI.flashMessage("Tidak ada data valid.", false);
    } catch(err) { UI.el.copyStatus.classList.add("empty"); setTimeout(() => alert(`Error:\n${err.message}`), 10); }
    finally { document.body.style.cursor = "default"; }
  }
}

class Exporter {
  static async exportData() {
    if(!AppState.lines.length) return;
    if(AppState.projectType === "epub" && AppState.epubSourceId) {
      try {
        UI.flashMessage("Membuat EPUB...", true); document.body.style.cursor = "wait";
        let r = await StorageManager.getRoot(), fh = await r.getFileHandle(AppState.epubSourceId), f = await fh.getFile(), zip = new window.JSZip(); await zip.loadAsync(f);
        let lBf = {}; AppState.lines.forEach(l => { if(!lBf[l.file]) lBf[l.file]=[]; lBf[l.file].push(l); });
        let ts = AppState.epubTags || CFG.DEF_TAGS;
        for(let [h, fL] of Object.entries(lBf)) {
          let zf = zip.file(h); if(!zf) continue;
          let ht = await zf.async("text"), xm = ht.match(/^<\?xml.*?\?>/i), doc = new DOMParser().parseFromString(ht, h.endsWith('.xhtml')?"application/xhtml+xml":"text/html"), idx = 0;
          Array.from(doc.querySelectorAll(ts)).forEach(el => {
            if(el.textContent.replace(/\r?\n/g," ").trim() === "") return;
            let l = fL[idx++]; if(l && l.is_translated && l.trans_message) el.textContent = l.trans_message;
          });
          let nH = new XMLSerializer().serializeToString(doc); if(xm && !nH.startsWith("<?xml")) nH = xm[0]+"\n"+nH;
          zip.file(h, nH);
        }
        if(zip.file("mimetype")) zip.file("mimetype", await zip.file("mimetype").async("text"), {compression:"STORE"});
        let url = URL.createObjectURL(await zip.generateAsync({type:"blob", mimeType:"application/epub+zip", compression:"DEFLATE", compressionOptions:{level:9}}));
        let a = UI.createDomNode("a", null, {href:url, download:`${AppState.projectName.replace(/[^\p{L}\p{N}_\-\.]/gu,'_')}_tl.epub`}); a.click(); setTimeout(()=>URL.revokeObjectURL(url), CFG.DELAY_REVOKE);
        UI.flashMessage("Ekspor EPUB berhasil!");
      } catch(err) { alert("Ekspor EPUB gagal: " + err.message); } finally { document.body.style.cursor = "default"; }
    } else {
      let g = new Map(); AppState.lines.forEach(l => { if(!g.has(l.file)) g.set(l.file,[]); g.get(l.file).push(l); });
      let res = Array.from(g.entries()).map(([fn, lns]) => ({
        fn: `${fn.replace(/\.xhtml|\.html/g,'')}.json`,
        content: JSON.stringify(lns.map(l => {
          let e = {}, n = AppState.isTranslated(l) ? (l.trans_name||l.name) : l.name, m = AppState.isTranslated(l) ? l.trans_message : l.message;
          if(n != null) e.name = n.replace(/\\n/g,"\n"); e.message = m != null ? m.replace(/\\n/g,"\n") : ""; return e;
        }), null, 2)
      }));
      if(window.JSZip && res.length > 1) {
        let zip = new window.JSZip(); res.forEach(f => zip.file(f.fn, f.content));
        let url = URL.createObjectURL(await zip.generateAsync({type:"blob", mimeType:"application/octet-stream", compression:"DEFLATE", compressionOptions:{level:9}}));
        let a = UI.createDomNode("a", null, {href:url, download:`${AppState.projectName.replace(/[^\p{L}\p{N}_\-\.]/gu,'_')}_export.zip`}); a.click(); setTimeout(()=>URL.revokeObjectURL(url), CFG.DELAY_REVOKE);
      } else {
        res.forEach(f => { let url = URL.createObjectURL(new Blob([f.content], {type:"application/json"})); let a = UI.createDomNode("a", null, {href:url, download:f.fn}); a.click(); setTimeout(()=>URL.revokeObjectURL(url), CFG.DELAY_REVOKE); });
      }
    }
  }
}

class VndbService {
  static isJapanese(t) { return /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(t); }
  static async fetchCharacters(id) {
    let all = [], pg = 1, more = true;
    while(more) {
      let r = await fetch(CFG.API_VNDB, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({filters:["vn","=",["id","=",id]], fields:"name, original, aliases", results:100, page:pg})});
      if(!r.ok) throw new Error(`Status: ${r.status}`);
      let d = await r.json(); if(d.results) all.push(...d.results); more = d.more || false; pg++;
    }
    return all;
  }
  static buildGlossary(c) {
    let g = new Map(), add = (j,r) => { j=(j||"").trim(); r=(r||"").trim(); if(j&&r&&VndbService.isJapanese(j)&&!g.has(j)) g.set(j,r); };
    for(let ch of c) {
      if(!ch.name || !ch.original) continue;
      add(ch.original, ch.name);
      if(ch.original.includes(' ') && ch.name.includes(' ')) { let kp = ch.original.split(' '), rp = ch.name.split(' '); if(kp.length===rp.length) kp.forEach((k,i)=>add(k,rp[i])); }
      let ja = (ch.aliases||[]).filter(a => VndbService.isJapanese(a)), ra = (ch.aliases||[]).filter(a => !VndbService.isJapanese(a)), fb = ch.name.split(' ').pop() || ch.name;
      ja.forEach((jA, i) => add(jA, ra[i] || fb));
    }
    return Array.from(g.entries()).sort((a,b) => b[0].length - a[0].length);
  }
}

class AppController {
  static mainScroller = null; static proofreadScroller = null; static activeEditorLineNum = null;
  static currentHighlightRegex = null; static tempVndbGlossary = []; static tempCustomRaw = ""; static tempCustomGlossary = [];

  static async createNewProject() {
    let nm = prompt("Nama project baru:"); if(!nm?.trim()) return; nm = nm.trim();
    let id = "proj_"+Date.now()+CFG.EXT_PROJ, data = {version:CFG.APP_VER, projectName:nm, projectType:CFG.TYPE_UNINIT, epubTags:CFG.DEF_TAGS, epubSourceId:null, updatedAt:Date.now(), imported_files:[], lines:[], prompt_header:CFG.DEF_PROMPT, ignoreNameTranslation:CFG.DEF_IGNORE_NAME, promptEnabled:CFG.DEF_PROMPT_EN, contextEnabled:CFG.DEF_CTX_EN, contextSize:CFG.DEF_CTX_SIZE, vndbEnabled:CFG.DEF_VNDB_EN, vndbId:"", vndbGlossary:[], customEnabled:CFG.DEF_CUST_EN, customRaw:"", customGlossary:[]};
    await StorageManager.saveProject(id, data); AppController.openProject(id, data);
  }

  static async init() {
    UI.cache(); if(!navigator.storage?.getDirectory) return UI.el.projectList.innerHTML = `<p class="hint" style="grid-column:1/-1;color:var(--danger);">Browser tidak mendukung OPFS.</p>`;
    AppController.mainScroller = new FastVirtualScroller(UI.el.previewViewport, UI.el.previewContainer, AppController.createMainRow, AppController.updateMainRow);
    AppController.proofreadScroller = new FastVirtualScroller(UI.el.proofreadContainer.closest('.proofread-results-wrap'), UI.el.proofreadContainer, AppController.createProofreadRow, AppController.updateProofreadRow);
    AppController.bindEvents(); await AppController.loadDashboard();
  }
  static throttle(f, d=CFG.DELAY_SEARCH) { let t; return function(...a) { clearTimeout(t); t = setTimeout(() => f.apply(this, a), d); }; }
  static evalContextApplyBtn() {
    let v = parseInt(UI.el.settingsContextInput.value);
    UI.el.btnSettingsContextApply.disabled = (!UI.el.settingsContextCheck.checked || isNaN(v) || v===AppState.contextSize || v>AppState.translatedCount || v<1);
  }
  static adjustToolbar() {
    let w = UI.el.dynamicToolbarWrap, a = UI.el.actionButtons, mG = UI.el.moreGroup, mD = UI.el.moreDropdown;
    if(!w||!a||!mG||!mD) return;
    let items = [UI.el.importGroup, UI.el.btnExport, UI.el.btnProofread, UI.el.btnGlossary, UI.el.btnSettings];
    items.forEach(el => { if(el) a.appendChild(el); }); mG.style.display = 'none';
    if(a.scrollWidth > w.clientWidth) {
      mG.style.display = 'inline-block';
      for(let i = items.length-1; i>=0; i--) { if(a.scrollWidth > w.clientWidth && a.children.length > 0) mD.insertBefore(items[i], mD.firstChild); else break; }
    }
  }

  static bindEvents() {
    window.addEventListener('resize', AppController.throttle(() => { if(UI.el.workspaceView.style.display !== "none") AppController.adjustToolbar(); }, CFG.DELAY_RESIZE));
    UI.el.btnNewProject.addEventListener("click", AppController.createNewProject); UI.el.btnBackToDashboard.addEventListener("click", AppController.closeProject);
    UI.el.btnRestoreProject.addEventListener("click", () => UI.el.restoreProjectInput.click()); UI.el.restoreProjectInput.addEventListener("change", AppController.restoreProject);
    document.addEventListener("click", e => {
      let isImportBtn = e.target.closest('#btnImportMain'), isMoreBtn = e.target.closest('#btnMore');
      if(isImportBtn) { e.preventDefault(); UI.el.importDropdown?.classList.toggle("show"); }
      if(isMoreBtn) { e.preventDefault(); UI.el.moreDropdown?.classList.toggle("show"); }
      if(!e.target.closest('#importGroup') && UI.el.importDropdown) UI.el.importDropdown.classList.remove("show");
      if(!e.target.closest('#moreGroup') && UI.el.moreDropdown) UI.el.moreDropdown.classList.remove("show");
    });
    ["btnImportFile","btnImportFolder","btnImportZip"].forEach((id, i) => {
      let inputs = [UI.el.importFileInput, UI.el.importFolderInput, UI.el.importZipInput];
      UI.el[id].addEventListener("click", () => { UI.el.importDropdown.classList.remove("show"); if(UI.el.moreDropdown) UI.el.moreDropdown.classList.remove("show"); inputs[i].click(); });
      inputs[i].addEventListener("change", async e => { if(!e.target.files.length) return; await Importer.processImport(id==="btnImportZip"?e.target.files[0]:e.target.files, id==="btnImportZip"); e.target.value = ""; });
    });
    UI.el.btnExport.addEventListener("click", () => { if(UI.el.moreDropdown) UI.el.moreDropdown.classList.remove("show"); Exporter.exportData(); });
    UI.el.btnCopyForAi.addEventListener("click", AppController.copyForAi); UI.el.btnApply.addEventListener("click", AppController.applyTranslation);
    UI.el.btnUndo.addEventListener("click", AppController.undoTranslation); UI.el.btnRedo.addEventListener("click", AppController.redoTranslation);
    UI.el.btnProofread.addEventListener("click", () => { if(UI.el.moreDropdown) UI.el.moreDropdown.classList.remove("show"); AppController.openProofread(); });
    UI.el.btnSelectAll.addEventListener("click", () => { AppState.lines.forEach(l => { if(!AppState.isTranslated(l)) AppState.selectedLines.add(l.line_num); }); AppController.syncCheckboxes(); });
    UI.el.btnClearSelection.addEventListener("click", () => { AppState.selectedLines.clear(); AppController.syncCheckboxes(); });
    UI.el.btnSelectRange.addEventListener("click", AppController.selectRange);
    
    UI.el.btnGlossary.addEventListener("click", () => {
      if(UI.el.moreDropdown) UI.el.moreDropdown.classList.remove("show");
      UI.el.glossaryVndbCheck.checked = AppState.vndbEnabled; UI.el.glossaryVndbIdInput.value = AppState.vndbId || "";
      AppController.tempVndbGlossary = [...AppState.vndbGlossary]; UI.el.glossaryVndbPreviewArea.value = AppController.tempVndbGlossary.map(g => `${g[0]}: ${g[1]}`).join("\n");
      UI.el.glossaryVndbWrap.style.opacity = AppState.vndbEnabled ? "1" : "0.4"; UI.el.glossaryVndbWrap.style.pointerEvents = AppState.vndbEnabled ? "auto" : "none";
      UI.el.glossaryVndbIdInput.disabled = UI.el.btnGlossaryVndbFetch.disabled = AppController.tempVndbGlossary.length > 0;
      UI.el.glossaryCustomCheck.checked = AppState.customEnabled;
      AppController.tempCustomRaw = AppState.customRaw || ""; AppController.tempCustomGlossary = [...AppState.customGlossary];
      UI.el.glossaryCustomInput.value = AppController.tempCustomRaw; UI.el.glossaryCustomWrap.style.opacity = AppState.customEnabled ? "1" : "0.4";
      UI.el.glossaryCustomWrap.style.pointerEvents = AppState.customEnabled ? "auto" : "none"; UI.el.btnGlossaryCustomApply.disabled = true;
      UI.toggleModal(UI.el.glossaryModal, true);
    });
    
    UI.el.btnSettings.addEventListener("click", () => {
      if(UI.el.moreDropdown) UI.el.moreDropdown.classList.remove("show");
      UI.el.settingsIgnoreNameCheck.checked = AppState.ignoreNameTranslation; UI.el.settingsPromptCheck.checked = AppState.aiPromptEnabled;
      UI.el.settingsContextCheck.checked = AppState.contextEnabled; UI.el.settingsPromptInput.value = AppState.aiInstructionHeader;
      UI.el.settingsEpubTagsInput.value = AppState.epubTags || CFG.DEF_TAGS; UI.el.settingsContextInput.value = AppState.contextSize;
      UI.el.settingsContextWrap.style.opacity = AppState.contextEnabled ? "1" : "0.4"; UI.el.settingsContextWrap.style.pointerEvents = AppState.contextEnabled ? "auto" : "none";
      UI.el.settingsContextInput.disabled = !AppState.contextEnabled || (AppState.translatedCount < 1);
      AppController.evalContextApplyBtn(); UI.toggleModal(UI.el.settingsModal, true);
    });

    UI.el.settingsContextCheck.addEventListener("change", e => { UI.el.settingsContextWrap.style.opacity = e.target.checked?"1":"0.4"; UI.el.settingsContextWrap.style.pointerEvents = e.target.checked?"auto":"none"; UI.el.settingsContextInput.disabled = !e.target.checked || AppState.translatedCount<1; if(!e.target.checked) UI.el.btnSettingsContextApply.disabled = true; else AppController.evalContextApplyBtn(); });
    UI.el.settingsContextInput.addEventListener("input", AppController.evalContextApplyBtn);
    UI.el.btnSettingsContextApply.addEventListener("click", () => { let v = parseInt(UI.el.settingsContextInput.value); if(!isNaN(v)){ AppState.contextSize = v; AppState.queueAutoSave(); AppController.evalContextApplyBtn(); } });
    UI.el.btnSettingsDasarReset.addEventListener("click", () => { UI.el.settingsIgnoreNameCheck.checked = CFG.DEF_IGNORE_NAME; UI.el.settingsPromptCheck.checked = CFG.DEF_PROMPT_EN; UI.el.settingsContextCheck.checked = CFG.DEF_CTX_EN; UI.el.settingsContextInput.value = CFG.DEF_CTX_SIZE; UI.el.settingsContextWrap.style.opacity = CFG.DEF_CTX_EN?"1":"0.4"; UI.el.settingsContextWrap.style.pointerEvents = CFG.DEF_CTX_EN?"auto":"none"; UI.el.settingsContextInput.disabled = !CFG.DEF_CTX_EN || AppState.translatedCount<1; AppController.evalContextApplyBtn(); });
    UI.el.btnSettingsPromptReset.addEventListener("click", () => UI.el.settingsPromptInput.value = CFG.DEF_PROMPT);
    UI.el.btnSettingsEpubReset.addEventListener("click", () => UI.el.settingsEpubTagsInput.value = CFG.DEF_TAGS);
    UI.el.btnSettingsCancel.addEventListener("click", () => UI.toggleModal(UI.el.settingsModal, false));
    UI.el.btnSettingsSave.addEventListener("click", () => {
      AppState.ignoreNameTranslation = UI.el.settingsIgnoreNameCheck.checked; AppState.aiPromptEnabled = UI.el.settingsPromptCheck.checked; AppState.contextEnabled = UI.el.settingsContextCheck.checked; AppState.aiInstructionHeader = UI.el.settingsPromptInput.value.trim(); AppState.epubTags = UI.el.settingsEpubTagsInput.value.trim() || CFG.DEF_TAGS;
      UI.toggleModal(UI.el.settingsModal, false); AppState.queueAutoSave();
    });

    UI.el.glossaryVndbCheck.addEventListener("change", e => { UI.el.glossaryVndbWrap.style.opacity = e.target.checked?"1":"0.4"; UI.el.glossaryVndbWrap.style.pointerEvents = e.target.checked?"auto":"none"; });
    UI.el.btnGlossaryVndbFetch.addEventListener("click", async () => {
      let id = UI.el.glossaryVndbIdInput.value.trim(); if(!id) return; if(!id.startsWith("v")) id = "v"+id;
      try {
        UI.el.btnGlossaryVndbFetch.disabled = UI.el.glossaryVndbIdInput.disabled = true; UI.el.glossaryVndbStatus.textContent = "Mengambil data..."; UI.el.glossaryVndbStatus.className = "status-toast"; UI.el.glossaryVndbStatus.style.color = "var(--primary)";
        let chars = await VndbService.fetchCharacters(id); if(!chars.length) throw new Error("Karakter tidak ditemukan.");
        AppController.tempVndbGlossary = VndbService.buildGlossary(chars);
        UI.el.glossaryVndbPreviewArea.value = AppController.tempVndbGlossary.map(g => `${g[0]}: ${g[1]}`).join("\n");
        UI.el.glossaryVndbStatus.textContent = `Ditemukan ${AppController.tempVndbGlossary.length} entri.`; UI.el.glossaryVndbStatus.style.color = "var(--success)";
      } catch(err) { UI.el.glossaryVndbStatus.textContent = err.message; UI.el.glossaryVndbStatus.style.color = "var(--danger)"; UI.el.btnGlossaryVndbFetch.disabled = UI.el.glossaryVndbIdInput.disabled = false; }
    });
    UI.el.btnGlossaryVndbReset.addEventListener("click", () => { UI.el.glossaryVndbCheck.checked = CFG.DEF_VNDB_EN; UI.el.glossaryVndbIdInput.value = ""; UI.el.glossaryVndbPreviewArea.value = ""; AppController.tempVndbGlossary = []; UI.el.glossaryVndbStatus.className = "status-toast empty mb-2"; UI.el.glossaryVndbIdInput.disabled = UI.el.btnGlossaryVndbFetch.disabled = false; UI.el.glossaryVndbWrap.style.opacity = "0.4"; UI.el.glossaryVndbWrap.style.pointerEvents = "none"; });
    UI.el.glossaryCustomCheck.addEventListener("change", e => { UI.el.glossaryCustomWrap.style.opacity = e.target.checked?"1":"0.4"; UI.el.glossaryCustomWrap.style.pointerEvents = e.target.checked?"auto":"none"; });
    UI.el.btnGlossaryCustomReset.addEventListener("click", () => { UI.el.glossaryCustomCheck.checked = CFG.DEF_CUST_EN; UI.el.glossaryCustomInput.value = ""; UI.el.glossaryCustomWrap.style.opacity = "0.4"; UI.el.glossaryCustomWrap.style.pointerEvents = "none"; UI.el.btnGlossaryCustomApply.disabled = true; AppController.tempCustomRaw = ""; AppController.tempCustomGlossary = []; });
    UI.el.glossaryCustomInput.addEventListener("input", () => {
      let v = UI.el.glossaryCustomInput.value, iv = true, hc = false;
      for(let l of v.split(/\r?\n/)) { l = l.trim(); if(!l) continue; hc=true; let ci=l.indexOf(":"); if(ci<=0 || ci===l.length-1 || !l.substring(0,ci).trim() || !l.substring(ci+1).trim()) { iv=false; break; } }
      UI.el.btnGlossaryCustomApply.disabled = (v===AppController.tempCustomRaw || (!iv&&hc));
    });
    UI.el.btnGlossaryCustomApply.addEventListener("click", () => {
      let v = UI.el.glossaryCustomInput.value, p = [];
      v.split(/\r?\n/).forEach(l => { l=l.trim(); let ci=l.indexOf(":"); if(ci>0) { let k=l.substring(0,ci).trim(), val=l.substring(ci+1).trim(); if(k&&val) p.push([k,val]); } });
      AppController.tempCustomRaw = v; AppController.tempCustomGlossary = p; UI.el.btnGlossaryCustomApply.disabled = true;
    });
    UI.el.btnGlossaryCancel.addEventListener("click", () => UI.toggleModal(UI.el.glossaryModal, false));
    UI.el.btnGlossarySave.addEventListener("click", () => {
      AppState.vndbEnabled = UI.el.glossaryVndbCheck.checked; AppState.vndbId = UI.el.glossaryVndbIdInput.value.trim(); AppState.vndbGlossary = AppController.tempVndbGlossary; AppState.customEnabled = UI.el.glossaryCustomCheck.checked; AppState.customRaw = AppController.tempCustomRaw; AppState.customGlossary = AppController.tempCustomGlossary;
      UI.toggleModal(UI.el.glossaryModal, false); AppState.queueAutoSave();
    });

    UI.el.btnLineCancel.addEventListener("click", () => UI.toggleModal(UI.el.lineEditorModal, false)); UI.el.btnLineSave.addEventListener("click", AppController.saveLineEditor);
    UI.el.btnProofreadClose.addEventListener("click", () => UI.toggleModal(UI.el.proofreadModal, false));
    UI.el.btnProofreadReset.addEventListener("click", () => { UI.el.proofreadSearchInput.value = ""; UI.el.proofreadReplaceInput.value = ""; UI.el.proofreadScope.value = "all"; UI.el.proofreadRegexCheck.checked = UI.el.proofreadCaseCheck.checked = UI.el.proofreadExactCheck.checked = false; UI.el.proofreadTranslatedOnlyCheck.checked = true; AppController.renderProofread(); });
    UI.el.btnProofreadReplaceAll.addEventListener("click", AppController.execReplaceAll);
    let ds = AppController.throttle(AppController.renderProofread, CFG.DELAY_SEARCH);
    UI.el.proofreadSearchInput.addEventListener("input", ds);
    ["proofreadScope","proofreadRegexCheck","proofreadCaseCheck","proofreadExactCheck","proofreadTranslatedOnlyCheck"].forEach(id => UI.el[id].addEventListener("change", AppController.renderProofread));
    UI.el.previewContainer.addEventListener("change", e => {
      if(e.target.classList.contains('sep-cb')) { (AppState.filesLinesCache.get(e.target.dataset.file)||[]).forEach(l => { if(!AppState.isTranslated(l)) e.target.checked ? AppState.selectedLines.add(l.line_num) : AppState.selectedLines.delete(l.line_num); }); AppController.syncCheckboxes(); }
      else if(e.target.closest('.checkbox-cell') && e.target.type === 'checkbox') { let n = Number(e.target.dataset.num); e.target.checked ? AppState.selectedLines.add(n) : AppState.selectedLines.delete(n); AppController.syncCheckboxes(); }
    });
    UI.el.previewContainer.addEventListener("click", e => { let c = e.target.closest('.text-content'); if(c) { let r=c.closest('.preview-row'); if(r && !r.classList.contains('separator')) { let cb=r.querySelector('input[type="checkbox"]'); if(cb?.dataset.num) AppController.openLineEditor(Number(cb.dataset.num)); } } });
    UI.el.proofreadContainer.addEventListener("click", e => { let c = e.target.closest('.text-content'); if(c?.dataset.num) AppController.openLineEditor(Number(c.dataset.num)); });
    UI.el.nameTableBody.addEventListener("click", async e => { if(e.target.tagName==="TD") try { await navigator.clipboard.writeText(e.target.textContent); UI.flashMessage(`Nama disalin!`); } catch(er) { alert(`Gagal disalin.`); } });
    UI.el.btnCopyAllNames.addEventListener("click", async () => { let s = new Set(); AppState.lines.forEach(l => { if(l.name) s.add(l.name); }); let ns = Array.from(s).sort(); if(!ns.length) return; try { await navigator.clipboard.writeText(ns.join('\n')); UI.flashMessage(`${ns.length} nama disalin!`); } catch(er) { alert("Clipboard diblokir."); } });
  }

  static async loadDashboard() {
    UI.el.projectList.innerHTML = "";
    try {
      let pr = await StorageManager.fetchProjects();
      if(!pr.length) return UI.el.projectList.innerHTML = `<p class="hint" style="grid-column:1/-1;">Belum ada Project. Buat atau Pulihkan!</p>`;
      pr.forEach(p => {
        let cd = UI.createDomNode("div", "project-card"), bdg = p.fileCount||p.lineCount ? (p.data.projectType==='epub'?`<span class="badge badge-epub">EPUB</span>`:(p.data.projectType==='json'?`<span class="badge badge-json">JSON-VNTP</span>`:'')) : '';
        cd.innerHTML = `<div><h3>${p.name}</h3><div class="project-meta mt-2">${bdg?`<div style="margin-bottom:8px;">${bdg}</div>`:''}Diubah: ${new Date(p.updatedAt).toLocaleString('id-ID')}<br>File: ${p.fileCount} | Baris: ${p.lineCount}</div></div><div class="project-actions"><button class="btn btn-primary btn-sm btn-open">Buka</button><button class="btn btn-outline btn-sm btn-rename">Ubah</button><button class="btn btn-outline btn-sm btn-backup">Backup</button><button class="btn btn-danger btn-sm btn-delete">Hapus</button></div>`;
        cd.querySelector(".btn-open").addEventListener("click", () => AppController.openProject(p.id, p.data));
        cd.querySelector(".btn-rename").addEventListener("click", async () => { let n = prompt("Nama baru:", p.name); if(n?.trim() && n!==p.name) { p.data.projectName = n.trim(); await StorageManager.saveProject(p.id, p.data); AppController.loadDashboard(); } });
        cd.querySelector(".btn-backup").addEventListener("click", async () => {
          try {
            document.body.style.cursor = "wait"; let z = new window.JSZip(); z.file("metadata.json", JSON.stringify({version:p.data.version, projectName:p.data.projectName, projectType:p.data.projectType, epubTags:p.data.epubTags, epubSourceId:p.data.epubSourceId, updatedAt:p.data.updatedAt, imported_files:p.data.imported_files, prompt_header:p.data.prompt_header, ignoreNameTranslation:p.data.ignoreNameTranslation, promptEnabled:p.data.promptEnabled, contextEnabled:p.data.contextEnabled, contextSize:p.data.contextSize, vndbEnabled:p.data.vndbEnabled, vndbId:p.data.vndbId, vndbGlossary:p.data.vndbGlossary, customEnabled:p.data.customEnabled, customRaw:p.data.customRaw, customGlossary:p.data.customGlossary}));
            let oStr="", tStr="", nStr="";
            for(let f of (p.data.imported_files||[])) { oStr+=`>>> ${f} <<<\n`; tStr+=`>>> ${f} <<<\n`; nStr+=`>>> ${f} <<<\n`; p.data.lines.filter(l=>l.file===f).forEach(l=>{ oStr+=`${l.message||""}\n`; tStr+=`${l.trans_message||""}\n`; nStr+=((l.name||"")||(l.trans_name||"")) ? `${l.name||""} ||| ${l.trans_name||""}\n` : `\n`; }); }
            z.file("original.txt", oStr); z.file("translated.txt", tStr); z.file("names.txt", nStr);
            if(p.data.projectType==="epub" && p.data.epubSourceId) z.file(p.data.epubSourceId, await (await (await StorageManager.getRoot()).getFileHandle(p.data.epubSourceId)).getFile());
            let u = URL.createObjectURL(await z.generateAsync({type:"blob", mimeType:"application/octet-stream", compression:"DEFLATE", compressionOptions:{level:9}})), a = UI.createDomNode("a", null, {href:u, download:`${p.name.replace(/[^\p{L}\p{N}_\-\.]/gu,'_')}_backup${CFG.EXT_PROJ}`}); a.click(); setTimeout(()=>URL.revokeObjectURL(u), CFG.DELAY_REVOKE);
          } catch(e) { alert("Gagal backup: "+e.message); } finally { document.body.style.cursor = "default"; }
        });
        cd.querySelector(".btn-delete").addEventListener("click", async () => { if(confirm("Hapus permanen?")) { await StorageManager.removeProject(p.id, p.data.epubSourceId); AppController.loadDashboard(); } });
        UI.el.projectList.appendChild(cd);
      });
    } catch(e) { UI.el.projectList.innerHTML = `<p class="hint" style="color:var(--danger);">Gagal akses storage.</p>`; }
  }

  static async restoreProject(ev) {
    let f = ev.target.files?.[0]; if(!f) return;
    try {
      document.body.style.cursor = "wait"; let z = new window.JSZip(); await z.loadAsync(f);
      let m = z.file("metadata.json"), o = z.file("original.txt"), t = z.file("translated.txt"), n = z.file("names.txt");
      if(!m||!o||!t||!n) throw new Error("Format arsip tidak valid.");
      let p = JSON.parse(await m.async("text")), oL = (await o.async("text")).split(/\r?\n/), tL = (await t.async("text")).split(/\r?\n/), nL = (await n.async("text")).split(/\r?\n/);
      if(oL[oL.length-1]==="") oL.pop(); if(tL[tL.length-1]==="") tL.pop(); if(nL[nL.length-1]==="") nL.pop();
      if(oL.length!==tL.length || oL.length!==nL.length) throw new Error("Baris tidak sinkron.");
      let lns = [], cF = CFG.DEF_FILE, num = 1;
      for(let i=0; i<oL.length; i++) {
        if(oL[i].startsWith(">>> ") && oL[i].endsWith(" <<<")) { if(tL[i]!==oL[i] || nL[i]!==oL[i]) throw new Error("Header file tidak sinkron."); cF = oL[i].slice(4,-4); }
        else lns.push({line_num:num++, file:cF, name:nL[i].trim()?nL[i].split(" ||| ")[0]?.trim()||null:null, message:oL[i], trans_name:nL[i].trim()?nL[i].split(" ||| ")[1]?.trim()||null:null, trans_message:tL[i]||null, is_translated:!!tL[i]?.trim()});
      }
      let nm = p.projectName || f.name.replace(CFG.EXT_PROJ,'');
      if(p.projectType==="epub" && p.epubSourceId) { let ef = z.file(p.epubSourceId); if(ef) { let nId = "epub_"+Date.now()+".epub", w = await (await (await StorageManager.getRoot()).getFileHandle(nId, {create:true})).createWritable(); await w.write(await ef.async("blob")); await w.close(); p.epubSourceId = nId; } }
      await StorageManager.saveProject("proj_"+Date.now()+CFG.EXT_PROJ, { version:CFG.APP_VER, projectName:nm, projectType:p.projectType||CFG.TYPE_UNINIT, epubTags:p.epubTags||CFG.DEF_TAGS, epubSourceId:p.epubSourceId||null, imported_files:p.imported_files||[], lines:lns.map(AppState.normalizeLine), prompt_header:p.prompt_header||CFG.DEF_PROMPT, ignoreNameTranslation:p.ignoreNameTranslation??CFG.DEF_IGNORE_NAME, promptEnabled:p.promptEnabled??CFG.DEF_PROMPT_EN, contextEnabled:p.contextEnabled??CFG.DEF_CTX_EN, contextSize:p.contextSize??CFG.DEF_CTX_SIZE, vndbEnabled:p.vndbEnabled??CFG.DEF_VNDB_EN, vndbId:p.vndbId||"", vndbGlossary:p.vndbGlossary||[], customEnabled:p.customEnabled??CFG.DEF_CUST_EN, customRaw:p.customRaw||"", customGlossary:p.customGlossary||[] });
      await AppController.loadDashboard(); alert(`Project "${nm}" dipulihkan!`);
    } catch(e) { alert("File korup: " + e.message); } finally { document.body.style.cursor = "default"; ev.target.value = ""; }
  }

  static openProject(id, d) {
    AppState.currentProjectId=id; AppState.projectName=d.projectName||"Unknown"; AppState.projectType=d.projectType||CFG.TYPE_UNINIT; AppState.epubTags=d.epubTags||CFG.DEF_TAGS; AppState.epubSourceId=d.epubSourceId||null; AppState.lines=(d.lines||[]).map(AppState.normalizeLine); AppState.importedFiles=d.imported_files||[]; AppState.aiInstructionHeader=d.prompt_header||CFG.DEF_PROMPT; AppState.ignoreNameTranslation=d.ignoreNameTranslation??CFG.DEF_IGNORE_NAME; AppState.aiPromptEnabled=d.promptEnabled??CFG.DEF_PROMPT_EN; AppState.contextEnabled=d.contextEnabled??CFG.DEF_CTX_EN; AppState.contextSize=d.contextSize??CFG.DEF_CTX_SIZE; AppState.vndbEnabled=d.vndbEnabled??CFG.DEF_VNDB_EN; AppState.vndbId=d.vndbId||""; AppState.vndbGlossary=d.vndbGlossary||[]; AppState.customEnabled=d.customEnabled??CFG.DEF_CUST_EN; AppState.customRaw=d.customRaw||""; AppState.customGlossary=d.customGlossary||[]; AppState.selectedLines.clear(); AppState.undoSnapshot=AppState.redoSnapshot=null;
    UI.el.projectNameDisplay.textContent=AppState.projectName; UI.el.dashboardView.classList.remove("open"); UI.el.workspaceView.style.display="flex"; requestAnimationFrame(() => AppController.adjustToolbar()); AppController.refreshWorkspace();
  }

  static closeProject() { if(AppState.saveTimeout) { clearTimeout(AppState.saveTimeout); StorageManager.saveProject(AppState.currentProjectId, {version:CFG.APP_VER, projectName:AppState.projectName, projectType:AppState.projectType, epubTags:AppState.epubTags, epubSourceId:AppState.epubSourceId, imported_files:AppState.importedFiles, lines:AppState.lines, prompt_header:AppState.aiInstructionHeader, ignoreNameTranslation:AppState.ignoreNameTranslation, promptEnabled:AppState.aiPromptEnabled, contextEnabled:AppState.contextEnabled, contextSize:AppState.contextSize, vndbEnabled:AppState.vndbEnabled, vndbId:AppState.vndbId, vndbGlossary:AppState.vndbGlossary, customEnabled:AppState.customEnabled, customRaw:AppState.customRaw, customGlossary:AppState.customGlossary}).then(AppController.finishClose); } else AppController.finishClose(); }
  static finishClose() { AppState.saveTimeout=AppState.currentProjectId=AppState.epubSourceId=AppState.undoSnapshot=AppState.redoSnapshot=null; AppState.projectName=""; AppState.lines=[]; AppState.importedFiles=[]; AppState.displayRows=[]; AppState.proofreadMatches=[]; AppState.selectedLines.clear(); AppState.lineByNum.clear(); AppState.filesLinesCache.clear(); AppState.translatedCount=0; if(AppController.mainScroller) AppController.mainScroller.setItems([]); if(AppController.proofreadScroller) AppController.proofreadScroller.setItems([]); UI.el.nameTableBody.replaceChildren(); UI.el.pasteArea.value=""; UI.el.copyStatus.classList.add("empty"); UI.el.workspaceView.style.display="none"; UI.el.dashboardView.classList.add("open"); AppController.loadDashboard(); }

  static refreshWorkspace() { AppState.updateTranslatedCount(); AppState.rebuildCache(); AppController.mainScroller.setItems(AppState.displayRows); AppController.updateButtons(); AppController.renderNameTable(); AppController.updateStatusBar(); UI.el.btnUndo.disabled = !AppState.undoSnapshot; UI.el.btnRedo.disabled = !AppState.redoSnapshot; }
  static updateButtons() { let dOk = AppState.lines.length>0, sOk = AppState.selectedLines.size>0; UI.el.btnExport.disabled = UI.el.btnProofread.disabled = UI.el.btnSelectAll.disabled = UI.el.pasteArea.disabled = UI.el.btnApply.disabled = UI.el.rangeFromInput.disabled = UI.el.rangeToInput.disabled = UI.el.btnSelectRange.disabled = !dOk; UI.el.btnClearSelection.disabled = UI.el.btnCopyForAi.disabled = !sOk; UI.el.copyCount.textContent = AppState.selectedLines.size; }
  static updateStatusBar() { let t=AppState.lines.length, tr=AppState.translatedCount, pc=t?Math.floor((tr/t)*100):0; UI.el.statusBar.textContent = `Mode: ${AppState.projectType===CFG.TYPE_UNINIT?"-":(AppState.projectType==="epub"?"EPUB":"JSON-VNTP")} | File: ${AppState.importedFiles.length>1?AppState.importedFiles.length:AppState.importedFiles[0]||"-"} | Baris: ${t} | TL: ${tr}/${t} (${pc}%)`; UI.el.progressFill.style.width=`${pc}%`; UI.el.progressText.textContent=`${tr}/${t}`; }

  static createMainRow() { let r=document.createElement("div"); r.className="preview-row"; let c=document.createElement("div"); c.className="checkbox-cell"; let cb=document.createElement("input"); cb.type="checkbox"; let t=document.createElement("div"); t.className="text-content"; let o=document.createElement("div"); o.className="original"; let tr=document.createElement("div"); tr.className="translated"; t.append(o,tr); c.append(cb,t); let s=document.createElement("div"); s.style.cssText="display:none;align-items:center;gap:12px;width:100%;"; let scb=document.createElement("input"); scb.type="checkbox"; scb.className="sep-cb"; let sl=document.createElement("div"); sl.className="mono grow"; sl.style.cssText="font-weight:700;color:var(--primary);"; s.append(scb,sl); r.append(c,s); r._cell=c; r._cb=cb; r._orig=o; r._trans=tr; r._sep=s; r._sepCb=scb; r._sepLbl=sl; return r; }
  static updateMainRow(r, d) {
    if(d.type==="separator") { r.className="preview-row separator"; r._cell.style.display="none"; r._sep.style.display="flex"; r._sepCb.dataset.file=d.file; let fL=AppState.filesLinesCache.get(d.file)||[], aC=true, hU=false; fL.forEach(l=>{ if(!AppState.isTranslated(l)) { hU=true; if(!AppState.selectedLines.has(l.line_num)) aC=false; } }); r._sepCb.checked=hU&&aC; r._sepLbl.textContent=`File: ${d.file}`; }
    else { let l=d.line, cls="preview-row"; if(AppState.isTranslated(l)) cls+=" row-translated"; if(AppState.selectedLines.has(l.line_num)) cls+=" row-selected"; r.className=cls; r._cell.style.display="flex"; r._sep.style.display="none"; r._cb.dataset.num=l.line_num; r._cb.checked=AppState.selectedLines.has(l.line_num); r._cb.disabled=AppState.isTranslated(l); r._orig.textContent=l.name?`${l.line_num}. ${l.name}: ${l.message}`:`${l.line_num}. ${l.message}`; if(AppState.isTranslated(l)) { r._trans.classList.remove("cell-muted"); let tn=l.trans_name||l.name; r._trans.textContent=tn?`${l.line_num}. ${tn}: ${l.trans_message}`:`${l.line_num}. ${l.trans_message}`; } else { r._trans.classList.add("cell-muted"); r._trans.textContent="——"; } }
  }
  static syncCheckboxes() { AppController.mainScroller.forceUpdate(); AppController.updateButtons(); }
  static renderNameTable() { let s=new Set(); AppState.lines.forEach(l=>{if(l.name) s.add(l.name)}); let ns=Array.from(s).sort(); UI.el.nameTotalCount.textContent=ns.length; UI.el.btnCopyAllNames.disabled=!ns.length; UI.el.nameTableBody.replaceChildren(); let fg=document.createDocumentFragment(); ns.forEach(n=>{let tr=document.createElement("tr"), td=document.createElement("td"); td.className="mono"; td.textContent=n; td.title="Klik untuk copy"; tr.appendChild(td); fg.appendChild(tr);}); UI.el.nameTableBody.appendChild(fg); }
  static selectRange() { let f=parseInt(UI.el.rangeFromInput.value), t=parseInt(UI.el.rangeToInput.value), m=AppState.lines.length?Math.max(...AppState.lines.map(l=>l.line_num)):0; if(isNaN(f)||isNaN(t)||f>t||f<1||f>m||t>m) return alert("Range tidak valid."); AppState.selectedLines.clear(); for(let i=f; i<=t; i++) { let l=AppState.lineByNum.get(i); if(l&&!AppState.isTranslated(l)) AppState.selectedLines.add(i); } AppController.syncCheckboxes(); let idx=AppState.displayRows.findIndex(r=>r.type==="line"&&r.line.line_num===f); if(idx!==-1) { AppController.mainScroller.scrollToIndex(idx); setTimeout(()=>{ let re=UI.el.previewContainer.querySelector(`input[data-num="${f}"]`)?.closest('.preview-row'); if(re) { let bg=re.style.backgroundColor; re.style.transition="background-color .3s ease"; re.style.backgroundColor="rgba(59, 130, 246, 0.4)"; setTimeout(()=>re.style.backgroundColor=bg,CFG.DELAY_HL); } },50); } }

  static async copyForAi() {
    let out=[], sel=AppState.lines.filter(l=>AppState.selectedLines.has(l.line_num)); 
    sel.forEach(l => {
      if(l.name) out.push([l.line_num, l.name, l.message]);
      else out.push([l.line_num, l.message]);
    });
    
    let p = AppState.aiPromptEnabled ? `${AppState.aiInstructionHeader.trim()}\n\n` : "";
    let uV = AppState.vndbEnabled && AppState.vndbGlossary?.length, uC = AppState.customEnabled && AppState.customGlossary?.length;
    if(uV||uC) { 
      p+=`<glossary>\n`; 
      if(uV) AppState.vndbGlossary.forEach(g=>p+=`${g[0]}: ${g[1]}\n`); 
      if(uC) AppState.customGlossary.forEach(g=>p+=`${g[0]}: ${g[1]}\n`); 
      p+=`</glossary>\n\n`; 
    }
    
    if(AppState.contextEnabled && AppState.selectedLines.size) { 
      let mn=Math.min(...Array.from(AppState.selectedLines)), cx=AppState.lines.filter(l=>l.line_num<mn && AppState.isTranslated(l)).sort((a,b)=>b.line_num-a.line_num).slice(0,AppState.contextSize).reverse(); 
      if(cx.length) { 
        let ctxArr = [];
        cx.forEach(l => {
          let tn = l.trans_name || l.name;
          if(tn) ctxArr.push([l.line_num, tn, l.trans_message]);
          else ctxArr.push([l.line_num, l.trans_message]);
        });
        p+=`<context>\n[\n  ${ctxArr.map(item => JSON.stringify(item)).join(",\n  ")}\n]\n</context>\n\n`; 
      } 
    }
    
    p += `[\n  ${out.map(item => JSON.stringify(item)).join(",\n  ")}\n]\n`;
    
    try { await navigator.clipboard.writeText(p); UI.flashMessage(`Disalin ${sel.length} baris.`); } 
    catch(e) { UI.el.pasteArea.value=p; alert("Clipboard diblokir. Teks dipindah ke kolom 'Paste hasil AI'."); }
  }

  static applyTranslation() {
    if(!AppState.lines.length) return;
    
    let rawTxt = UI.el.pasteArea.value.trim();
    let startIdx = rawTxt.indexOf('[');
    let endIdx = rawTxt.lastIndexOf(']');
    
    if(startIdx === -1 || endIdx === -1) return alert("Gagal: Format array JSON ([...]) tidak ditemukan.");
    let jsonStr = rawTxt.substring(startIdx, endIdx + 1);
    
    let parsedData;
    try { parsedData = JSON.parse(jsonStr); } 
    catch(e) { return alert("Gagal membaca struktur JSON: " + e.message); }
    
    if(!Array.isArray(parsedData)) return alert("Gagal: Format utama bukan array.");
    
    let ps = [], errs = [], sn = new Set();
    parsedData.forEach((item, i) => {
      if(!Array.isArray(item)) return errs.push(`[Index ${i}] Bukan array.`);
      if(item.length !== 2 && item.length !== 3) return errs.push(`[Index ${i}] Format salah (Harus 2 atau 3 elemen).`);
      
      let num = item[0];
      if(typeof num !== 'number') return errs.push(`[Index ${i}] ID bukan angka.`);
      if(sn.has(num)) return errs.push(`[Baris ${num}] Terdapat duplikat ID.`);
      sn.add(num);
      
      let name = item.length === 3 ? item[1] : null;
      let msg = item.length === 3 ? item[2] : item[1];
      
      if(name !== null && typeof name !== 'string') return errs.push(`[Baris ${num}] Nama bukan string.`);
      if(typeof msg !== 'string') return errs.push(`[Baris ${num}] Pesan bukan string.`);
      
      ps.push({ num, name: name ? name.trim() : null, msg: msg.trim() });
    });
    
    if(!ps.length && !errs.length) return alert("Data JSON kosong.");
    if(ps.length !== AppState.selectedLines.size) errs.push(`Jumlah hasil (${ps.length}) tidak sesuai seleksi (${AppState.selectedLines.size}).`);
    
    AppState.selectedLines.forEach(n => { if(!sn.has(n)) errs.push(`[Baris ${n}] Terlewat / Hilang.`); });
    sn.forEach(n => { if(!AppState.selectedLines.has(n)) errs.push(`[Baris ${n}] Tidak dicentang di awal.`); });
    
    let upds = [];
    ps.forEach(it => {
      let l = AppState.lineByNum.get(it.num);
      if(!l) return errs.push(`[Baris ${it.num}] Tidak ada di file project.`);
      
      if(AppState.ignoreNameTranslation && l.name) it.name = l.name;
      
      let oN = !!(l.name || "").trim(), tN = !!(it.name || "").trim();
      if(oN && !tN) errs.push(`[Baris ${it.num}] Nama karakter hilang.`); 
      else if(!oN && tN) errs.push(`[Baris ${it.num}] Tiba-tiba ada nama karakter.`); 
      else if(!it.msg) errs.push(`[Baris ${it.num}] Pesan teks kosong.`); 
      else upds.push({l, it});
    });
    
    if(errs.length) return alert("DITOLAK:\n" + errs.slice(0, 10).join("\n") + (errs.length > 10 ? `\n... (+${errs.length - 10} lain)` : ""));
    
    AppState.undoSnapshot = {lines: JSON.parse(JSON.stringify(AppState.lines)), selected: new Set(AppState.selectedLines)}; 
    AppState.redoSnapshot = null;
    
    upds.forEach(({l, it}) => { 
      l.trans_message = it.msg; 
      l.is_translated = true; 
      if(it.name) l.trans_name = AppState.ignoreNameTranslation ? null : it.name; 
      AppState.selectedLines.delete(l.line_num); 
    });
    
    UI.el.pasteArea.value = ""; 
    AppController.refreshWorkspace(); 
    AppState.queueAutoSave(); 
    UI.flashMessage(`${upds.length} baris sukses diterapkan.`);
  }

  static undoTranslation() { if(!AppState.undoSnapshot) return; AppState.redoSnapshot={lines:JSON.parse(JSON.stringify(AppState.lines)), selected:new Set(AppState.selectedLines)}; AppState.lines=AppState.undoSnapshot.lines.map(AppState.normalizeLine); AppState.selectedLines=new Set(AppState.undoSnapshot.selected); AppState.undoSnapshot=null; AppController.refreshWorkspace(); AppState.queueAutoSave(); }
  static redoTranslation() { if(!AppState.redoSnapshot) return; AppState.undoSnapshot={lines:JSON.parse(JSON.stringify(AppState.lines)), selected:new Set(AppState.selectedLines)}; AppState.lines=AppState.redoSnapshot.lines.map(AppState.normalizeLine); AppState.selectedLines=new Set(AppState.redoSnapshot.selected); AppState.redoSnapshot=null; AppController.refreshWorkspace(); AppState.queueAutoSave(); }
  static openLineEditor(num) { let l=AppState.lineByNum.get(num); if(!l) return; AppController.activeEditorLineNum=num; UI.el.lineEditorTitle.textContent=`Edit Baris ${num}`; UI.el.lineOriginalView.value=l.name?`${l.name}: ${l.message}`:l.message; UI.el.lineNameWrap.style.display=l.name?"block":"none"; UI.el.lineNameInput.value=l.name?(l.trans_name||""):""; if(l.name) UI.el.lineNameInput.placeholder=l.name; UI.el.lineMessageInput.value=(l.trans_message||"").trim(); UI.el.lineTranslatedCheck.checked=AppState.isTranslated(l); UI.toggleModal(UI.el.lineEditorModal,true); }
  static saveLineEditor() { let l=AppState.lineByNum.get(AppController.activeEditorLineNum); if(!l) return; let m=UI.el.lineMessageInput.value.trim().replace(/\r?\n/g,"\\n"); if(UI.el.lineTranslatedCheck.checked&&!m) return alert("Pesan kosong."); l.trans_message=m||null; l.is_translated=!!(UI.el.lineTranslatedCheck.checked&&m); if(l.name) l.trans_name=UI.el.lineNameInput.value.trim().replace(/\r?\n/g,"\\n")||null; AppState.redoSnapshot=null; UI.toggleModal(UI.el.lineEditorModal,false); AppController.refreshWorkspace(); if(UI.el.proofreadModal.classList.contains("open")) AppController.renderProofread(); AppState.queueAutoSave(); }

  static createHighlight(t, rx) {
    if(!rx) return document.createTextNode(t);
    let f=document.createDocumentFragment(), pts=t.split(rx);
    pts.forEach((p,i) => { if(i%2===1){let m=document.createElement("mark");m.className="highlight";m.textContent=p;f.appendChild(m);}else if(p) f.appendChild(document.createTextNode(p)); }); return f;
  }
  static openProofread() { UI.toggleModal(UI.el.proofreadModal,true); AppController.renderProofread(); }
  static renderProofread() {
    if(!UI.el.proofreadModal.classList.contains("open")) return;
    let q=UI.el.proofreadSearchInput.value, iR=UI.el.proofreadRegexCheck.checked, iC=UI.el.proofreadCaseCheck.checked, iE=UI.el.proofreadExactCheck.checked, oT=UI.el.proofreadTranslatedOnlyCheck.checked, sc=UI.el.proofreadScope.value, sRx=null; AppController.currentHighlightRegex=null;
    if(q) { try { let rStr=iR?q:q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); if(iE) rStr=`(?<![\\p{L}\\p{N}_])${rStr}(?![\\p{L}\\p{N}_])`; sRx=new RegExp(rStr,iC?"gu":"giu"); AppController.currentHighlightRegex=new RegExp(`(${rStr})`,iC?"gu":"giu"); } catch(e) {return;} }
    AppState.proofreadMatches = AppState.lines.filter(l => {
      if(oT && !AppState.isTranslated(l)) return false;
      let dN=l.name||"", fN=AppState.isTranslated(l)?(l.trans_name||"").trim()||l.name:null, tM=oT?l.trans_message:l.message, tN=oT?fN:dN;
      if(q&&sRx) { let m=false; sRx.lastIndex=0; if((sc==='all'||sc==='message')&&tM&&sRx.test(tM)) m=true; sRx.lastIndex=0; if(!m&&(sc==='all'||sc==='name')&&tN&&sRx.test(tN)) m=true; if(!m) return false; }
      return true;
    }).map(l => ({num:l.line_num, file:l.file, origName:l.name||"", origMsg:l.message, transName:AppState.isTranslated(l)?(l.trans_name||"").trim()||l.name:null, transMsg:l.trans_message, isTrans:AppState.isTranslated(l)}));
    UI.el.proofreadStatus.textContent=`Ditemukan ${AppState.proofreadMatches.length} baris.`; AppController.proofreadScroller.setItems(AppState.proofreadMatches);
  }
  static createProofreadRow() { let r=document.createElement("div"); r.className="preview-row"; let w=document.createElement("div"); w.className="text-content"; let m=document.createElement("div"); m.className="file-meta"; let o=document.createElement("div"); o.className="original"; let t=document.createElement("div"); t.className="translated"; w.append(m,o,t); r.append(w); r._wrap=w; r._meta=m; r._orig=o; r._trans=t; return r; }
  static updateProofreadRow(r, d) {
    r._wrap.dataset.num=d.num; r._meta.textContent=`File: ${d.file} | Baris: ${d.num}`; r._orig.replaceChildren(); r._trans.replaceChildren();
    let oT=UI.el.proofreadTranslatedOnlyCheck.checked, sc=UI.el.proofreadScope.value, bld=(n,m,hl)=>{let f=document.createDocumentFragment();if(n){if(hl&&(sc==='all'||sc==='name'))f.appendChild(AppController.createHighlight(n,AppController.currentHighlightRegex));else f.appendChild(document.createTextNode(n));f.appendChild(document.createTextNode(": "));}if(hl&&(sc==='all'||sc==='message'))f.appendChild(AppController.createHighlight(m,AppController.currentHighlightRegex));else f.appendChild(document.createTextNode(m));return f;};
    if(!d.isTrans) r._trans.classList.add("cell-muted"); else r._trans.classList.remove("cell-muted");
    if(oT) { r._orig.textContent=d.origName?`${d.origName}: ${d.origMsg}`:d.origMsg; if(d.isTrans) r._trans.appendChild(bld(d.transName,d.transMsg,true)); else r._trans.textContent="——"; }
    else { r._orig.appendChild(bld(d.origName,d.origMsg,true)); if(d.isTrans) r._trans.textContent=d.transName?`${d.transName}: ${d.transMsg}`:d.transMsg; else r._trans.textContent="——"; }
  }
  static execReplaceAll() {
    let q=UI.el.proofreadSearchInput.value, rpText=UI.el.proofreadReplaceInput.value; if(!q) return alert("Pencarian kosong!"); let rx;
    try { let rs=UI.el.proofreadRegexCheck.checked?q:q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); if(UI.el.proofreadExactCheck.checked) rs=`(?<![\\p{L}\\p{N}_])${rs}(?![\\p{L}\\p{N}_])`; rx=new RegExp(rs,UI.el.proofreadCaseCheck.checked?'gu':'giu'); } catch(e) { return alert("Regex tidak valid."); }
    let c=0; AppState.undoSnapshot={lines:JSON.parse(JSON.stringify(AppState.lines)), selected:new Set(AppState.selectedLines)}; AppState.redoSnapshot=null;
    let oT=UI.el.proofreadTranslatedOnlyCheck.checked, sc=UI.el.proofreadScope.value;
    AppState.lines.forEach(l => {
      if(oT&&!AppState.isTranslated(l)) return; let isReplaced=false, tM=oT?'trans_message':'message', tN=oT?'trans_name':'name';
      if((sc==='all'||sc==='message')&&l[tM]){ let nv=l[tM].replace(rx,rpText); if(nv!==l[tM]) { l[tM]=nv; isReplaced=true; } }
      if((sc==='all'||sc==='name')&&l[tN]){ let nv=l[tN].replace(rx,rpText); if(nv!==l[tN]) { l[tN]=nv; isReplaced=true; } } if(isReplaced) c++;
    });
    if(c) { AppController.refreshWorkspace(); AppController.renderProofread(); AppState.queueAutoSave(); alert(`Berhasil replace ${c} baris.`); } else alert(`Tidak ada yang cocok.`);
  }
}
document.addEventListener("DOMContentLoaded", AppController.init);