const DEFAULT_PROMPT = `Rewrite entire text to Native Indonesian. Euphemism prohibited. Onomatopoeia must be in English-based. Bahasa Jakarta Selatan is prohibited. Format: <ID n="Name">Message</ID> or <2>Message without name</2>.`;

class Utils {
  static escapeHtml(text) {
    return String(text == null ? "" : text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  static getTrigrams(text) {
    let set = new Set();
    if (!text) return set;
    if (text.length < 3) {
      set.add(text);
      return set;
    }
    for (let i = 0; i <= text.length - 3; i++) {
      set.add(text.substring(i, i + 3));
    }
    return set;
  }

  static extractMetadata(projectData) {
    const { lines, proofreadScope, proofreadRegex, proofreadCaseSensitive, proofreadExactMatch, proofreadTranslatedOnly, ...metadata } = projectData;
    return metadata;
  }
}

class UI {
  static elements = {};
  static hintTokenCounter = 0;

  static cacheElements() {
    document.querySelectorAll('[id]').forEach(element => {
      UI.elements[element.id] = element;
    });
  }

  static toggleModalVisibility(element, showModal) {
    if (showModal) {
      element.classList.remove("closing");
      element.classList.add("open");
    } else {
      element.classList.add("closing");
      element.classList.remove("open");
      setTimeout(() => element.classList.remove("closing"), 220);
    }
  }

  static flashStatusMessage(messageText, keepAlive = false) {
    UI.elements.copyStatus.textContent = messageText;
    UI.elements.copyStatus.classList.remove("empty");
    let currentToken = ++UI.hintTokenCounter;
    if (!keepAlive) {
      setTimeout(() => {
        if (UI.hintTokenCounter === currentToken) {
          UI.elements.copyStatus.classList.add("empty");
        }
      }, 3000);
    }
  }

  static createDomNode(tagName, className, attributesObject = {}) {
    let domNode = document.createElement(tagName);
    if (className) {
      domNode.className = className;
    }
    for (let attributeKey in attributesObject) {
      domNode[attributeKey] = attributesObject[attributeKey];
    }
    return domNode;
  }
}

class StorageManager {
  static async getRootDirectory() {
    return await navigator.storage.getDirectory();
  }

  static async saveProjectData(projectId, projectData) {
    try {
      projectData.updatedAt = Date.now();
      let rootDirectory = await StorageManager.getRootDirectory();
      let fileHandle = await rootDirectory.getFileHandle(projectId, { create: true });
      let writableStream = await fileHandle.createWritable();
      await writableStream.write(JSON.stringify(projectData));
      await writableStream.close();
    } catch (error) {
      UI.flashStatusMessage("Gagal menyimpan ke storage!");
    }
  }

  static async fetchAllProjects() {
    let rootDirectory = await StorageManager.getRootDirectory();
    let projectsList = [];
    for await (let [fileName, fileHandle] of rootDirectory.entries()) {
      if (fileName.endsWith(".cstl") && fileHandle.kind === 'file') {
        try {
          let fileObject = await fileHandle.getFile();
          let projectData = JSON.parse(await fileObject.text());
          projectsList.push({
            id: fileName,
            name: projectData.projectName || fileName.replace(".cstl", ''),
            updatedAt: projectData.updatedAt || fileObject.lastModified,
            fileCount: projectData.imported_files?.length || 0,
            lineCount: projectData.lines?.length || 0,
            data: projectData
          });
        } catch (error) {}
      }
    }
    return projectsList.sort((projectA, projectB) => projectB.updatedAt - projectA.updatedAt);
  }

  static async removeProjectData(projectId, epubIdentifier) {
    let rootDirectory = await StorageManager.getRootDirectory();
    if (epubIdentifier) {
      try {
        await rootDirectory.removeEntry(epubIdentifier);
      } catch (error) {}
    }
    await rootDirectory.removeEntry(projectId);
  }
}

class AppState {
  static currentProjectId = null;
  static projectName = "";
  static projectType = "uninitialized";
  static epubTags = "p";
  static epubSourceId = null;
  static lines = [];
  static importedFiles = [];
  static aiInstructionHeader = DEFAULT_PROMPT;
  static ignoreNameTranslation = false;
  static aiPromptEnabled = true;
  static referenceEnabled = false;
  static vndbEnabled = false;
  static vndbId = "";
  static vndbGlossary = [];
  static customEnabled = false;
  static customRaw = "";
  static customGlossary = [];
  static jumpToContext = false;
  static proofreadScope = "all";
  static proofreadRegex = false;
  static proofreadCaseSensitive = false;
  static proofreadExactMatch = false;
  static proofreadTranslatedOnly = true;
  static undoSnapshot = null;
  static redoSnapshot = null;
  static selectedLines = new Set();
  static displayRows = [];
  static lineByNum = new Map();
  static filesLinesCache = new Map();
  static proofreadMatches = [];
  static saveTimeout = null;
  static translatedCount = 0;
  static namesDirty = true;

  static toProjectData() {
    return {
      version: 10,
      projectName: AppState.projectName,
      projectType: AppState.projectType,
      epubTags: AppState.epubTags,
      epubSourceId: AppState.epubSourceId,
      imported_files: AppState.importedFiles,
      lines: AppState.lines,
      prompt_header: AppState.aiInstructionHeader,
      ignoreNameTranslation: AppState.ignoreNameTranslation,
      promptEnabled: AppState.aiPromptEnabled,
      referenceEnabled: AppState.referenceEnabled,
      vndbEnabled: AppState.vndbEnabled,
      vndbId: AppState.vndbId,
      vndbGlossary: AppState.vndbGlossary,
      customEnabled: AppState.customEnabled,
      customRaw: AppState.customRaw,
      customGlossary: AppState.customGlossary,
      jumpToContext: AppState.jumpToContext,
      proofreadScope: AppState.proofreadScope,
      proofreadRegex: AppState.proofreadRegex,
      proofreadCaseSensitive: AppState.proofreadCaseSensitive,
      proofreadExactMatch: AppState.proofreadExactMatch,
      proofreadTranslatedOnly: AppState.proofreadTranslatedOnly
    };
  }

  static isTranslated(lineData) {
    return !!lineData.is_translated;
  }

  static normalizeLine(lineData) {
    return {
      line_num: Number(lineData.line_num),
      file: String(lineData.file),
      name: lineData.name == null ? null : String(lineData.name).replace(/\r?\n/g, "\\n").trim(),
      message: String(lineData.message || "").replace(/\r?\n/g, "\\n").trim(),
      trans_name: lineData.trans_name == null ? null : String(lineData.trans_name).replace(/\r?\n/g, "\\n").trim(),
      trans_message: lineData.trans_message == null ? null : String(lineData.trans_message).replace(/\r?\n/g, "\\n").trim(),
      is_translated: Boolean(lineData.is_translated)
    };
  }

  static updateTranslatedCount() {
    AppState.translatedCount = AppState.lines.filter(lineData => lineData.is_translated).length;
  }

  static rebuildCache() {
    AppState.lineByNum.clear();
    AppState.filesLinesCache.clear();
    AppState.displayRows = [];
    
    let groupedFiles = new Map(AppState.importedFiles.map(fileName => [fileName, []]));
    AppState.lines.forEach(lineData => {
      AppState.lineByNum.set(lineData.line_num, lineData);
      if (groupedFiles.has(lineData.file)) {
        groupedFiles.get(lineData.file).push(lineData);
      }
    });
    
    for (let [fileName, fileRows] of groupedFiles.entries()) {
      AppState.filesLinesCache.set(fileName, fileRows);
      if (fileRows.length) {
        AppState.displayRows.push({ type: "separator", file: fileName });
        fileRows.forEach(lineData => AppState.displayRows.push({ type: "line", line: lineData }));
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
    }, 500);
  }

  static async executeAutoSave() {
    await StorageManager.saveProjectData(AppState.currentProjectId, AppState.toProjectData());
    UI.elements.statusBar.textContent = UI.elements.statusBar.textContent.replace(" | Tersimpan!", "") + " | Tersimpan!";
    setTimeout(AppController.updateStatusBar, 2000);
  }
}

class VirtualScroller {
  constructor(viewportElement, containerElement, createRowFunction, updateRowFunction) {
    this.viewportElement = viewportElement;
    this.containerElement = containerElement;
    this.createRowFunction = createRowFunction;
    this.updateRowFunction = updateRowFunction;
    this.itemsArray = [];
    this.rowHeights = [];
    this.rowPositions = [];
    this.domElementsArray = [];
    this.defaultRowHeight = 80;
    this.currentScrollTop = 0;
    this._scrollTimer = null;

    this.viewportElement.addEventListener('scroll', () => {
      window.requestAnimationFrame(() => this.onScrollEvent());
    }, { passive: true });
  }

  setItems(itemsArray, keepState = false) {
    this.itemsArray = itemsArray;
    if (!keepState || this.rowHeights.length !== itemsArray.length) {
      this.rowHeights = new Float32Array(itemsArray.length).fill(this.defaultRowHeight);
      this.rowPositions = new Float32Array(itemsArray.length);
      this.updatePositions();
      this.currentScrollTop = 0;
      this.viewportElement.scrollTop = 0;
    } else {
      this.updatePositions();
      this.currentScrollTop = this.viewportElement.scrollTop;
    }
    this.render();
  }

  updatePositions() {
    let currentPosition = 8;
    for (let itemIndex = 0; itemIndex < this.itemsArray.length; itemIndex++) {
      this.rowPositions[itemIndex] = currentPosition;
      currentPosition += this.rowHeights[itemIndex];
    }
    this.containerElement.style.height = `${currentPosition + 8}px`;
  }

  onScrollEvent() {
    this.currentScrollTop = this.viewportElement.scrollTop;
    this.render();
  }

  findStartIndex() {
    let leftIndex = 0;
    let rightIndex = this.itemsArray.length - 1;
    while (leftIndex <= rightIndex) {
      let midIndex = Math.floor((leftIndex + rightIndex) / 2);
      if (this.rowPositions[midIndex] <= this.currentScrollTop && this.rowPositions[midIndex] + this.rowHeights[midIndex] > this.currentScrollTop) {
        return midIndex;
      }
      if (this.rowPositions[midIndex] < this.currentScrollTop) {
        leftIndex = midIndex + 1;
      } else {
        rightIndex = midIndex - 1;
      }
    }
    return Math.max(0, Math.min(leftIndex, this.itemsArray.length - 1));
  }

  render() {
    if (!this.itemsArray.length) {
      this.domElementsArray.forEach(element => element.style.transform = 'translateY(-9999px)');
      this.containerElement.style.height = '0px';
      return;
    }

    let viewportHeight = this.viewportElement.clientHeight || 800;
    if (viewportHeight === 0) viewportHeight = 800;
    let startIndex = Math.max(0, this.findStartIndex() - 4);
    let endIndex = startIndex;
    let visibleHeight = 0;

    while (endIndex < this.itemsArray.length && visibleHeight < viewportHeight + (this.defaultRowHeight * 8)) {
      visibleHeight += this.rowHeights[endIndex];
      endIndex++;
    }

    let requiredElements = Math.min(endIndex - startIndex, 100);

    while (this.domElementsArray.length < requiredElements) {
      let newElement = this.createRowFunction();
      newElement.style.transform = 'translateY(-9999px)';
      this.domElementsArray.push(newElement);
      this.containerElement.appendChild(newElement);
    }

    for (let elementIndex = 0; elementIndex < requiredElements; elementIndex++) {
      let dataIndex = startIndex + elementIndex;
      this.updateRowFunction(this.domElementsArray[elementIndex], this.itemsArray[dataIndex], dataIndex);
    }

    let measuredHeights = new Array(requiredElements);
    for (let elementIndex = 0; elementIndex < requiredElements; elementIndex++) {
      measuredHeights[elementIndex] = this.domElementsArray[elementIndex].offsetHeight;
    }

    let heightsChanged = false;
    let scrollAdjustment = 0;
    for (let elementIndex = 0; elementIndex < requiredElements; elementIndex++) {
      let dataIndex = startIndex + elementIndex;
      let currentHeight = measuredHeights[elementIndex];
      if (currentHeight > 0 && Math.abs((currentHeight + 8) - this.rowHeights[dataIndex]) > 1) {
        let heightDifference = (currentHeight + 8) - this.rowHeights[dataIndex];
        this.rowHeights[dataIndex] = currentHeight + 8;
        heightsChanged = true;
        if (this.rowPositions[dataIndex] < this.currentScrollTop) {
          scrollAdjustment += heightDifference;
        }
      }
    }

    if (heightsChanged) {
      this.updatePositions();
      if (scrollAdjustment !== 0) {
        this.viewportElement.scrollTop += scrollAdjustment;
        this.currentScrollTop = this.viewportElement.scrollTop;
      }
    }

    for (let elementIndex = 0; elementIndex < requiredElements; elementIndex++) {
      let dataIndex = startIndex + elementIndex;
      this.domElementsArray[elementIndex].style.transform = `translateY(${this.rowPositions[dataIndex]}px)`;
    }

    for (let elementIndex = requiredElements; elementIndex < this.domElementsArray.length; elementIndex++) {
      this.domElementsArray[elementIndex].style.transform = 'translateY(-9999px)';
    }
  }

  scrollToIndex(targetIndex) {
    if (targetIndex < 0 || targetIndex >= this.itemsArray.length) return;
    if (this._scrollTimer) {
      clearTimeout(this._scrollTimer);
      this._scrollTimer = null;
    }
    this.viewportElement.scrollTop = this.rowPositions[targetIndex] - (this.viewportElement.clientHeight / 2);
    this.currentScrollTop = this.viewportElement.scrollTop;
    this.render();
    this._scrollTimer = setTimeout(() => {
      this._scrollTimer = null;
      this.viewportElement.scrollTop = this.rowPositions[targetIndex] - (this.viewportElement.clientHeight / 2) + (this.rowHeights[targetIndex] / 2);
      this.currentScrollTop = this.viewportElement.scrollTop;
      this.render();
    }, 20);
  }

  forceUpdate() {
    this.render();
  }
}

class Importer {
  static decodeBuffer(bufferData) {
    let encodings = ["utf-8", "shift_jis", "windows-31j", "cp932"];
    for (let encodingFormat of encodings) {
      try {
        return new TextDecoder(encodingFormat, { fatal: true }).decode(bufferData);
      } catch (error) {}
    }
    return new TextDecoder("utf-8").decode(bufferData);
  }

  static getBaseName(filePath) {
    return String(filePath || "").replace(/\\/g, "/").split("/").pop().replace(/\.json$/i, "");
  }

  static parseJsonData(jsonArray, fileName, startLineNum) {
    if (!Array.isArray(jsonArray)) {
      throw new Error(`File ${fileName} bukan array JSON.`);
    }
    return jsonArray.filter(entry => entry && typeof entry === "object" && Object.hasOwn(entry, "message")).map(entry => ({
      line_num: startLineNum++,
      file: fileName,
      name: entry.name == null ? null : String(entry.name).replace(/\r?\n/g, "\\n").trim(),
      message: String(entry.message || "").replace(/\r?\n/g, "\\n").trim(),
      trans_name: null,
      trans_message: null,
      is_translated: false
    }));
  }

  static async processImport(filesObject, isZipArchive = false) {
    UI.flashStatusMessage("Memproses file...", true);
    document.body.style.cursor = "wait";
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    try {
      let currentLineNum = AppState.lines.length ? AppState.lines.reduce((maxId, lineData) => Math.max(maxId, lineData.line_num), 0) + 1 : 1;
      let importedLines = [];
      let existingFiles = new Set(AppState.importedFiles);
      let skippedFiles = [];

      if (isZipArchive && filesObject instanceof File && window.JSZip) {
        if (AppState.projectType !== "uninitialized" && AppState.projectType !== "json") {
          alert("Project ini sudah diatur sebagai project EPUB. Tidak bisa mencampur file JSON.");
          document.body.style.cursor = "default";
          UI.elements.copyStatus.classList.add("empty");
          return;
        }
        if (AppState.projectType === "uninitialized") {
          AppState.projectType = "json";
        }
        let zipArchive = new window.JSZip();
        await zipArchive.loadAsync(filesObject);
        for (let zipFileName of Object.keys(zipArchive.files).filter(fileName => fileName.endsWith(".json")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))) {
          let baseName = Importer.getBaseName(zipFileName);
          if (existingFiles.has(baseName)) {
            skippedFiles.push(baseName);
            continue;
          }
          let jsonContent = JSON.parse(Importer.decodeBuffer(await zipArchive.file(zipFileName).async("uint8array")));
          let parsedLines = Importer.parseJsonData(jsonContent, baseName, currentLineNum);
          if (parsedLines.length) {
            existingFiles.add(baseName);
            importedLines.push(...parsedLines);
            currentLineNum += parsedLines.length;
          }
        }
      } else {
        for (let uploadedFile of Array.from(filesObject).sort((fileA, fileB) => fileA.name.localeCompare(fileB.name, undefined, { numeric: true, sensitivity: "base" }))) {
          if (uploadedFile.name.toLowerCase().endsWith(".epub")) {
            if (AppState.projectType !== "uninitialized" && AppState.projectType !== "epub") {
              alert("Project ini sudah memuat file JSON. Tidak bisa mencampur file EPUB.");
              continue;
            }
            if (AppState.projectType === "epub" && AppState.epubSourceId) {
              alert("Project ini sudah memuat EPUB.");
              continue;
            }
            if (AppState.projectType === "uninitialized") {
              AppState.projectType = "epub";
              AppState.epubSourceId = "epub_" + Date.now() + ".epub";
            }
            let rootDirectory = await StorageManager.getRootDirectory();
            let fileHandle = await rootDirectory.getFileHandle(AppState.epubSourceId, { create: true });
            let writableStream = await fileHandle.createWritable();
            await writableStream.write(uploadedFile);
            await writableStream.close();

            let zipArchive = new window.JSZip();
            await zipArchive.loadAsync(uploadedFile);
            let containerXmlContent = await zipArchive.file("META-INF/container.xml").async("text");
            let rootFileNode = new DOMParser().parseFromString(containerXmlContent, "application/xml").querySelector("rootfile");
            if (!rootFileNode) throw new Error("EPUB tidak valid.");
            
            let opfPathString = decodeURIComponent(rootFileNode.getAttribute("full-path"));
            let opfDirectoryPath = opfPathString.includes("/") ? opfPathString.substring(0, opfPathString.lastIndexOf("/")) + "/" : "";
            let opfDocumentNode = new DOMParser().parseFromString(await zipArchive.file(opfPathString).async("text"), "application/xml");
            let manifestDict = {};

            Array.from(opfDocumentNode.querySelectorAll("manifest > item")).forEach(manifestItem => {
              manifestDict[manifestItem.getAttribute("id")] = decodeURIComponent(manifestItem.getAttribute("href"));
            });

            let htmlFilePaths = Array.from(opfDocumentNode.querySelectorAll("spine > itemref")).map(spineItem => manifestDict[spineItem.getAttribute("idref")] ? opfDirectoryPath + manifestDict[spineItem.getAttribute("idref")] : null).filter(Boolean);
            let targetTags = AppState.epubTags || "p";

            for (let htmlFilePath of htmlFilePaths) {
              if (existingFiles.has(htmlFilePath)) {
                skippedFiles.push(htmlFilePath);
                continue;
              }
              let fileEntryItem = zipArchive.file(htmlFilePath);
              if (!fileEntryItem) continue;

              let parsedDocument = new DOMParser().parseFromString(await fileEntryItem.async("text"), htmlFilePath.endsWith('.xhtml') ? "application/xhtml+xml" : "text/html");
              let hasContentFlag = false;

              Array.from(parsedDocument.querySelectorAll(targetTags)).forEach(htmlElement => {
                let extractedText = htmlElement.textContent.replace(/\r?\n/g, " ").trim();
                if (extractedText) {
                  importedLines.push({
                    line_num: currentLineNum++,
                    file: htmlFilePath,
                    name: null,
                    message: extractedText,
                    trans_name: null,
                    trans_message: null,
                    is_translated: false
                  });
                  hasContentFlag = true;
                }
              });
              if (hasContentFlag) existingFiles.add(htmlFilePath);
            }
          } else if (uploadedFile.name.toLowerCase().endsWith(".json")) {
            if (AppState.projectType !== "uninitialized" && AppState.projectType !== "json") {
              alert("Project ini sudah memuat file EPUB. Tidak bisa mencampur file JSON.");
              continue;
            }
            if (AppState.projectType === "uninitialized") {
              AppState.projectType = "json";
            }
            let baseName = Importer.getBaseName(uploadedFile.name);
            if (existingFiles.has(baseName)) {
              skippedFiles.push(baseName);
              continue;
            }
            let parsedLines = Importer.parseJsonData(JSON.parse(Importer.decodeBuffer(await uploadedFile.arrayBuffer())), baseName, currentLineNum);
            if (parsedLines.length) {
              existingFiles.add(baseName);
              importedLines.push(...parsedLines);
              currentLineNum += parsedLines.length;
            }
          }
        }
      }

      if (importedLines.length) {
        AppState.lines.push(...importedLines);
        AppState.importedFiles = Array.from(existingFiles);
        AppState.namesDirty = true;
        AppController.refreshWorkspace(true);
        AppState.queueAutoSave();
        UI.flashStatusMessage(`Berhasil impor ${importedLines.length} baris.${skippedFiles.length ? ` (${skippedFiles.length} file duplikat diabaikan)` : ""}`);
      } else if (skippedFiles.length) {
        UI.elements.copyStatus.classList.add("empty");
        setTimeout(() => alert(`Gagal impor: File duplikat.\n- ${skippedFiles.slice(0, 5).join('\n- ')}`), 10);
      } else {
        UI.flashStatusMessage("Tidak ada data valid.", false);
      }
    } catch (error) {
      UI.elements.copyStatus.classList.add("empty");
      setTimeout(() => alert(`Error:\n${error.message}`), 10);
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
        UI.flashStatusMessage("Membuat EPUB...", true);
        document.body.style.cursor = "wait";
        let rootDirectory = await StorageManager.getRootDirectory();
        let fileHandle = await rootDirectory.getFileHandle(AppState.epubSourceId);
        let epubFileObject = await fileHandle.getFile();
        let zipArchive = new window.JSZip();
        await zipArchive.loadAsync(epubFileObject);

        let linesByFileDict = {};
        AppState.lines.forEach(lineData => {
          if (!linesByFileDict[lineData.file]) linesByFileDict[lineData.file] = [];
          linesByFileDict[lineData.file].push(lineData);
        });

        let targetTags = AppState.epubTags || "p";

        for (let [htmlFilePath, fileLinesArray] of Object.entries(linesByFileDict)) {
          let zipFileEntry = zipArchive.file(htmlFilePath);
          if (!zipFileEntry) continue;

          let htmlTextContent = await zipFileEntry.async("text");
          let xmlMatchResult = htmlTextContent.match(/^<\?xml.*?\?>/i);
          let parsedHtmlDocument = new DOMParser().parseFromString(htmlTextContent, htmlFilePath.endsWith('.xhtml') ? "application/xhtml+xml" : "text/html");
          let lineIndex = 0;

          Array.from(parsedHtmlDocument.querySelectorAll(targetTags)).forEach(htmlElement => {
            if (htmlElement.textContent.replace(/\r?\n/g, " ").trim() === "") return;
            let lineData = fileLinesArray[lineIndex++];
            if (lineData && lineData.is_translated && lineData.trans_message) {
              htmlElement.textContent = lineData.trans_message;
            }
          });

          let newHtmlContent = new XMLSerializer().serializeToString(parsedHtmlDocument);
          if (xmlMatchResult && !newHtmlContent.startsWith("<?xml")) {
            newHtmlContent = xmlMatchResult[0] + "\n" + newHtmlContent;
          }
          zipArchive.file(htmlFilePath, newHtmlContent);
        }

        if (zipArchive.file("mimetype")) {
          zipArchive.file("mimetype", await zipArchive.file("mimetype").async("text"), { compression: "STORE" });
        }

        let blobUrl = URL.createObjectURL(await zipArchive.generateAsync({ type: "blob", mimeType: "application/epub+zip", compression: "DEFLATE", compressionOptions: { level: 9 } }));
        let downloadAnchor = UI.createDomNode("a", null, { href: blobUrl, download: `${AppState.projectName.replace(/[^\p{L}\p{N}_\-\.]/gu, '_')}_tl.epub` });
        downloadAnchor.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        UI.flashStatusMessage("Ekspor EPUB berhasil!");
      } catch (error) {
        alert("Ekspor EPUB gagal: " + error.message);
      } finally {
        document.body.style.cursor = "default";
      }
    } else {
      let groupedLinesMap = new Map();
      AppState.lines.forEach(lineData => {
        if (!groupedLinesMap.has(lineData.file)) groupedLinesMap.set(lineData.file, []);
        groupedLinesMap.get(lineData.file).push(lineData);
      });

      let exportResults = Array.from(groupedLinesMap.entries()).map(([exportFileName, fileLinesArray]) => ({
        fileNameProperty: `${exportFileName.replace(/\.xhtml|\.html/g, '')}.json`,
        fileContentProperty: JSON.stringify(fileLinesArray.map(lineData => {
          let exportEntry = {};
          let characterName = AppState.isTranslated(lineData) ? (lineData.trans_name || lineData.name) : lineData.name;
          let characterMessage = AppState.isTranslated(lineData) ? lineData.trans_message : lineData.message;
          if (characterName != null) exportEntry.name = characterName.replace(/\\n/g, "\n");
          exportEntry.message = characterMessage != null ? characterMessage.replace(/\\n/g, "\n") : "";
          return exportEntry;
        }), null, 2)
      }));

      if (window.JSZip && exportResults.length > 1) {
        let zipArchive = new window.JSZip();
        exportResults.forEach(exportItem => zipArchive.file(exportItem.fileNameProperty, exportItem.fileContentProperty));
        let blobUrl = URL.createObjectURL(await zipArchive.generateAsync({ type: "blob", mimeType: "application/octet-stream", compression: "DEFLATE", compressionOptions: { level: 9 } }));
        let downloadAnchor = UI.createDomNode("a", null, { href: blobUrl, download: `${AppState.projectName.replace(/[^\p{L}\p{N}_\-\.]/gu, '_')}_export.zip` });
        downloadAnchor.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      } else {
        exportResults.forEach(exportItem => {
          let blobUrl = URL.createObjectURL(new Blob([exportItem.fileContentProperty], { type: "application/json" }));
          let downloadAnchor = UI.createDomNode("a", null, { href: blobUrl, download: exportItem.fileNameProperty });
          downloadAnchor.click();
          setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
        });
      }
    }
  }
}

class VndbService {
  static isJapanese(textString) {
    return /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF]/.test(textString);
  }

  static async fetchCharacters(vndbIdentifier) {
    let allCharactersList = [];
    let pageNumber = 1;
    let hasMorePages = true;

    while (hasMorePages) {
      let apiResponse = await fetch("https://api.vndb.org/kana/character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: ["vn", "=", ["id", "=", vndbIdentifier]],
          fields: "name, original, aliases",
          results: 100,
          page: pageNumber
        })
      });
      if (!apiResponse.ok) throw new Error(`Status: ${apiResponse.status}`);
      let responseData = await apiResponse.json();
      if (responseData.results) allCharactersList.push(...responseData.results);
      hasMorePages = responseData.more || false;
      pageNumber++;
    }
    return allCharactersList;
  }

  static buildGlossary(charactersArray) {
    let glossaryMap = new Map();
    let addGlossaryEntry = (japaneseText, romajiText) => {
      japaneseText = (japaneseText || "").trim();
      romajiText = (romajiText || "").trim();
      if (japaneseText && romajiText && VndbService.isJapanese(japaneseText) && !glossaryMap.has(japaneseText)) {
        glossaryMap.set(japaneseText, romajiText);
      }
    };

    for (let characterItem of charactersArray) {
      if (!characterItem.name || !characterItem.original) continue;
      addGlossaryEntry(characterItem.original, characterItem.name);
      
      if (characterItem.original.includes(' ') && characterItem.name.includes(' ')) {
        let kanaParts = characterItem.original.split(' ');
        let romajiParts = characterItem.name.split(' ');
        if (kanaParts.length === romajiParts.length) {
          kanaParts.forEach((kanaWord, wordIndex) => addGlossaryEntry(kanaWord, romajiParts[wordIndex]));
        }
      }

      let japaneseAliases = (characterItem.aliases || []).filter(aliasItem => VndbService.isJapanese(aliasItem));
      let romajiAliases = (characterItem.aliases || []).filter(aliasItem => !VndbService.isJapanese(aliasItem));
      let fallbackName = characterItem.name.split(' ').pop() || characterItem.name;

      japaneseAliases.forEach((japaneseAlias, aliasIndex) => addGlossaryEntry(japaneseAlias, romajiAliases[aliasIndex] || fallbackName));
    }
    return Array.from(glossaryMap.entries()).sort((entryA, entryB) => entryB[0].length - entryA[0].length);
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
  static lastSearchQuery = "";

  static async createNewProject() {
    let newProjectName = prompt("Nama project baru:");
    if (!newProjectName?.trim()) return;
    newProjectName = newProjectName.trim();

    let newProjectId = "proj_" + Date.now() + ".cstl";
    let newProjectData = {
      version: 10,
      projectName: newProjectName,
      projectType: "uninitialized",
      epubTags: "p",
      epubSourceId: null,
      updatedAt: Date.now(),
      imported_files: [],
      lines: [],
      prompt_header: AppState.aiInstructionHeader,
      ignoreNameTranslation: false,
      promptEnabled: true,
      referenceEnabled: false,
      vndbEnabled: false,
      vndbId: "",
      vndbGlossary: [],
      customEnabled: false,
      customRaw: "",
      customGlossary: [],
      jumpToContext: false
    };

    await StorageManager.saveProjectData(newProjectId, newProjectData);
    AppController.openProject(newProjectId, newProjectData);
  }

  static async init() {
    UI.cacheElements();
    if (!navigator.storage?.getDirectory) {
      UI.elements.projectList.innerHTML = `<p class="hint" style="grid-column:1/-1;color:var(--danger);">Browser tidak mendukung OPFS.</p>`;
      return;
    }

    AppController.mainScroller = new VirtualScroller(UI.elements.previewViewport, UI.elements.previewContainer, AppController.createMainRow, AppController.updateMainRow);
    AppController.proofreadScroller = new VirtualScroller(UI.elements.proofreadContainer.closest('.proofread-results-wrap'), UI.elements.proofreadContainer, AppController.createProofreadRow, AppController.updateProofreadRow);
    
    AppController.bindEvents();
    await AppController.loadDashboard();
  }

  static throttle(targetFunction, delayMs = 200) {
    let timeoutTimer;
    return function(...functionArgs) {
      clearTimeout(timeoutTimer);
      timeoutTimer = setTimeout(() => targetFunction.apply(this, functionArgs), delayMs);
    };
  }

  static adjustToolbar() {
    let toolbarWrap = UI.elements.dynamicToolbarWrap;
    let actionButtons = UI.elements.actionButtons;
    let moreGroup = UI.elements.moreGroup;
    let moreDropdown = UI.elements.moreDropdown;

    if (!toolbarWrap || !actionButtons || !moreGroup || !moreDropdown) return;

    let toolbarItems = [UI.elements.importGroup, UI.elements.btnExport, UI.elements.btnProofread, UI.elements.btnGlossary, UI.elements.btnSettings];
    toolbarItems.forEach(toolbarElement => {
      if (toolbarElement) actionButtons.appendChild(toolbarElement);
    });
    moreGroup.style.display = 'none';

    if (actionButtons.scrollWidth > toolbarWrap.clientWidth) {
      moreGroup.style.display = 'inline-block';
      for (let itemIndex = toolbarItems.length - 1; itemIndex >= 0; itemIndex--) {
        if (actionButtons.scrollWidth > toolbarWrap.clientWidth && actionButtons.children.length > 0) {
          moreDropdown.insertBefore(toolbarItems[itemIndex], moreDropdown.firstChild);
        } else {
          break;
        }
      }
    }
  }

  static bindEvents() {
    window.addEventListener('resize', AppController.throttle(() => {
      if (UI.elements.workspaceView.style.display !== "none") AppController.adjustToolbar();
    }, 100));

    UI.elements.btnNewProject.addEventListener("click", AppController.createNewProject);
    UI.elements.btnBackToDashboard.addEventListener("click", AppController.closeProject);
    UI.elements.btnRestoreProject.addEventListener("click", () => UI.elements.restoreProjectInput.click());
    UI.elements.restoreProjectInput.addEventListener("change", AppController.restoreProject);

    document.addEventListener("click", clickEvent => {
      let isImportButton = clickEvent.target.closest('#btnImportMain');
      let isMoreButton = clickEvent.target.closest('#btnMore');

      if (isImportButton) {
        clickEvent.preventDefault();
        UI.elements.importDropdown?.classList.toggle("show");
      }
      if (isMoreButton) {
        clickEvent.preventDefault();
        UI.elements.moreDropdown?.classList.toggle("show");
      }
      if (!clickEvent.target.closest('#importGroup') && UI.elements.importDropdown) UI.elements.importDropdown.classList.remove("show");
      if (!clickEvent.target.closest('#moreGroup') && UI.elements.moreDropdown) UI.elements.moreDropdown.classList.remove("show");
    });

    ["btnImportFile", "btnImportFolder", "btnImportZip"].forEach((buttonId, index) => {
      let fileInputs = [UI.elements.importFileInput, UI.elements.importFolderInput, UI.elements.importZipInput];
      UI.elements[buttonId].addEventListener("click", () => {
        UI.elements.importDropdown.classList.remove("show");
        if (UI.elements.moreDropdown) UI.elements.moreDropdown.classList.remove("show");
        fileInputs[index].click();
      });
      fileInputs[index].addEventListener("change", async changeEvent => {
        if (!changeEvent.target.files.length) return;
        await Importer.processImport(buttonId === "btnImportZip" ? changeEvent.target.files[0] : changeEvent.target.files, buttonId === "btnImportZip");
        changeEvent.target.value = "";
      });
    });

    UI.elements.btnExport.addEventListener("click", () => {
      if (UI.elements.moreDropdown) UI.elements.moreDropdown.classList.remove("show");
      Exporter.exportData();
    });

    UI.elements.btnCopyForAi.addEventListener("click", AppController.copyForAi);
    UI.elements.btnApply.addEventListener("click", AppController.applyTranslation);
    UI.elements.btnUndo.addEventListener("click", AppController.undoTranslation);
    UI.elements.btnRedo.addEventListener("click", AppController.redoTranslation);
    
    UI.elements.btnProofread.addEventListener("click", () => {
      if (UI.elements.moreDropdown) UI.elements.moreDropdown.classList.remove("show");
      AppController.openProofread();
    });

    UI.elements.btnSelectAll.addEventListener("click", () => {
      AppState.lines.forEach(lineData => {
        if (!AppState.isTranslated(lineData)) AppState.selectedLines.add(lineData.line_num);
      });
      AppController.syncCheckboxes();
    });

    UI.elements.btnClearSelection.addEventListener("click", () => {
      AppState.selectedLines.clear();
      AppController.syncCheckboxes();
    });

    UI.elements.btnSelectRange.addEventListener("click", AppController.selectRange);
    
    UI.elements.btnGlossary.addEventListener("click", () => {
      if (UI.elements.moreDropdown) UI.elements.moreDropdown.classList.remove("show");
      UI.elements.glossaryVndbCheck.checked = AppState.vndbEnabled;
      UI.elements.glossaryVndbIdInput.value = AppState.vndbId || "";
      AppController.tempVndbGlossary = [...AppState.vndbGlossary];
      UI.elements.glossaryVndbPreviewArea.value = AppController.tempVndbGlossary.map(glossaryEntry => `${glossaryEntry[0]}: ${glossaryEntry[1]}`).join("\n");
      UI.elements.glossaryVndbWrap.classList.toggle("section-disabled", !AppState.vndbEnabled);
      UI.elements.glossaryVndbIdInput.disabled = UI.elements.btnGlossaryVndbFetch.disabled = AppController.tempVndbGlossary.length > 0;
      UI.elements.glossaryCustomCheck.checked = AppState.customEnabled;
      AppController.tempCustomRaw = AppState.customRaw || "";
      AppController.tempCustomGlossary = [...AppState.customGlossary];
      UI.elements.glossaryCustomInput.value = AppController.tempCustomRaw;
      UI.elements.glossaryCustomWrap.classList.toggle("section-disabled", !AppState.customEnabled);
      UI.elements.btnGlossaryCustomApply.disabled = true;
      UI.toggleModalVisibility(UI.elements.glossaryModal, true);
    });
    
    UI.elements.btnSettings.addEventListener("click", () => {
      if (UI.elements.moreDropdown) UI.elements.moreDropdown.classList.remove("show");
      UI.elements.settingsIgnoreNameCheck.checked = AppState.ignoreNameTranslation;
      UI.elements.settingsPromptCheck.checked = AppState.aiPromptEnabled;
      UI.elements.settingsReferenceCheck.checked = AppState.referenceEnabled;
      UI.elements.settingsJumpToContextCheck.checked = AppState.jumpToContext;
      UI.elements.settingsPromptInput.value = AppState.aiInstructionHeader;
      UI.elements.settingsEpubTagsInput.value = AppState.epubTags || "p";
      UI.toggleModalVisibility(UI.elements.settingsModal, true);
    });

    UI.elements.btnSettingsDasarReset.addEventListener("click", () => {
      UI.elements.settingsIgnoreNameCheck.checked = false;
      UI.elements.settingsPromptCheck.checked = true;
      UI.elements.settingsReferenceCheck.checked = false;
      UI.elements.settingsJumpToContextCheck.checked = false;
    });

    UI.elements.btnSettingsPromptReset.addEventListener("click", () => {
      UI.elements.settingsPromptInput.value = DEFAULT_PROMPT;
    });

    UI.elements.btnSettingsEpubReset.addEventListener("click", () => {
      UI.elements.settingsEpubTagsInput.value = "p";
    });

    UI.elements.btnSettingsCancel.addEventListener("click", () => UI.toggleModalVisibility(UI.elements.settingsModal, false));
    UI.elements.btnSettingsSave.addEventListener("click", () => {
      AppState.ignoreNameTranslation = UI.elements.settingsIgnoreNameCheck.checked;
      AppState.aiPromptEnabled = UI.elements.settingsPromptCheck.checked;
      AppState.referenceEnabled = UI.elements.settingsReferenceCheck.checked;
      AppState.jumpToContext = UI.elements.settingsJumpToContextCheck.checked;
      AppState.aiInstructionHeader = UI.elements.settingsPromptInput.value.trim();
      AppState.epubTags = UI.elements.settingsEpubTagsInput.value.trim() || "p";
      UI.toggleModalVisibility(UI.elements.settingsModal, false);
      AppState.queueAutoSave();
    });

    UI.elements.glossaryVndbCheck.addEventListener("change", changeEvent => {
      UI.elements.glossaryVndbWrap.classList.toggle("section-disabled", !changeEvent.target.checked);
    });

    UI.elements.btnGlossaryVndbFetch.addEventListener("click", async () => {
      let vndbIdentifier = UI.elements.glossaryVndbIdInput.value.trim();
      if (!vndbIdentifier) return;
      if (!vndbIdentifier.startsWith("v")) vndbIdentifier = "v" + vndbIdentifier;
      try {
        UI.elements.btnGlossaryVndbFetch.disabled = UI.elements.glossaryVndbIdInput.disabled = true;
        UI.elements.glossaryVndbStatus.textContent = "Mengambil data...";
        UI.elements.glossaryVndbStatus.className = "status-toast";
        UI.elements.glossaryVndbStatus.style.color = "var(--primary)";
        
        let allCharactersList = await VndbService.fetchCharacters(vndbIdentifier);
        if (!allCharactersList.length) throw new Error("Karakter tidak ditemukan.");
        
        AppController.tempVndbGlossary = VndbService.buildGlossary(allCharactersList);
        UI.elements.glossaryVndbPreviewArea.value = AppController.tempVndbGlossary.map(glossaryEntry => `${glossaryEntry[0]}: ${glossaryEntry[1]}`).join("\n");
        UI.elements.glossaryVndbStatus.textContent = `Ditemukan ${AppController.tempVndbGlossary.length} entri.`;
        UI.elements.glossaryVndbStatus.style.color = "var(--success)";
      } catch (error) {
        UI.elements.glossaryVndbStatus.textContent = error.message;
        UI.elements.glossaryVndbStatus.style.color = "var(--danger)";
        UI.elements.btnGlossaryVndbFetch.disabled = UI.elements.glossaryVndbIdInput.disabled = false;
      }
    });

    UI.elements.btnGlossaryVndbReset.addEventListener("click", () => {
      UI.elements.glossaryVndbCheck.checked = false;
      UI.elements.glossaryVndbIdInput.value = "";
      UI.elements.glossaryVndbPreviewArea.value = "";
      AppController.tempVndbGlossary = [];
      UI.elements.glossaryVndbStatus.className = "status-toast empty mb-2";
      UI.elements.glossaryVndbIdInput.disabled = UI.elements.btnGlossaryVndbFetch.disabled = false;
      UI.elements.glossaryVndbWrap.classList.add("section-disabled");
    });

    UI.elements.glossaryCustomCheck.addEventListener("change", changeEvent => {
      UI.elements.glossaryCustomWrap.classList.toggle("section-disabled", !changeEvent.target.checked);
    });

    UI.elements.btnGlossaryCustomReset.addEventListener("click", () => {
      UI.elements.glossaryCustomCheck.checked = false;
      UI.elements.glossaryCustomInput.value = "";
      UI.elements.glossaryCustomWrap.classList.add("section-disabled");
      UI.elements.btnGlossaryCustomApply.disabled = true;
      AppController.tempCustomRaw = "";
      AppController.tempCustomGlossary = [];
    });

    UI.elements.glossaryCustomInput.addEventListener("input", () => {
      let rawInputText = UI.elements.glossaryCustomInput.value;
      let isValidFormat = true;
      let hasContent = false;
      
      for (let textLine of rawInputText.split(/\r?\n/)) {
        textLine = textLine.trim();
        if (!textLine) continue;
        hasContent = true;
        let colonIndex = textLine.indexOf(":");
        if (colonIndex <= 0 || colonIndex === textLine.length - 1 || !textLine.substring(0, colonIndex).trim() || !textLine.substring(colonIndex + 1).trim()) {
          isValidFormat = false;
          break;
        }
      }
      UI.elements.btnGlossaryCustomApply.disabled = (rawInputText === AppController.tempCustomRaw || (!isValidFormat && hasContent));
    });

    UI.elements.btnGlossaryCustomApply.addEventListener("click", () => {
      let rawInputText = UI.elements.glossaryCustomInput.value;
      let processedGlossary = [];
      rawInputText.split(/\r?\n/).forEach(textLine => {
        textLine = textLine.trim();
        let colonIndex = textLine.indexOf(":");
        if (colonIndex > 0) {
          let originalWord = textLine.substring(0, colonIndex).trim();
          let translatedWord = textLine.substring(colonIndex + 1).trim();
          if (originalWord && translatedWord) processedGlossary.push([originalWord, translatedWord]);
        }
      });
      AppController.tempCustomRaw = rawInputText;
      AppController.tempCustomGlossary = processedGlossary;
      UI.elements.btnGlossaryCustomApply.disabled = true;
    });

    UI.elements.btnGlossaryCancel.addEventListener("click", () => UI.toggleModalVisibility(UI.elements.glossaryModal, false));
    UI.elements.btnGlossarySave.addEventListener("click", () => {
      AppState.vndbEnabled = UI.elements.glossaryVndbCheck.checked;
      AppState.vndbId = UI.elements.glossaryVndbIdInput.value.trim();
      AppState.vndbGlossary = AppController.tempVndbGlossary;
      AppState.customEnabled = UI.elements.glossaryCustomCheck.checked;
      AppState.customRaw = AppController.tempCustomRaw;
      AppState.customGlossary = AppController.tempCustomGlossary;
      UI.toggleModalVisibility(UI.elements.glossaryModal, false);
      AppState.queueAutoSave();
    });

    UI.elements.btnLineCancel.addEventListener("click", () => UI.toggleModalVisibility(UI.elements.lineEditorModal, false));
    UI.elements.btnLineSave.addEventListener("click", AppController.saveLineEditor);
    UI.elements.btnProofreadClose.addEventListener("click", () => UI.toggleModalVisibility(UI.elements.proofreadModal, false));
    
    UI.elements.btnProofreadReset.addEventListener("click", () => {
      UI.elements.proofreadSearchInput.value = "";
      UI.elements.proofreadReplaceInput.value = "";
      UI.elements.proofreadScope.value = "all";
      UI.elements.proofreadRegexCheck.checked = false;
      UI.elements.proofreadCaseCheck.checked = false;
      UI.elements.proofreadExactCheck.checked = false;
      UI.elements.proofreadTranslatedOnlyCheck.checked = true;
      AppController.syncProofreadSettings();
      AppController.renderProofread();
    });

    UI.elements.btnProofreadReplaceAll.addEventListener("click", AppController.execReplaceAll);
    
    let delayedSearch = AppController.throttle(AppController.renderProofread, 200);
    UI.elements.proofreadSearchInput.addEventListener("input", delayedSearch);
    
    ["proofreadScope", "proofreadRegexCheck", "proofreadCaseCheck", "proofreadExactCheck", "proofreadTranslatedOnlyCheck"].forEach(elementId => {
      UI.elements[elementId].addEventListener("change", () => {
        AppController.syncProofreadSettings();
        AppController.renderProofread();
      });
    });

    UI.elements.previewContainer.addEventListener("change", clickEvent => {
      if (clickEvent.target.classList.contains('sep-cb')) {
        let fileLinesArray = AppState.filesLinesCache.get(clickEvent.target.dataset.file) || [];
        fileLinesArray.forEach(lineData => {
          if (!AppState.isTranslated(lineData)) {
            if (clickEvent.target.checked) AppState.selectedLines.add(lineData.line_num);
            else AppState.selectedLines.delete(lineData.line_num);
          }
        });
        AppController.syncCheckboxes();
      } else if (clickEvent.target.closest('.checkbox-cell') && clickEvent.target.type === 'checkbox') {
        let targetLineNumber = Number(clickEvent.target.dataset.num);
        if (clickEvent.target.checked) AppState.selectedLines.add(targetLineNumber);
        else AppState.selectedLines.delete(targetLineNumber);
        AppController.syncCheckboxes();
      }
    });

    UI.elements.previewContainer.addEventListener("click", clickEvent => {
      let textContentWrap = clickEvent.target.closest('.text-content');
      if (textContentWrap) {
        let rowElement = textContentWrap.closest('.preview-row');
        if (rowElement && !rowElement.classList.contains('separator')) {
          let checkboxElement = rowElement.querySelector('input[type="checkbox"]');
          if (checkboxElement?.dataset.num) AppController.openLineEditor(Number(checkboxElement.dataset.num));
        }
      }
    });

    UI.elements.proofreadContainer.addEventListener("click", clickEvent => {
      let textContentWrap = clickEvent.target.closest('.text-content');
      if (textContentWrap?.dataset.num) {
        let lineNum = Number(textContentWrap.dataset.num);
        if (AppState.jumpToContext) {
          UI.toggleModalVisibility(UI.elements.proofreadModal, false);
          let rowIndex = AppState.displayRows.findIndex(rowData => rowData.type === "line" && rowData.line.line_num === lineNum);
          if (rowIndex !== -1) {
            AppController.mainScroller.scrollToIndex(rowIndex);
            setTimeout(() => {
              let rowHtmlElement = UI.elements.previewContainer.querySelector(`input[data-num="${lineNum}"]`)?.closest('.preview-row');
              if (rowHtmlElement) {
                let originalBackground = rowHtmlElement.style.backgroundColor;
                rowHtmlElement.style.transition = "background-color .3s ease";
                rowHtmlElement.style.backgroundColor = "rgba(59, 130, 246, 0.4)";
                setTimeout(() => rowHtmlElement.style.backgroundColor = originalBackground, 800);
              }
            }, 60);
          }
        } else {
          AppController.openLineEditor(lineNum);
        }
      }
    });

    UI.elements.nameTableBody.addEventListener("click", async clickEvent => {
      if (clickEvent.target.tagName === "TD") {
        try {
          await navigator.clipboard.writeText(clickEvent.target.textContent);
          UI.flashStatusMessage(`Nama disalin!`);
        } catch (error) {
          alert(`Gagal disalin.`);
        }
      }
    });

    UI.elements.btnCopyAllNames.addEventListener("click", async () => {
      let uniqueNamesSet = new Set();
      AppState.lines.forEach(lineData => {
        if (lineData.name) uniqueNamesSet.add(lineData.name);
      });
      let sortedNamesArray = Array.from(uniqueNamesSet).sort();
      if (!sortedNamesArray.length) return;
      try {
        await navigator.clipboard.writeText(sortedNamesArray.join('\n'));
        UI.flashStatusMessage(`${sortedNamesArray.length} nama disalin!`);
      } catch (error) {
        alert("Clipboard diblokir.");
      }
    });
  }

  static async backupProject(savedProject) {
    try {
      document.body.style.cursor = "wait";
      let backupZipArchive = new window.JSZip();
      backupZipArchive.file("metadata.json", JSON.stringify(Utils.extractMetadata(savedProject.data)));

      let originalTextString = "";
      let translateTextString = "";
      let nameTextString = "";

      for (let fileName of (savedProject.data.imported_files || [])) {
        originalTextString += `<filename>${fileName}</filename>\n`;
        translateTextString += `<filename>${fileName}</filename>\n`;
        nameTextString += `<filename>${fileName}</filename>\n`;
        savedProject.data.lines.filter(lineData => lineData.file === fileName).forEach(lineData => {
          originalTextString += `${lineData.message || ""}\n`;
          translateTextString += `${lineData.trans_message || ""}\n`;
          nameTextString += ((lineData.name || "") || (lineData.trans_name || "")) ? `<original>${lineData.name || ""}</original><translate>${lineData.trans_name || ""}</translate>\n` : `\n`;
        });
      }

      backupZipArchive.file("original.txt", originalTextString);
      backupZipArchive.file("translate.txt", translateTextString);
      backupZipArchive.file("name.txt", nameTextString);

      if (savedProject.data.projectType === "epub" && savedProject.data.epubSourceId) {
        let rootDirectory = await StorageManager.getRootDirectory();
        let fileHandle = await rootDirectory.getFileHandle(savedProject.data.epubSourceId);
        let epubFileObject = await fileHandle.getFile();
        backupZipArchive.file(savedProject.data.epubSourceId, epubFileObject);
      }

      let blobUrl = URL.createObjectURL(await backupZipArchive.generateAsync({ type: "blob", mimeType: "application/octet-stream", compression: "DEFLATE", compressionOptions: { level: 9 } }));
      let downloadAnchor = UI.createDomNode("a", null, { href: blobUrl, download: `${savedProject.name.replace(/[^\p{L}\p{N}_\-\.]/gu, '_')}_backup.cstl` });
      downloadAnchor.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch (error) {
      alert("Gagal backup: " + error.message);
    } finally {
      document.body.style.cursor = "default";
    }
  }

  static async loadDashboard() {
    UI.elements.projectList.innerHTML = "";
    try {
      let savedProjects = await StorageManager.fetchAllProjects();
      if (!savedProjects.length) {
        UI.elements.projectList.innerHTML = `<p class="hint" style="grid-column:1/-1;">Belum ada Project. Buat atau Pulihkan!</p>`;
        return;
      }
      
      savedProjects.forEach(savedProject => {
        let projectCard = UI.createDomNode("div", "project-card");
        let projectBadgeHtml = savedProject.fileCount || savedProject.lineCount ? (savedProject.data.projectType === 'epub' ? `<span class="badge badge-epub">EPUB</span>` : (savedProject.data.projectType === 'json' ? `<span class="badge badge-json">JSON-VNTP</span>` : '')) : '';
        
        projectCard.innerHTML = `
          <div class="project-card-main">
            <h3>${Utils.escapeHtml(savedProject.name)}</h3>
            <div class="project-meta mt-2">
              ${projectBadgeHtml ? `<div style="margin-bottom:8px;">${projectBadgeHtml}</div>` : ''}
              Diubah: ${new Date(savedProject.updatedAt).toLocaleString('id-ID')}<br>
              File: ${savedProject.fileCount} | Baris: ${savedProject.lineCount}
            </div>
          </div>
          <div class="project-actions">
            <button class="btn btn-primary btn-sm btn-open">Buka</button>
            <button class="btn btn-outline btn-sm btn-backup">Backup</button>
            <button class="btn btn-outline btn-sm btn-rename">Ubah</button>
            <button class="btn btn-danger btn-sm btn-delete">Hapus</button>
          </div>
        `;
        
        projectCard.querySelector(".btn-open").addEventListener("click", () => AppController.openProject(savedProject.id, savedProject.data));
        
        projectCard.querySelector(".btn-rename").addEventListener("click", async () => {
          let updatedProjectName = prompt("Nama baru:", savedProject.name);
          if (updatedProjectName?.trim() && updatedProjectName !== savedProject.name) {
            savedProject.data.projectName = updatedProjectName.trim();
            await StorageManager.saveProjectData(savedProject.id, savedProject.data);
            AppController.loadDashboard();
          }
        });
        
        projectCard.querySelector(".btn-backup").addEventListener("click", () => AppController.backupProject(savedProject));
        
        projectCard.querySelector(".btn-delete").addEventListener("click", async () => {
          if (confirm("Hapus permanen?")) {
            await StorageManager.removeProjectData(savedProject.id, savedProject.data.epubSourceId);
            AppController.loadDashboard();
          }
        });
        
        UI.elements.projectList.appendChild(projectCard);
      });
    } catch (error) {
      UI.elements.projectList.innerHTML = `<p class="hint" style="color:var(--danger);">Gagal akses storage.</p>`;
    }
  }

  static async restoreProject(changeEvent) {
    let uploadedFile = changeEvent.target.files?.[0];
    if (!uploadedFile) return;
    
    try {
      document.body.style.cursor = "wait";
      let zipArchive = new window.JSZip();
      await zipArchive.loadAsync(uploadedFile);
      
      let metaFileEntry = zipArchive.file("metadata.json");
      let originalFileEntry = zipArchive.file("original.txt");
      let translateFileEntry = zipArchive.file("translate.txt");
      let nameFileEntry = zipArchive.file("name.txt");
      
      if (!metaFileEntry || !originalFileEntry || !translateFileEntry || !nameFileEntry) throw new Error("Format arsip tidak valid.");
      
      let metadataJson = JSON.parse(await metaFileEntry.async("text"));
      let originalLinesArray = (await originalFileEntry.async("text")).split(/\r?\n/);
      let translateLinesArray = (await translateFileEntry.async("text")).split(/\r?\n/);
      let nameLinesArray = (await nameFileEntry.async("text")).split(/\r?\n/);
      
      if (originalLinesArray[originalLinesArray.length - 1] === "") originalLinesArray.pop();
      if (translateLinesArray[translateLinesArray.length - 1] === "") translateLinesArray.pop();
      if (nameLinesArray[nameLinesArray.length - 1] === "") nameLinesArray.pop();
      
      if (originalLinesArray.length !== translateLinesArray.length || originalLinesArray.length !== nameLinesArray.length) {
        throw new Error("Baris tidak sinkron.");
      }
      
      let parsedLinesArray = [];
      let currentFileName = "unknown";
      let currentLineNumber = 1;
      
      for (let arrayIndex = 0; arrayIndex < originalLinesArray.length; arrayIndex++) {
        let originalLine = originalLinesArray[arrayIndex];
        let fileMatch = originalLine.match(/^<filename>(.*?)<\/filename>$/);

        if (fileMatch) {
          if (translateLinesArray[arrayIndex] !== originalLine || nameLinesArray[arrayIndex] !== originalLine) {
            throw new Error("Header file tidak sinkron.");
          }
          currentFileName = fileMatch[1];
        } else {
          let parsedOriginalName = null;
          let parsedTranslateName = null;
          let nameLine = nameLinesArray[arrayIndex].trim();
          
          if (nameLine) {
            let origMatch = nameLine.match(/<original>(.*?)<\/original>/);
            let transMatch = nameLine.match(/<translate>(.*?)<\/translate>/);
            parsedOriginalName = origMatch ? origMatch[1] : null;
            parsedTranslateName = transMatch ? transMatch[1] : null;
          }
          
          parsedLinesArray.push({
            line_num: currentLineNumber++,
            file: currentFileName,
            name: parsedOriginalName,
            message: originalLine,
            trans_name: parsedTranslateName,
            trans_message: translateLinesArray[arrayIndex] || null,
            is_translated: !!translateLinesArray[arrayIndex]?.trim()
          });
        }
      }
      
      let restoredProjectName = metadataJson.projectName || uploadedFile.name.replace(".cstl", '');
      
      if (metadataJson.projectType === "epub" && metadataJson.epubSourceId) {
        let epubFileEntry = zipArchive.file(metadataJson.epubSourceId);
        if (epubFileEntry) {
          let newEpubId = "epub_" + Date.now() + ".epub";
          let rootDirectory = await StorageManager.getRootDirectory();
          let fileHandle = await rootDirectory.getFileHandle(newEpubId, { create: true });
          let writableStream = await fileHandle.createWritable();
          await writableStream.write(await epubFileEntry.async("blob"));
          await writableStream.close();
          metadataJson.epubSourceId = newEpubId;
        }
      }
      
      await StorageManager.saveProjectData("proj_" + Date.now() + ".cstl", {
        version: 10,
        projectName: restoredProjectName,
        projectType: metadataJson.projectType || "uninitialized",
        epubTags: metadataJson.epubTags || "p",
        epubSourceId: metadataJson.epubSourceId || null,
        imported_files: metadataJson.imported_files || [],
        lines: parsedLinesArray.map(AppState.normalizeLine),
        prompt_header: metadataJson.prompt_header || AppState.aiInstructionHeader,
        ignoreNameTranslation: metadataJson.ignoreNameTranslation ?? false,
        promptEnabled: metadataJson.promptEnabled ?? true,
        referenceEnabled: metadataJson.referenceEnabled ?? false,
        vndbEnabled: metadataJson.vndbEnabled ?? false,
        vndbId: metadataJson.vndbId || "",
        vndbGlossary: metadataJson.vndbGlossary || [],
        customEnabled: metadataJson.customEnabled ?? false,
        customRaw: metadataJson.customRaw || "",
        customGlossary: metadataJson.customGlossary || [],
        jumpToContext: metadataJson.jumpToContext ?? false
      });
      
      await AppController.loadDashboard();
      alert(`Project "${restoredProjectName}" dipulihkan!`);
    } catch (error) {
      alert("File korup: " + error.message);
    } finally {
      document.body.style.cursor = "default";
      changeEvent.target.value = "";
    }
  }

  static openProject(targetProjectId, targetProjectData) {
    AppState.currentProjectId = targetProjectId;
    AppState.projectName = targetProjectData.projectName || "Unknown";
    AppState.projectType = targetProjectData.projectType || "uninitialized";
    AppState.epubTags = targetProjectData.epubTags || "p";
    AppState.epubSourceId = targetProjectData.epubSourceId || null;
    AppState.lines = (targetProjectData.lines || []).map(AppState.normalizeLine);
    AppState.importedFiles = targetProjectData.imported_files || [];
    AppState.aiInstructionHeader = targetProjectData.prompt_header || AppState.aiInstructionHeader;
    AppState.ignoreNameTranslation = targetProjectData.ignoreNameTranslation ?? false;
    AppState.aiPromptEnabled = targetProjectData.promptEnabled ?? true;
    AppState.referenceEnabled = targetProjectData.referenceEnabled ?? false;
    AppState.vndbEnabled = targetProjectData.vndbEnabled ?? false;
    AppState.vndbId = targetProjectData.vndbId || "";
    AppState.vndbGlossary = targetProjectData.vndbGlossary || [];
    AppState.customEnabled = targetProjectData.customEnabled ?? false;
    AppState.customRaw = targetProjectData.customRaw || "";
    AppState.customGlossary = targetProjectData.customGlossary || [];
    AppState.jumpToContext = targetProjectData.jumpToContext ?? false;
    AppState.proofreadScope = targetProjectData.proofreadScope || "all";
    AppState.proofreadRegex = targetProjectData.proofreadRegex ?? false;
    AppState.proofreadCaseSensitive = targetProjectData.proofreadCaseSensitive ?? false;
    AppState.proofreadExactMatch = targetProjectData.proofreadExactMatch ?? false;
    AppState.proofreadTranslatedOnly = targetProjectData.proofreadTranslatedOnly ?? true;
    AppState.selectedLines.clear();
    AppState.undoSnapshot = AppState.redoSnapshot = null;
    AppState.namesDirty = true;
    
    UI.elements.projectNameDisplay.textContent = AppState.projectName;
    UI.elements.dashboardView.classList.remove("open");
    UI.elements.workspaceView.style.display = "flex";
    
    requestAnimationFrame(() => AppController.adjustToolbar());
    AppController.refreshWorkspace(false);
  }

  static closeProject() {
    if (AppState.saveTimeout) {
      clearTimeout(AppState.saveTimeout);
      StorageManager.saveProjectData(AppState.currentProjectId, AppState.toProjectData())
        .then(AppController.finishClose)
        .catch(AppController.finishClose);
    } else {
      AppController.finishClose();
    }
  }

  static finishClose() {
    AppState.saveTimeout = null;
    AppState.currentProjectId = null;
    AppState.epubSourceId = null;
    AppState.undoSnapshot = null;
    AppState.redoSnapshot = null;
    AppState.projectName = "";
    AppState.lines = [];
    AppState.importedFiles = [];
    AppState.displayRows = [];
    AppState.proofreadMatches = [];
    AppState.selectedLines.clear();
    AppState.lineByNum.clear();
    AppState.filesLinesCache.clear();
    AppState.translatedCount = 0;
    AppState.proofreadScope = "all";
    AppState.proofreadRegex = false;
    AppState.proofreadCaseSensitive = false;
    AppState.proofreadExactMatch = false;
    AppState.proofreadTranslatedOnly = true;
    AppState.namesDirty = true;
    
    if (AppController.mainScroller) AppController.mainScroller.setItems([], false);
    if (AppController.proofreadScroller) AppController.proofreadScroller.setItems([], false);
    
    UI.elements.nameTableBody.replaceChildren();
    UI.elements.pasteArea.value = "";
    UI.elements.copyStatus.classList.add("empty");
    UI.elements.workspaceView.style.display = "none";
    UI.elements.dashboardView.classList.add("open");
    AppController.loadDashboard();
  }

  static refreshWorkspace(keepScroll = true) {
    AppState.updateTranslatedCount();
    AppState.rebuildCache();
    AppController.mainScroller.setItems(AppState.displayRows, keepScroll);
    AppController.updateButtons();
    if (AppState.namesDirty) {
      AppController.renderNameTable();
      AppState.namesDirty = false;
    }
    AppController.updateStatusBar();
    UI.elements.btnUndo.disabled = !AppState.undoSnapshot;
    UI.elements.btnRedo.disabled = !AppState.redoSnapshot;
  }

  static updateButtons() {
    let hasProjectData = AppState.lines.length > 0;
    let hasSelectedLines = AppState.selectedLines.size > 0;
    
    UI.elements.btnExport.disabled = !hasProjectData;
    UI.elements.btnProofread.disabled = !hasProjectData;
    UI.elements.btnSelectAll.disabled = !hasProjectData;
    UI.elements.pasteArea.disabled = !hasProjectData;
    UI.elements.btnApply.disabled = !hasProjectData;
    UI.elements.rangeFromInput.disabled = !hasProjectData;
    UI.elements.rangeToInput.disabled = !hasProjectData;
    UI.elements.btnSelectRange.disabled = !hasProjectData;
    
    UI.elements.btnClearSelection.disabled = !hasSelectedLines;
    UI.elements.btnCopyForAi.disabled = !hasSelectedLines;
    let copyCount = AppState.selectedLines.size;
    UI.elements.btnCopyForAi.textContent = copyCount > 0 ? `Copy ${copyCount} Baris` : "Copy";
  }

  static updateStatusBar() {
    let totalLinesCount = AppState.lines.length;
    let translatedLinesCount = AppState.translatedCount;
    let translationPercentage = totalLinesCount ? Math.floor((translatedLinesCount / totalLinesCount) * 100) : 0;
    let displayModeText = AppState.projectType === "uninitialized" ? "-" : (AppState.projectType === "epub" ? "EPUB" : "JSON-VNTP");
    let displayFileText = AppState.importedFiles.length > 1 ? AppState.importedFiles.length : (AppState.importedFiles[0] || "-");
    
    UI.elements.statusBar.textContent = `Mode: ${displayModeText} | File: ${displayFileText} | Baris: ${totalLinesCount} | TL: ${translatedLinesCount}/${totalLinesCount} (${translationPercentage}%)`;
    UI.elements.progressFill.style.width = `${translationPercentage}%`;
    UI.elements.progressText.textContent = `${translatedLinesCount}/${totalLinesCount}`;
  }

  static createMainRow() {
    let mainRow = document.createElement("div");
    mainRow.className = "preview-row";
    
    let checkboxCell = document.createElement("div");
    checkboxCell.className = "checkbox-cell";
    
    let checkboxElement = document.createElement("input");
    checkboxElement.type = "checkbox";
    
    let textContentWrap = document.createElement("div");
    textContentWrap.className = "text-content";
    
    let originalDiv = document.createElement("div");
    originalDiv.className = "original";
    
    let translatedDiv = document.createElement("div");
    translatedDiv.className = "translated";
    
    textContentWrap.append(originalDiv, translatedDiv);
    checkboxCell.append(checkboxElement, textContentWrap);
    
    let separatorDiv = document.createElement("div");
    separatorDiv.style.cssText = "display:none;align-items:center;gap:12px;width:100%;";
    
    let separatorCheckbox = document.createElement("input");
    separatorCheckbox.type = "checkbox";
    separatorCheckbox.className = "sep-cb";
    
    let separatorLabel = document.createElement("div");
    separatorLabel.className = "mono grow";
    separatorLabel.style.cssText = "font-weight:700;color:var(--primary);";
    
    separatorDiv.append(separatorCheckbox, separatorLabel);
    mainRow.append(checkboxCell, separatorDiv);
    
    mainRow.checkboxCellElement = checkboxCell;
    mainRow.checkboxElement = checkboxElement;
    mainRow.originalDivElement = originalDiv;
    mainRow.translatedDivElement = translatedDiv;
    mainRow.separatorDivElement = separatorDiv;
    mainRow.separatorCheckboxElement = separatorCheckbox;
    mainRow.separatorLabelElement = separatorLabel;
    
    return mainRow;
  }

  static updateMainRow(rowElement, rowData) {
    if (rowData.type === "separator") {
      rowElement.className = "preview-row separator";
      rowElement.checkboxCellElement.style.display = "none";
      rowElement.separatorDivElement.style.display = "flex";
      rowElement.separatorCheckboxElement.dataset.file = rowData.file;
      
      let fileLinesArray = AppState.filesLinesCache.get(rowData.file) || [];
      let allLinesChecked = true;
      let hasUntranslatedLines = false;
      
      fileLinesArray.forEach(lineData => {
        if (!AppState.isTranslated(lineData)) {
          hasUntranslatedLines = true;
          if (!AppState.selectedLines.has(lineData.line_num)) allLinesChecked = false;
        }
      });
      
      rowElement.separatorCheckboxElement.checked = hasUntranslatedLines && allLinesChecked;
      rowElement.separatorLabelElement.textContent = `File: ${rowData.file}`;
    } else {
      let lineData = rowData.line;
      let rowClasses = "preview-row";
      
      if (AppState.isTranslated(lineData)) rowClasses += " row-translated";
      if (AppState.selectedLines.has(lineData.line_num)) rowClasses += " row-selected";
      
      rowElement.className = rowClasses;
      rowElement.checkboxCellElement.style.display = "flex";
      rowElement.separatorDivElement.style.display = "none";
      rowElement.checkboxElement.dataset.num = lineData.line_num;
      rowElement.checkboxElement.checked = AppState.selectedLines.has(lineData.line_num);
      rowElement.checkboxElement.disabled = AppState.isTranslated(lineData);
      
      rowElement.originalDivElement.textContent = lineData.name ? `${lineData.line_num}. ${lineData.name}: ${lineData.message}` : `${lineData.line_num}. ${lineData.message}`;
      
      if (AppState.isTranslated(lineData)) {
        rowElement.translatedDivElement.classList.remove("cell-muted");
        let translatedCharacterName = lineData.trans_name || lineData.name;
        rowElement.translatedDivElement.textContent = translatedCharacterName ? `${lineData.line_num}. ${translatedCharacterName}: ${lineData.trans_message}` : `${lineData.line_num}. ${lineData.trans_message}`;
      } else {
        rowElement.translatedDivElement.classList.add("cell-muted");
        rowElement.translatedDivElement.textContent = "——";
      }
    }
  }

  static syncCheckboxes() {
    AppController.mainScroller.forceUpdate();
    AppController.updateButtons();
  }

  static renderNameTable() {
    let uniqueNamesSet = new Set();
    AppState.lines.forEach(lineData => {
      if (lineData.name) uniqueNamesSet.add(lineData.name);
    });
    
    let sortedNamesArray = Array.from(uniqueNamesSet).sort();
    UI.elements.nameTotalCount.textContent = sortedNamesArray.length;
    UI.elements.btnCopyAllNames.disabled = !sortedNamesArray.length;
    UI.elements.nameTableBody.replaceChildren();
    
    let documentFragment = document.createDocumentFragment();
    sortedNamesArray.forEach(characterName => {
      let tableRow = document.createElement("tr");
      let tableCell = document.createElement("td");
      tableCell.className = "mono";
      tableCell.textContent = characterName;
      tableCell.title = "Klik untuk copy";
      tableRow.appendChild(tableCell);
      documentFragment.appendChild(tableRow);
    });
    UI.elements.nameTableBody.appendChild(documentFragment);
  }

  static selectRange() {
    let fromLineNumber = parseInt(UI.elements.rangeFromInput.value);
    let toLineNumber = parseInt(UI.elements.rangeToInput.value);
    let maxLineNumber = AppState.lines.length ? AppState.lines.reduce((maxId, lineData) => Math.max(maxId, lineData.line_num), 0) : 0;
    
    if (isNaN(fromLineNumber) || isNaN(toLineNumber) || fromLineNumber > toLineNumber || fromLineNumber < 1 || fromLineNumber > maxLineNumber || toLineNumber > maxLineNumber) {
      return alert("Range tidak valid.");
    }
    
    AppState.selectedLines.clear();
    for (let lineNumber = fromLineNumber; lineNumber <= toLineNumber; lineNumber++) {
      let lineData = AppState.lineByNum.get(lineNumber);
      if (lineData && !AppState.isTranslated(lineData)) AppState.selectedLines.add(lineNumber);
    }
    
    AppController.syncCheckboxes();
    
    let rowIndex = AppState.displayRows.findIndex(rowData => rowData.type === "line" && rowData.line.line_num === fromLineNumber);
    if (rowIndex !== -1) {
      AppController.mainScroller.scrollToIndex(rowIndex);
      setTimeout(() => {
        let rowHtmlElement = UI.elements.previewContainer.querySelector(`input[data-num="${fromLineNumber}"]`)?.closest('.preview-row');
        if (rowHtmlElement) {
          let originalBackground = rowHtmlElement.style.backgroundColor;
          rowHtmlElement.style.transition = "background-color .3s ease";
          rowHtmlElement.style.backgroundColor = "rgba(59, 130, 246, 0.4)";
          setTimeout(() => rowHtmlElement.style.backgroundColor = originalBackground, 800);
        }
      }, 50);
    }
  }

  static async copyForAi() {
    let selectedLinesArray = AppState.lines.filter(lineData => AppState.selectedLines.has(lineData.line_num));
    let promptText = "";

    if (AppState.aiPromptEnabled && AppState.aiInstructionHeader.trim()) {
      promptText += `<instruction>\n${AppState.aiInstructionHeader.trim()}\n</instruction>\n\n`;
    }

    let glossaryMap = new Map();
    if (AppState.vndbEnabled && AppState.vndbGlossary?.length) {
      AppState.vndbGlossary.forEach(entry => glossaryMap.set(entry[0], entry[1]));
    }
    if (AppState.customEnabled && AppState.customGlossary?.length) {
      AppState.customGlossary.forEach(entry => glossaryMap.set(entry[0], entry[1]));
    }

    if (glossaryMap.size > 0) {
      promptText += `<glossary>\n`;
      glossaryMap.forEach((val, key) => promptText += `${key}: ${val}\n`);
      promptText += `</glossary>\n\n`;
    }

    if (AppState.referenceEnabled) {
      let referenceMap = new Map();
      let selectedNames = new Set();
      let selectedTrigrams = new Set();

      selectedLinesArray.forEach(line => {
        if (line.name) selectedNames.add(line.name);
        let tri = Utils.getTrigrams(line.message);
        tri.forEach(t => selectedTrigrams.add(t));
      });

      if (selectedNames.size > 0) {
        let translatedLinesReversed = [...AppState.lines].filter(l => AppState.isTranslated(l)).reverse();
        selectedNames.forEach(name => {
          if (!glossaryMap.has(name)) {
            let match = translatedLinesReversed.find(l => l.name === name && l.trans_name);
            if (match && match.trans_name) {
              referenceMap.set(name, match.trans_name);
            }
          }
        });
      }

      let scoredMessages = [];
      let translatedLines = AppState.lines.filter(l => AppState.isTranslated(l));
      
      translatedLines.forEach(line => {
        if (line.message && !glossaryMap.has(line.message)) {
          let lineTrigrams = Utils.getTrigrams(line.message);
          let score = 0;
          for (let t of lineTrigrams) {
            if (selectedTrigrams.has(t)) score++;
          }
          if (score > 0) {
            scoredMessages.push({ orig: line.message, trans: line.trans_message, score: score });
          }
        }
      });

      scoredMessages.sort((a, b) => b.score - a.score);
      
      let addedCount = 0;
      let seenOrig = new Set();
      for (let msg of scoredMessages) {
        if (addedCount >= 5) break;
        if (!seenOrig.has(msg.orig)) {
          seenOrig.add(msg.orig);
          referenceMap.set(msg.orig, msg.trans);
          addedCount++;
        }
      }

      if (referenceMap.size > 0) {
        promptText += `<reference>\n`;
        referenceMap.forEach((val, key) => promptText += `${key}: ${val}\n`);
        promptText += `</reference>\n\n`;
      }
    }

    promptText += `<translate>\n`;
    selectedLinesArray.forEach(line => {
      let id = line.line_num;
      if (line.name) {
        promptText += `<${id} n="${line.name.replace(/"/g, '&quot;')}">${line.message}</${id}>\n`;
      } else {
        promptText += `<${id}>${line.message}</${id}>\n`;
      }
    });
    promptText += `</translate>`;

    try {
      await navigator.clipboard.writeText(promptText);
      UI.flashStatusMessage(`Disalin ${selectedLinesArray.length} baris.`);
    } catch (error) {
      UI.elements.pasteArea.value = promptText;
      alert("Clipboard diblokir. Teks dipindah ke kolom 'Paste hasil AI'.");
    }
  }

  static applyTranslation() {
    if (!AppState.lines.length) return;
    
    let rawInputText = UI.elements.pasteArea.value.trim();
    let regexPattern = /<(\d+)\s*(?:n=(["'])(.*?)\2)?\s*>([\s\S]*?)<\/\1>/g;
    let matchResult;
    let processedResults = [];
    let validationErrors = [];
    let seenLineNumbers = new Set();
    
    while ((matchResult = regexPattern.exec(rawInputText)) !== null) {
      let targetLineNumber = Number(matchResult[1]);
      let characterName = matchResult[3] !== undefined ? matchResult[3].replace(/&quot;/g, '"') : null;
      let translationMessage = matchResult[4].trim();
      
      if (seenLineNumbers.has(targetLineNumber)) {
        validationErrors.push(`[Baris ${targetLineNumber}] Terdapat duplikat ID balasan AI.`);
        continue;
      }
      seenLineNumbers.add(targetLineNumber);
      processedResults.push({ num: targetLineNumber, name: characterName, msg: translationMessage });
    }
    
    if (!processedResults.length) return alert("Gagal: Format tag terjemahan tidak ditemukan pada teks.");
    
    if (processedResults.length !== AppState.selectedLines.size) {
      validationErrors.push(`Jumlah tag yang dibaca (${processedResults.length}) tidak sama dengan jumlah centang (${AppState.selectedLines.size}).`);
    }
    
    AppState.selectedLines.forEach(targetLineNumber => {
      if (!seenLineNumbers.has(targetLineNumber)) validationErrors.push(`[Baris ${targetLineNumber}] AI melewatkan baris ini (tidak dikerjakan).`);
    });
    
    seenLineNumbers.forEach(targetLineNumber => {
      if (!AppState.selectedLines.has(targetLineNumber)) validationErrors.push(`[Baris ${targetLineNumber}] AI mengarang ID ini (kamu tidak mencentangnya).`);
    });
    
    let translationUpdates = [];
    processedResults.forEach(resultItem => {
      let targetLineData = AppState.lineByNum.get(resultItem.num);
      if (!targetLineData) {
        validationErrors.push(`[Baris ${resultItem.num}] ID ini tidak ada di sistem sama sekali.`);
        return;
      }
      
      if (AppState.ignoreNameTranslation && targetLineData.name) {
        resultItem.name = targetLineData.name;
      }
      
      let hasOriginalName = !!(targetLineData.name || "").trim();
      let hasTranslatedName = !!(resultItem.name || "").trim();
      
      if (hasOriginalName && !hasTranslatedName) validationErrors.push(`[Baris ${resultItem.num}] Teks asli punya Nama Karakter, tapi AI mengosongkannya.`);
      else if (!hasOriginalName && hasTranslatedName) validationErrors.push(`[Baris ${resultItem.num}] Teks asli tanpa Nama (Narasi), tapi AI menyelipkan nama.`);
      else if (!resultItem.msg) validationErrors.push(`[Baris ${resultItem.num}] Pesan kosong.`);
      else translationUpdates.push({ lineData: targetLineData, itemResult: resultItem });
    });
    
    if (validationErrors.length) {
      return alert("DITOLAK:\n" + validationErrors.slice(0, 10).join("\n") + (validationErrors.length > 10 ? `\n... (+${validationErrors.length - 10} baris error lainnya)` : ""));
    }
    
    AppState.undoSnapshot = { lines: JSON.parse(JSON.stringify(AppState.lines)), selected: new Set(AppState.selectedLines) };
    AppState.redoSnapshot = null;
    
    translationUpdates.forEach(({ lineData, itemResult }) => {
      lineData.trans_message = itemResult.msg;
      lineData.is_translated = true;
      if (itemResult.name) lineData.trans_name = AppState.ignoreNameTranslation ? null : itemResult.name;
      AppState.selectedLines.delete(lineData.line_num);
    });
    
    UI.elements.pasteArea.value = "";
    AppState.namesDirty = true;
    AppController.refreshWorkspace(true);
    AppState.queueAutoSave();
    UI.flashStatusMessage(`${translationUpdates.length} baris sukses diterapkan.`);
  }

  static undoTranslation() {
    if (!AppState.undoSnapshot) return;
    AppState.redoSnapshot = { lines: JSON.parse(JSON.stringify(AppState.lines)), selected: new Set(AppState.selectedLines) };
    AppState.lines = AppState.undoSnapshot.lines.map(AppState.normalizeLine);
    AppState.selectedLines = new Set(AppState.undoSnapshot.selected);
    AppState.undoSnapshot = null;
    AppState.namesDirty = true;
    AppController.refreshWorkspace(true);
    AppState.queueAutoSave();
  }

  static redoTranslation() {
    if (!AppState.redoSnapshot) return;
    AppState.undoSnapshot = { lines: JSON.parse(JSON.stringify(AppState.lines)), selected: new Set(AppState.selectedLines) };
    AppState.lines = AppState.redoSnapshot.lines.map(AppState.normalizeLine);
    AppState.selectedLines = new Set(AppState.redoSnapshot.selected);
    AppState.redoSnapshot = null;
    AppState.namesDirty = true;
    AppController.refreshWorkspace(true);
    AppState.queueAutoSave();
  }

  static openLineEditor(targetLineNumber) {
    let targetLineData = AppState.lineByNum.get(targetLineNumber);
    if (!targetLineData) return;
    
    AppController.activeEditorLineNum = targetLineNumber;
    UI.elements.lineEditorTitle.textContent = `Edit Baris ${targetLineNumber}`;
    UI.elements.lineOriginalView.value = targetLineData.name ? `${targetLineData.name}: ${targetLineData.message}` : targetLineData.message;
    UI.elements.lineNameWrap.style.display = targetLineData.name ? "block" : "none";
    UI.elements.lineNameInput.value = targetLineData.name ? (targetLineData.trans_name || "") : "";
    if (targetLineData.name) UI.elements.lineNameInput.placeholder = targetLineData.name;
    
    UI.elements.lineMessageInput.value = (targetLineData.trans_message || "").trim();
    UI.elements.lineTranslatedCheck.checked = AppState.isTranslated(targetLineData);
    UI.toggleModalVisibility(UI.elements.lineEditorModal, true);
  }

  static saveLineEditor() {
    let targetLineData = AppState.lineByNum.get(AppController.activeEditorLineNum);
    if (!targetLineData) return;
    
    let translationMessage = UI.elements.lineMessageInput.value.trim().replace(/\r?\n/g, "\\n");
    if (UI.elements.lineTranslatedCheck.checked && !translationMessage) return alert("Pesan kosong.");
    
    AppState.undoSnapshot = { lines: JSON.parse(JSON.stringify(AppState.lines)), selected: new Set(AppState.selectedLines) };
    targetLineData.trans_message = translationMessage || null;
    targetLineData.is_translated = !!(UI.elements.lineTranslatedCheck.checked && translationMessage);
    if (targetLineData.name) targetLineData.trans_name = UI.elements.lineNameInput.value.trim().replace(/\r?\n/g, "\\n") || null;
    
    AppState.redoSnapshot = null;
    AppState.namesDirty = true;
    UI.toggleModalVisibility(UI.elements.lineEditorModal, false);
    AppController.refreshWorkspace(true);
    if (UI.elements.proofreadModal.classList.contains("open")) AppController.renderProofread();
    AppState.queueAutoSave();
  }

  static createHighlight(sourceText, highlightRegex) {
    if (!highlightRegex) return document.createTextNode(sourceText);
    let documentFragment = document.createDocumentFragment();
    let lastIndex = 0;
    let matchResult;
    highlightRegex.lastIndex = 0;
    while ((matchResult = highlightRegex.exec(sourceText)) !== null) {
      if (matchResult.index > lastIndex) {
        documentFragment.appendChild(document.createTextNode(sourceText.substring(lastIndex, matchResult.index)));
      }
      let markElement = document.createElement("mark");
      markElement.className = "highlight";
      markElement.textContent = matchResult[0];
      documentFragment.appendChild(markElement);
      lastIndex = matchResult.index + matchResult[0].length;
      if (matchResult[0].length === 0) highlightRegex.lastIndex++;
    }
    if (lastIndex < sourceText.length) {
      documentFragment.appendChild(document.createTextNode(sourceText.substring(lastIndex)));
    }
    return documentFragment;
  }

  static syncProofreadSettings() {
    AppState.proofreadScope = UI.elements.proofreadScope.value;
    AppState.proofreadRegex = UI.elements.proofreadRegexCheck.checked;
    AppState.proofreadCaseSensitive = UI.elements.proofreadCaseCheck.checked;
    AppState.proofreadExactMatch = UI.elements.proofreadExactCheck.checked;
    AppState.proofreadTranslatedOnly = UI.elements.proofreadTranslatedOnlyCheck.checked;
    if (AppState.currentProjectId) AppState.queueAutoSave();
  }

  static openProofread() {
    UI.elements.proofreadScope.value = AppState.proofreadScope;
    UI.elements.proofreadRegexCheck.checked = AppState.proofreadRegex;
    UI.elements.proofreadCaseCheck.checked = AppState.proofreadCaseSensitive;
    UI.elements.proofreadExactCheck.checked = AppState.proofreadExactMatch;
    UI.elements.proofreadTranslatedOnlyCheck.checked = AppState.proofreadTranslatedOnly;
    UI.toggleModalVisibility(UI.elements.proofreadModal, true);
    setTimeout(() => AppController.renderProofread(), 340);
  }

  static renderProofread() {
    if (!UI.elements.proofreadModal.classList.contains("open")) return;
    
    let searchQueryText = UI.elements.proofreadSearchInput.value;
    let isRegexSearch = UI.elements.proofreadRegexCheck.checked;
    let isCaseSensitiveSearch = UI.elements.proofreadCaseCheck.checked;
    let isExactMatchSearch = UI.elements.proofreadExactCheck.checked;
    let onlyTranslatedSearch = UI.elements.proofreadTranslatedOnlyCheck.checked;
    let searchScopeType = UI.elements.proofreadScope.value;
    let searchRegExp = null;
    
    AppController.currentHighlightRegex = null;
    
    if (searchQueryText) {
      try {
        let regexPatternString = isRegexSearch ? searchQueryText : searchQueryText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (isExactMatchSearch) regexPatternString = `(?<![\\p{L}\\p{N}_])${regexPatternString}(?![\\p{L}\\p{N}_])`;
        searchRegExp = new RegExp(regexPatternString, isCaseSensitiveSearch ? "gu" : "giu");
        AppController.currentHighlightRegex = new RegExp(regexPatternString, isCaseSensitiveSearch ? "gu" : "giu");
      } catch (error) {
        return;
      }
    }
    
    AppState.proofreadMatches = AppState.lines.filter(lineData => {
      if (onlyTranslatedSearch && !AppState.isTranslated(lineData)) return false;
      let defaultOriginalName = lineData.name || "";
      let finalTranslatedName = AppState.isTranslated(lineData) ? (lineData.trans_name || "").trim() || lineData.name : null;
      let targetSearchMessage = onlyTranslatedSearch ? lineData.trans_message : lineData.message;
      let targetSearchName = onlyTranslatedSearch ? finalTranslatedName : defaultOriginalName;
      
      if (searchQueryText && searchRegExp) {
        let isMatchFound = false;
        searchRegExp.lastIndex = 0;
        if ((searchScopeType === 'all' || searchScopeType === 'message') && targetSearchMessage && searchRegExp.test(targetSearchMessage)) isMatchFound = true;
        searchRegExp.lastIndex = 0;
        if (!isMatchFound && (searchScopeType === 'all' || searchScopeType === 'name') && targetSearchName && searchRegExp.test(targetSearchName)) isMatchFound = true;
        if (!isMatchFound) return false;
      }
      return true;
    }).map(lineData => ({
      num: lineData.line_num,
      file: lineData.file,
      origName: lineData.name || "",
      origMsg: lineData.message,
      transName: AppState.isTranslated(lineData) ? (lineData.trans_name || "").trim() || lineData.name : null,
      transMsg: lineData.trans_message,
      isTrans: AppState.isTranslated(lineData)
    }));
    
    UI.elements.proofreadStatus.textContent = `Ditemukan ${AppState.proofreadMatches.length} baris.`;
    
    let queryChanged = searchQueryText !== AppController.lastSearchQuery;
    AppController.lastSearchQuery = searchQueryText;
    AppController.proofreadScroller.setItems(AppState.proofreadMatches, !queryChanged);
  }

  static createProofreadRow() {
    let proofreadRow = document.createElement("div");
    proofreadRow.className = "preview-row";
    
    let contentWrap = document.createElement("div");
    contentWrap.className = "text-content";
    
    let metaDiv = document.createElement("div");
    metaDiv.className = "file-meta";
    
    let originalDiv = document.createElement("div");
    originalDiv.className = "original";
    
    let translatedDiv = document.createElement("div");
    translatedDiv.className = "translated";
    
    contentWrap.append(metaDiv, originalDiv, translatedDiv);
    proofreadRow.append(contentWrap);
    
    proofreadRow.wrapElement = contentWrap;
    proofreadRow.metaElement = metaDiv;
    proofreadRow.originalElement = originalDiv;
    proofreadRow.translatedElement = translatedDiv;
    
    return proofreadRow;
  }

  static updateProofreadRow(rowElement, rowData) {
    rowElement.wrapElement.dataset.num = rowData.num;
    rowElement.metaElement.textContent = `File: ${rowData.file} | Baris: ${rowData.num}`;
    rowElement.originalElement.replaceChildren();
    rowElement.translatedElement.replaceChildren();
    
    let onlyTranslatedChecked = UI.elements.proofreadTranslatedOnlyCheck.checked;
    let searchScopeValue = UI.elements.proofreadScope.value;
    
    let buildNodeTree = (nameString, messageString, applyHighlight) => {
      let documentFragment = document.createDocumentFragment();
      if (nameString) {
        if (applyHighlight && (searchScopeValue === 'all' || searchScopeValue === 'name')) {
          documentFragment.appendChild(AppController.createHighlight(nameString, AppController.currentHighlightRegex));
        } else {
          documentFragment.appendChild(document.createTextNode(nameString));
        }
        documentFragment.appendChild(document.createTextNode(": "));
      }
      if (applyHighlight && (searchScopeValue === 'all' || searchScopeValue === 'message')) {
        documentFragment.appendChild(AppController.createHighlight(messageString, AppController.currentHighlightRegex));
      } else {
        documentFragment.appendChild(document.createTextNode(messageString));
      }
      return documentFragment;
    };
    
    if (!rowData.isTrans) rowElement.translatedElement.classList.add("cell-muted");
    else rowElement.translatedElement.classList.remove("cell-muted");
    
    if (onlyTranslatedChecked) {
      rowElement.originalElement.textContent = rowData.origName ? `${rowData.origName}: ${rowData.origMsg}` : rowData.origMsg;
      if (rowData.isTrans) rowElement.translatedElement.appendChild(buildNodeTree(rowData.transName, rowData.transMsg, true));
      else rowElement.translatedElement.textContent = "——";
    } else {
      rowElement.originalElement.appendChild(buildNodeTree(rowData.origName, rowData.origMsg, true));
      if (rowData.isTrans) rowElement.translatedElement.textContent = rowData.transName ? `${rowData.transName}: ${rowData.transMsg}` : rowData.transMsg;
      else rowElement.translatedElement.textContent = "——";
    }
  }

  static execReplaceAll() {
    let searchQueryText = UI.elements.proofreadSearchInput.value;
    let replacementText = UI.elements.proofreadReplaceInput.value;
    
    if (!searchQueryText) return alert("Pencarian kosong!");
    
    let replaceRegExp;
    try {
      let replacePatternString = UI.elements.proofreadRegexCheck.checked ? searchQueryText : searchQueryText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (UI.elements.proofreadExactCheck.checked) replacePatternString = `(?<![\\p{L}\\p{N}_])${replacePatternString}(?![\\p{L}\\p{N}_])`;
      replaceRegExp = new RegExp(replacePatternString, UI.elements.proofreadCaseCheck.checked ? 'gu' : 'giu');
    } catch (error) {
      return alert("Regex tidak valid.");
    }
    
    let replacedCount = 0;
    AppState.undoSnapshot = { lines: JSON.parse(JSON.stringify(AppState.lines)), selected: new Set(AppState.selectedLines) };
    AppState.redoSnapshot = null;
    
    let onlyTranslatedReplace = UI.elements.proofreadTranslatedOnlyCheck.checked;
    let replaceScopeType = UI.elements.proofreadScope.value;
    
    AppState.lines.forEach(lineData => {
      if (onlyTranslatedReplace && !AppState.isTranslated(lineData)) return;
      
      let isLineReplaced = false;
      let targetMessageProperty = onlyTranslatedReplace ? 'trans_message' : 'message';
      let targetNameProperty = onlyTranslatedReplace ? 'trans_name' : 'name';
      
      if ((replaceScopeType === 'all' || replaceScopeType === 'message') && lineData[targetMessageProperty]) {
        let newStringValue = lineData[targetMessageProperty].replace(replaceRegExp, replacementText);
        if (newStringValue !== lineData[targetMessageProperty]) {
          lineData[targetMessageProperty] = newStringValue;
          isLineReplaced = true;
        }
      }
      
      if ((replaceScopeType === 'all' || replaceScopeType === 'name') && lineData[targetNameProperty]) {
        let newStringValue = lineData[targetNameProperty].replace(replaceRegExp, replacementText);
        if (newStringValue !== lineData[targetNameProperty]) {
          lineData[targetNameProperty] = newStringValue;
          isLineReplaced = true;
        }
      }
      
      if (isLineReplaced) replacedCount++;
    });
    
    if (replacedCount) {
      AppState.namesDirty = true;
      AppController.refreshWorkspace(true);
      AppController.renderProofread();
      AppState.queueAutoSave();
      alert(`Berhasil replace ${replacedCount} baris.`);
    } else {
      alert(`Tidak ada yang cocok.`);
    }
  }
}

document.addEventListener("DOMContentLoaded", AppController.init);
