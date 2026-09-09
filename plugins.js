window.CSTL = window.CSTL || {};
(() => {
'use strict';

CSTL.util = {
  stripNewlines(v) {
    return v == null ? null : String(v).replace(/\r?\n/g, '\\n').trim();
  },
  isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); },
  escapeHtml(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },
  sanitizeName(s, { maxLen = 200, stripTrailing = true, fallback = 'untitled' } = {}) {
    let n = String(s ?? '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
    if (stripTrailing) n = n.replace(/[.\s]+$/, '');
    if (maxLen) n = n.slice(0, maxLen);
    return n || fallback;
  },
  humanBytes(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return '0 B';
    const { KB, MB, GB } = CFG.bytes;
    if (v < KB) return v + ' B';
    if (v < MB) return (v / KB).toFixed(1) + ' KB';
    if (v < GB) return (v / MB).toFixed(2) + ' MB';
    return (v / GB).toFixed(2) + ' GB';
  },
  validDataKey(key) {
    if (typeof key !== 'string' || !key || key.length > 255) return false;
    if (key.includes('/') || key.includes('\\') || key === '.' || key === '..') return false;
    if (/[\x00-\x1f]/.test(key)) return false;
    if (key.endsWith('.tmp')) return false;
    return true;
  }
};
const { stripNewlines, isPlainObject, escapeHtml, humanBytes, validDataKey, sanitizeName } = CSTL.util;
const esc = escapeHtml;

const VERSION = 1;
const MANIFEST_FILE = 'manifest.json';
const ENTRY_FILE = 'plugin.js';
const SETTING_SCOPES = ['global', 'project'];
const BUILTIN_EXTENSIONS = new Set(['.json', '.epub']);

const CFG = {
  bytes: { KB: 1024, MB: 1048576, GB: 1073741824 },
  zip: { tail: 65557, bombFloor: 256 * 1024 * 1024, bombRatio: 400 },
  panel: { defaultHeight: 300 },
  manifest: {
    idMax: 64, nameMax: 120, versionMax: 32, authorMax: 120, descriptionMax: 600,
    magicHexMax: 256, magicTextMaxBytes: 128, magicOffsetMax: 8192,
    uiHeightMin: 60, uiHeightMax: 2000, uiHeightDefault: 300,
  },
  settings: { labelMax: 200, descMax: 600, placeholderMax: 400, optionValueMax: 400 },
  delay: { revokeUrlMs: 10000 },
};

function clampInt(v, min, max, def) {
  v = Number(v);
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, Math.round(v)));
}

function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

const Sha256 = (() => {
  const K = new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);
  const rotr = (n, x) => (x >>> n) | (x << (32 - n));

  return {
    async hex(bytes) {
      if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes || []);
      const view = new Uint8Array(bytes.length + 8 + 64 - ((bytes.length + 8) & 63));
      view.set(bytes);
      view[bytes.length] = 0x80;
      const bitLen = BigInt(bytes.length) * 8n;
      const dv = new DataView(view.buffer);
      dv.setUint32(view.length - 4, Number(bitLen >> 32n), false);
      dv.setUint32(view.length - 8, Number(bitLen & 0xffffffffn), false);
      const H = new Uint32Array([
        0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19
      ]);
      const W = new Uint32Array(64);
      for (let i = 0; i < view.length; i += 64) {
        for (let t = 0; t < 16; t++) W[t] = dv.getUint32(i + t * 4, false);
        for (let t = 16; t < 64; t++) {
          const s0 = rotr(7, W[t-15]) ^ rotr(18, W[t-15]) ^ (W[t-15] >>> 3);
          const s1 = rotr(17, W[t-2]) ^ rotr(19, W[t-2]) ^ (W[t-2] >>> 10);
          W[t] = (W[t-16] + s0 + W[t-7] + s1) | 0;
        }
        let a=H[0],b=H[1],c=H[2],d=H[3],e=H[4],f=H[5],g=H[6],h=H[7];
        for (let t = 0; t < 64; t++) {
          const S1 = rotr(6, e) ^ rotr(11, e) ^ rotr(25, e);
          const ch = (e & f) ^ (~e & g);
          const temp1 = (h + S1 + ch + K[t] + W[t]) | 0;
          const S0 = rotr(2, a) ^ rotr(13, a) ^ rotr(22, a);
          const mj = (a & b) ^ (a & c) ^ (b & c);
          const temp2 = (S0 + mj) | 0;
          h=g; g=f; f=e; e=(d + temp1)|0; d=c; c=b; b=a; a=(temp1 + temp2)|0;
        }
        H[0]=(H[0]+a)|0; H[1]=(H[1]+b)|0; H[2]=(H[2]+c)|0; H[3]=(H[3]+d)|0;
        H[4]=(H[4]+e)|0; H[5]=(H[5]+f)|0; H[6]=(H[6]+g)|0; H[7]=(H[7]+h)|0;
      }
      let out = '';
      for (const v of H) out += v.toString(16).padStart(8, '0');
      return out;
    }
  };
})();

async function sha256HexOfBlob(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  return Sha256.hex(buf);
}

const ZipReader = {
  async open(blob) {
    if (!blob || typeof blob.slice !== 'function' || !Number.isFinite(blob.size)) throw new Error('Invalid package source.');
    const size = blob.size;
    if (size < 22) throw new Error('Invalid or corrupted .zip file.');
    const tailLen = Math.min(size, CFG.zip.tail);
    const tail = new Uint8Array(await blob.slice(size - tailLen).arrayBuffer());
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Invalid or corrupted .zip file.');
    const eocdDv = new DataView(tail.buffer, tail.byteOffset + eocd, 22);
    let count = eocdDv.getUint16(8, true);
    let cdSize = eocdDv.getUint32(12, true);
    let cdOffset = eocdDv.getUint32(16, true);
    const locOff = eocd - 20;
    if (locOff >= 0 && tail[locOff] === 0x50 && tail[locOff + 1] === 0x4b && tail[locOff + 2] === 0x06 && tail[locOff + 3] === 0x07) {
      const locDv = new DataView(tail.buffer, tail.byteOffset + locOff, 20);
      const z64Offset = Number(locDv.getBigUint64(8, true));
      if (Number.isFinite(z64Offset) && z64Offset >= 0 && z64Offset + 56 <= size) {
        const z64 = new Uint8Array(await blob.slice(z64Offset, z64Offset + 56).arrayBuffer());
        if (z64[0] === 0x50 && z64[1] === 0x4b && z64[2] === 0x06 && z64[3] === 0x06) {
          const z64Dv = new DataView(z64.buffer);
          count = Number(z64Dv.getBigUint64(32, true));
          cdSize = Number(z64Dv.getBigUint64(40, true));
          cdOffset = Number(z64Dv.getBigUint64(48, true));
        }
      }
    }
    if (!Number.isFinite(count) || !Number.isFinite(cdSize) || !Number.isFinite(cdOffset) ||
      cdOffset < 0 || cdSize < 0 || cdOffset + cdSize > size) {
      throw new Error('Invalid or corrupted .zip file.');
    }
    const cd = cdSize === 0 ? new Uint8Array(0) : new Uint8Array(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const dv = new DataView(cd.buffer);
    const decoder = new TextDecoder();
    const entries = new Map();
    let pos = 0;
    let seen = 0;
    while (pos + 46 <= cd.length && seen < count) {
      if (dv.getUint32(pos, true) !== 0x02014b50) break;
      const method = dv.getUint16(pos + 10, true);
      let compSize = dv.getUint32(pos + 20, true);
      let uncompSize = dv.getUint32(pos + 24, true);
      const nameLen = dv.getUint16(pos + 28, true);
      const extraLen = dv.getUint16(pos + 30, true);
      const commentLen = dv.getUint16(pos + 32, true);
      let localOffset = dv.getUint32(pos + 42, true);
      const extAttrs = dv.getUint32(pos + 38, true);
      const nameRaw = cd.subarray(pos + 46, pos + 46 + nameLen);
      if (nameRaw.length < nameLen) break;
      let extraPos = pos + 46 + nameLen;
      const extraEnd = Math.min(extraPos + extraLen, cd.length);
      while (extraPos + 4 <= extraEnd) {
        const xid = dv.getUint16(extraPos, true);
        const xsz = dv.getUint16(extraPos + 2, true);
        if (xid === 0x0001 && extraPos + 4 + xsz <= extraEnd) {
          let xp = extraPos + 4;
          const xe = extraPos + 4 + xsz;
          if (uncompSize === 0xFFFFFFFF && xp + 8 <= xe) { uncompSize = Number(dv.getBigUint64(xp, true)); xp += 8; }
          if (compSize === 0xFFFFFFFF && xp + 8 <= xe) { compSize = Number(dv.getBigUint64(xp, true)); xp += 8; }
          if (localOffset === 0xFFFFFFFF && xp + 8 <= xe) { localOffset = Number(dv.getBigUint64(xp, true)); xp += 8; }
        }
        extraPos += 4 + xsz;
      }
      const name = decoder.decode(nameRaw).replace(/^\.+\//, '').replace(/^\/+/, '');
      const mode = extAttrs >>> 16;
      const isDir = !name || name.endsWith('/') || (mode !== 0 && (mode & 0xf000) === 0x4000) || (mode === 0 && (extAttrs & 0x10) !== 0);
      if (!isDir && name && !name.split('/').some(seg => seg === '..' || seg === '')) {
        entries.set(name, { name, method, compSize, uncompSize, localOffset });
      }
      pos += 46 + nameLen + extraLen + commentLen;
      seen++;
    }
    return {
      names() { return Array.from(entries.keys()); },
      has(n) { return entries.has(String(n)); },
      readBytes(n) { return ZipReader._read(blob, entries.get(String(n))); },
      readText(n) { return ZipReader._read(blob, entries.get(String(n))).then(b => new TextDecoder().decode(b)); }
    };
  },

  async _read(blob, e) {
    if (!e) throw new Error('File not found in plugin package.');
    if (e.method !== 0 && e.method !== 8) throw new Error(`Compression method ${e.method} not supported for "${e.name}".`);
    const head = new Uint8Array(await blob.slice(e.localOffset, e.localOffset + 30).arrayBuffer());
    if (head.length < 30 || head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 0x03 || head[3] !== 0x04) {
      throw new Error(`Corrupted package: invalid local header for "${e.name}".`);
    }
    const nameLen = head[26] | (head[27] << 8);
    const extraLen = head[28] | (head[29] << 8);
    const dataStart = e.localOffset + 30 + nameLen + extraLen;
    if (dataStart < 0 || e.compSize < 0 || dataStart + e.compSize > blob.size) {
      throw new Error(`Corrupted package: data "${e.name}" out of bounds.`);
    }
    if (e.method === 0) {
      const out = new Uint8Array(await blob.slice(dataStart, dataStart + e.compSize).arrayBuffer());
      if (e.uncompSize && out.length !== e.uncompSize) throw new Error(`Corrupted package: size mismatch for "${e.name}".`);
      return out;
    }
    const budget = Math.max(CFG.zip.bombFloor, e.compSize * CFG.zip.bombRatio);
    const stream = blob.slice(dataStart, dataStart + e.compSize).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > budget) throw new Error(`"${e.name}" exceeds safe decompression limit (${humanBytes(budget)}). Package is likely corrupted.`);
        chunks.push(value);
      }
    } catch (err) {
      try { reader.cancel(); } catch {}
      throw err;
    }
    if (e.uncompSize && total !== e.uncompSize) throw new Error(`Corrupted package: size mismatch for "${e.name}".`);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }
};

const Manifest = {
  parse(text) {
    let raw;
    try { raw = JSON.parse(text); }
    catch (e) {
      const msg = String(e?.message || e);
      return { ok: false, errors: [`manifest.json isn't valid JSON: ${msg}`] };
    }
    if (!isPlainObject(raw)) {
      return { ok: false, errors: ['manifest.json must contain a JSON object ( { ... } ).'] };
    }
    return { ok: true, data: raw };
  },

  validate(m) {
    const errors = [];
    if (!isPlainObject(m)) return ['manifest must be an object.'];

    if (m.manifest_version === undefined) {
      errors.push(`"manifest_version" required, integer (current: ${VERSION}).`);
    } else if (typeof m.manifest_version !== 'number' || !Number.isInteger(m.manifest_version) || m.manifest_version < 1) {
      errors.push(`"manifest_version" must be a positive integer.`);
    } else if (m.manifest_version > VERSION) {
      errors.push(`"manifest_version" ${m.manifest_version} is newer than this build supports (max: ${VERSION}). Update CSTL to use this plugin.`);
    }

    const idRe = new RegExp(`^[a-z0-9][a-z0-9_-]{0,${CFG.manifest.idMax - 1}}$`);
    if (typeof m.id !== 'string' || !idRe.test(m.id)) {
      errors.push(`"id" required: lowercase letters/numbers/underscore/hyphen, 1-${CFG.manifest.idMax} chars, starting with alphanumeric (e.g. "my-plugin").`);
    }
    if (typeof m.name !== 'string' || !m.name.trim() || m.name.trim().length > CFG.manifest.nameMax) {
      errors.push(`"name" required, 1-${CFG.manifest.nameMax} characters.`);
    }
    if (typeof m.version !== 'string' || !m.version.trim() || m.version.trim().length > CFG.manifest.versionMax) {
      errors.push(`"version" required, 1-${CFG.manifest.versionMax} characters (semver recommended, e.g. "1.0.0").`);
    }
    if (m.author != null && (typeof m.author !== 'string' || m.author.length > CFG.manifest.authorMax)) {
      errors.push(`"author" optional, string max ${CFG.manifest.authorMax} characters.`);
    }
    if (m.description != null && (typeof m.description !== 'string' || m.description.length > CFG.manifest.descriptionMax)) {
      errors.push(`"description" optional, string max ${CFG.manifest.descriptionMax} characters.`);
    }

    if (m.extensions !== undefined) {
      if (!Array.isArray(m.extensions) || !m.extensions.length) {
        errors.push('"extensions" must be a non-empty array (e.g. [".ks"]).');
      } else {
        for (const e of m.extensions) {
          if (typeof e !== 'string' || !/^\.[a-z0-9]{1,16}$/i.test(e)) {
            errors.push(`Invalid extension: ${JSON.stringify(e)}. Must start with a dot followed by 1-16 alphanumeric characters (e.g. ".ks").`);
          }
        }
        const lower = m.extensions.map(e => String(e).toLowerCase());
        for (const b of BUILTIN_EXTENSIONS) {
          if (lower.includes(b)) errors.push(`Extension ${b} is a built-in CSTL format and cannot be claimed by plugins.`);
        }
      }
    }

    if (m.magic !== undefined) {
      if (!Array.isArray(m.magic) || !m.magic.length) {
        errors.push('"magic" must be a non-empty array.');
      } else {
        m.magic.forEach((s, i) => {
          const res = Manifest.validateSig(s);
          if (!res.ok) errors.push(`magic[${i}]: ${res.error}`);
        });
      }
    }

    if (m.ui !== undefined && m.ui !== null) {
      if (!isPlainObject(m.ui)) {
        errors.push('"ui" must be an object { title?, height? }.');
      } else {
        if (m.ui.title != null && (typeof m.ui.title !== 'string' || !m.ui.title.trim() || m.ui.title.length > CFG.settings.labelMax)) {
          errors.push(`ui.title must be a string of 1-${CFG.settings.labelMax} characters.`);
        }
        if (m.ui.height != null && (typeof m.ui.height !== 'number' || !Number.isFinite(m.ui.height) || m.ui.height < CFG.manifest.uiHeightMin || m.ui.height > CFG.manifest.uiHeightMax)) {
          errors.push(`ui.height must be a number ${CFG.manifest.uiHeightMin}-${CFG.manifest.uiHeightMax} (pixels).`);
        }
      }
    }

    if (m.settings !== undefined) {
      const res = Manifest.validateSettings(m.settings);
      for (const e of res) errors.push(e);
    }

    return errors;
  },

  validateSig(s) {
    if (!isPlainObject(s)) return { ok: false, error: 'must be an object { hex } or { text }, plus optional offset.' };
    const hasHex = Object.hasOwn(s, 'hex'), hasText = Object.hasOwn(s, 'text');
    if (hasHex === hasText) return { ok: false, error: 'must have either hex OR text (not both).' };
    if (hasHex) {
      if (typeof s.hex !== 'string') return { ok: false, error: 'hex must be a string.' };
      const h = s.hex.replace(/\s+/g, '');
      if (!h.length || h.length % 2 || h.length > CFG.manifest.magicHexMax || !/^[0-9a-f]+$/i.test(h)) return { ok: false, error: `hex must be even-length hexadecimal, max ${CFG.manifest.magicHexMax / 2} bytes (e.g. "504b0304").` };
    }
    if (hasText) {
      if (typeof s.text !== 'string' || !s.text.length) return { ok: false, error: 'text must be a non-empty string.' };
      if (new TextEncoder().encode(s.text).length > CFG.manifest.magicTextMaxBytes) return { ok: false, error: `text max ${CFG.manifest.magicTextMaxBytes} bytes.` };
    }
    if (s.offset != null && (!Number.isInteger(s.offset) || s.offset < 0 || s.offset > CFG.manifest.magicOffsetMax)) {
      return { ok: false, error: `offset must be an integer 0-${CFG.manifest.magicOffsetMax}.` };
    }
    return { ok: true };
  },

  validateSettings(raw) {
    if (!isPlainObject(raw)) return ['"settings" must be an object { global?, project? }.'];
    const errors = [];
    for (const k of Object.keys(raw)) {
      if (!SETTING_SCOPES.includes(k)) errors.push(`Unknown key "settings.${k}". Only "global" and "project" are allowed.`);
    }
    for (const scope of SETTING_SCOPES) {
      const arr = raw[scope];
      if (arr === undefined) continue;
      if (!Array.isArray(arr)) { errors.push(`"settings.${scope}" must be an array.`); continue; }
      errors.push(...Manifest.validateSettingList(arr, `settings.${scope}`));
    }
    return errors;
  },

  validateSettingList(raw, at) {
    const errors = [];
    const seen = new Set();
    const types = ['string', 'number', 'boolean', 'select', 'textarea'];
    raw.forEach((s, i) => {
      const a = `${at}[${i}]`;
      if (!isPlainObject(s)) { errors.push(`${a}: must be an object.`); return; }
      if (typeof s.key !== 'string' || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s.key)) {
        errors.push(`${a}.key: must be a valid variable name (e.g. "maxDepth").`); return;
      }
      if (seen.has(s.key)) { errors.push(`${a}.key: key "${s.key}" duplicate.`); return; }
      seen.add(s.key);
      if (typeof s.label !== 'string' || !s.label.trim() || s.label.length > CFG.settings.labelMax) errors.push(`${a}.label: required, 1-${CFG.settings.labelMax} characters.`);
      const type = s.type ?? 'string';
      if (!types.includes(type)) errors.push(`${a}.type: must be one of ${types.join(', ')}.`);
      if (s.description != null && (typeof s.description !== 'string' || s.description.length > CFG.settings.descMax)) errors.push(`${a}.description: max ${CFG.settings.descMax} characters.`);
      if (s.placeholder != null && (typeof s.placeholder !== 'string' || s.placeholder.length > CFG.settings.placeholderMax)) errors.push(`${a}.placeholder: max ${CFG.settings.placeholderMax} characters.`);
      if (type === 'select') {
        if (!Array.isArray(s.options) || !s.options.length) {
          errors.push(`${a}.options: required for select type (at least 1 option).`);
        } else {
          for (const o of s.options) {
            const val = isPlainObject(o) ? o.value : o;
            if (typeof val !== 'string' || !val.length || val.length > CFG.settings.optionValueMax) {
              errors.push(`${a}.options: each option must be a string ≤ ${CFG.settings.optionValueMax} characters (or { value, label }).`); break;
            }
          }
        }
      }
      if (type === 'number') {
        for (const k of ['min', 'max', 'step']) {
          if (s[k] != null && typeof s[k] !== 'number') errors.push(`${a}.${k}: must be a number.`);
        }
      }
    });
    return errors;
  },

  normalize(m, files, extra) {
    const settings = Manifest.normalizeSettings(m.settings);
    const magic = (m.magic || []).map(s => Manifest.normalizeSig(s)).filter(Boolean);
    const ui = isPlainObject(m.ui) ? {
      ...(typeof m.ui.title === 'string' && m.ui.title.trim() ? { title: m.ui.title.trim().slice(0, CFG.settings.labelMax) } : {}),
      ...(typeof m.ui.height === 'number' && Number.isFinite(m.ui.height) ? { height: clampInt(m.ui.height, CFG.manifest.uiHeightMin, CFG.manifest.uiHeightMax, CFG.manifest.uiHeightDefault) } : {})
    } : null;
    return Object.assign({
      manifest_version: m.manifest_version,
      id: m.id,
      name: m.name.trim(),
      version: m.version.trim(),
      author: (m.author || '').trim(),
      description: (m.description || '').trim(),
      extensions: (m.extensions || []).map(e => String(e).toLowerCase()),
      magic,
      ui: ui && Object.keys(ui).length ? ui : null,
      settings,
      files,
      enabled: true
    }, extra || {});
  },

  normalizeSig(s) {
    if (!Manifest.validateSig(s).ok) return null;
    const offset = Number.isInteger(s.offset) && s.offset >= 0 ? s.offset : 0;
    if (Object.hasOwn(s, 'hex')) {
      return { hex: s.hex.replace(/\s+/g, '').toLowerCase(), offset };
    }
    return { hex: Array.from(new TextEncoder().encode(s.text), b => b.toString(16).padStart(2, '0')).join(''), offset };
  },

  normalizeSettings(raw) {
    const out = { global: [], project: [] };
    if (!isPlainObject(raw)) return out;
    for (const scope of SETTING_SCOPES) {
      if (Array.isArray(raw[scope])) out[scope] = Manifest.normalizeSettingList(raw[scope]);
    }
    return out;
  },

  normalizeSettingList(raw) {
    const out = [];
    for (const s of raw) {
      if (!isPlainObject(s)) continue;
      if (typeof s.key !== 'string' || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s.key)) continue;
      if (typeof s.label !== 'string' || !s.label.trim()) continue;
      const type = ['string', 'number', 'boolean', 'select', 'textarea'].includes(s.type) ? s.type : 'string';
      const def = type === 'number' ? (Number(s.default) || 0)
        : type === 'boolean' ? !!s.default
        : String(s.default ?? '');
      const entry = { key: s.key, label: s.label.trim().slice(0, CFG.settings.labelMax), type, default: def };
      if (type === 'select' && Array.isArray(s.options)) {
        entry.options = s.options.map(o => isPlainObject(o)
          ? { value: String(o.value).slice(0, CFG.settings.optionValueMax), label: String(o.label ?? o.value).slice(0, CFG.settings.optionValueMax) }
          : { value: String(o).slice(0, CFG.settings.optionValueMax), label: String(o).slice(0, CFG.settings.optionValueMax) });
      }
      if (type === 'number') {
        if (typeof s.min === 'number') entry.min = s.min;
        if (typeof s.max === 'number') entry.max = s.max;
        if (typeof s.step === 'number') entry.step = s.step;
      }
      if (typeof s.placeholder === 'string') entry.placeholder = s.placeholder.slice(0, CFG.settings.placeholderMax);
      if (typeof s.description === 'string') entry.description = s.description.slice(0, CFG.settings.descMax);
      out.push(entry);
    }
    return out;
  }
};

const Dialogs = {
  _active: null,
  _seq: 0,

  _create({ title, bodyHtml, confirmLabel, cancelLabel, danger, wide, hideCancel }) {
    return new Promise(resolve => {
      if (Dialogs._active) { resolve(null); return; }
      const overlay = document.createElement('div');
      overlay.className = 'backdrop cstl-dialog';
      overlay.innerHTML = `
        <div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
          <div class="modal-head"><h3>${esc(title)}</h3></div>
          <div class="modal-body cstl-dialog-body">${bodyHtml}</div>
          <div class="modal-actions">
            ${hideCancel ? '' : `<button type="button" class="btn btn-ghost cstl-dialog-cancel">${esc(cancelLabel || 'Cancel')}</button>`}
            <span class="grow"></span>
            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'} cstl-dialog-ok">${esc(confirmLabel || 'OK')}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      Dialogs._active = overlay;

      let settled = false;
      const finish = val => {
        if (settled) return;
        settled = true;
        Dialogs._active = null;
        observer.disconnect();
        overlay.classList.remove('open');
        resolve(val);
        setTimeout(() => { try { overlay.remove(); } catch {} }, 320);
      };
      const observer = new MutationObserver(() => {
        if (!overlay.classList.contains('open')) finish(null);
      });
      observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });

      overlay.querySelector('.cstl-dialog-cancel')?.addEventListener('click', () => finish(null));
      overlay.querySelector('.cstl-dialog-ok').addEventListener('click', () => finish(true));
      requestAnimationFrame(() => {
        overlay.classList.add('open');
        const focusEl = danger && !hideCancel
          ? overlay.querySelector('.cstl-dialog-cancel')
          : overlay.querySelector('.cstl-dialog-ok');
        focusEl?.focus({ preventScroll: true });
      });
    });
  },

  confirm(opts) {
    return Dialogs._create({ ...opts, danger: !!opts.danger });
  },

  info(title, bodyHtml) {
    return Dialogs._create({
      title,
      bodyHtml,
      confirmLabel: 'Close',
      danger: false,
      hideCancel: true
    });
  },

  prompt({ title, bodyHtml = '', value = '', placeholder = '', confirmLabel, cancelLabel }) {
    return new Promise(resolve => {
      const id = 'cstl-prompt-input-' + (++Dialogs._seq);
      const inputHtml = `<input id="${id}" class="input w-full" type="text" autocomplete="off" />`;
      const fullBody = `${bodyHtml ? `<p class="hint m-0 mb-2">${bodyHtml}</p>` : ''}${inputHtml}`;
      Dialogs._create({
        title,
        bodyHtml: fullBody,
        confirmLabel: confirmLabel || 'OK',
        cancelLabel: cancelLabel || 'Cancel',
        danger: false,
        wide: false
      }).then(ok => {
        if (!ok) { resolve(null); return; }
        const input = document.getElementById(id);
        resolve(input ? input.value : '');
      });
      requestAnimationFrame(() => {
        const overlay = Dialogs._active;
        if (!overlay) return;
        const input = overlay.querySelector('#' + id);
        if (!input) return;
        input.value = String(value ?? '');
        if (placeholder) input.placeholder = placeholder;
        input.focus();
        input.select();
        input.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            overlay.querySelector('.cstl-dialog-ok')?.click();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            overlay.querySelector('.cstl-dialog-cancel')?.click();
          }
        });
      });
    });
  }
};

CSTL.dialogs = Dialogs;

const WasmRunner = {
  _moduleCache: new Map(),

  async moduleFor(bytes) {
    const key = fnv1a(bytes) + ':' + bytes.length;
    const cached = WasmRunner._moduleCache.get(key);
    if (cached) {
      WasmRunner._moduleCache.delete(key);
      WasmRunner._moduleCache.set(key, cached);
      return cached;
    }
    let mod;
    try { mod = await WebAssembly.compile(bytes); }
    catch (e) { throw new Error('WASM module compilation failed: ' + (e?.message || e)); }
    WasmRunner._moduleCache.set(key, mod);
    return mod;
  },

  async instantiate(source, imports) {
    const bytes = source instanceof Uint8Array ? source
      : source instanceof ArrayBuffer ? new Uint8Array(source)
      : null;
    if (!bytes) throw new Error('WASM source must be Uint8Array or ArrayBuffer (get it from api.asset()).');
    const mod = await WasmRunner.moduleFor(bytes);
    const result = await WebAssembly.instantiate(mod, imports || {});
    return result;
  }
};

const Downloads = {
  _el: null,
  _hostEl: null,
  _bytesEl: null,
  _fillEl: null,
  _timer: null,
  _active: false,
  _refcount: 0,

  _ensure() {
    if (Downloads._el) return;
    const el = document.createElement('div');
    el.className = 'net-progress';
    el.innerHTML = '<div class="np-row"><div class="np-spin"></div><div class="np-text"><div class="np-host"></div><div class="np-bytes"></div></div></div><div class="np-bar"><div class="np-fill"></div></div>';
    document.body.appendChild(el);
    Downloads._el = el;
    Downloads._hostEl = el.querySelector('.np-host');
    Downloads._bytesEl = el.querySelector('.np-bytes');
    Downloads._fillEl = el.querySelector('.np-fill');
  },

  start(hostname, total) {
    Downloads._ensure();
    const wasIdle = Downloads._refcount === 0;
    Downloads._refcount++;
    if (Downloads._timer) clearTimeout(Downloads._timer);
    Downloads._timer = setTimeout(() => {
      Downloads._timer = null;
      Downloads._active = true;
      if (wasIdle || !Downloads._hostEl.textContent) {
        Downloads._hostEl.textContent = hostname || 'downloading';
      }
      Downloads._bytesEl.textContent = total ? '0 / ' + humanBytes(total) : '0 B';
      Downloads._fillEl.style.width = total ? '0%' : '35%';
      Downloads._fillEl.classList.toggle('determinate', !!total);
      Downloads._el.classList.add('open');
    }, 350);
  },

  progress(received, total) {
    if (!Downloads._active) return;
    if (total) {
      Downloads._bytesEl.textContent = humanBytes(received) + ' / ' + humanBytes(total);
      Downloads._fillEl.style.width = Math.min(100, (received / total) * 100) + '%';
    } else {
      Downloads._bytesEl.textContent = humanBytes(received);
    }
  },

  end() {
    if (Downloads._refcount > 0) Downloads._refcount--;
    if (Downloads._refcount > 0) return;
    if (Downloads._timer) { clearTimeout(Downloads._timer); Downloads._timer = null; }
    if (!Downloads._active) return;
    Downloads._active = false;
    if (Downloads._el) Downloads._el.classList.remove('open');
  }
};

const NetRunner = {
  async fetch(rawUrl, opts, inst) {
    const o = isPlainObject(opts) ? opts : {};
    let u;
    try { u = new URL(String(rawUrl)); }
    catch { throw new Error('Invalid URL.'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error(`Unsupported URL scheme: ${u.protocol} (only http: and https: are allowed).`);
    }
    const method = (typeof o.method === 'string' ? o.method : 'GET').toUpperCase();
    const headers = isPlainObject(o.headers) ? { ...o.headers } : {};
    const body = o.body == null ? null
      : typeof o.body === 'string' ? o.body
      : o.body instanceof Uint8Array ? o.body
      : o.body instanceof ArrayBuffer ? new Uint8Array(o.body)
      : isPlainObject(o.body) ? JSON.stringify(o.body) : null;
    const as = o.as === 'bytes' ? 'bytes' : 'text';
    const silent = !!o.silent;
    const ctrl = new AbortController();
    if (inst) inst.aborts.add(ctrl);
    let res;
    try {
      res = await fetch(u.href, { method, headers, body, signal: ctrl.signal, redirect: 'follow' });
    } catch (err) {
      if (inst) inst.aborts.delete(ctrl);
      throw new Error('Request failed: ' + (err?.name === 'AbortError' ? 'aborted' : (err?.message || String(err))));
    }
    const headersOut = {};
    res.headers.forEach((v, k) => {
      const lk = k.toLowerCase();
      headersOut[lk] = headersOut[lk] != null ? headersOut[lk] + ', ' + v : v;
    });
    const clRaw = res.headers.get('content-length');
    const total = clRaw != null && Number.isFinite(+clRaw) ? +clRaw : null;
    const showProgress = !silent && (total == null || total >= 100 * 1024);
    if (showProgress) Downloads.start(u.hostname, total);
    let received = 0;
    let buf;
    try {
      const reader = res.body?.getReader();
      if (reader) {
        const chunks = [];
        while (true) {
          const r = await reader.read();
          if (r.done) break;
          if (r.value) {
            chunks.push(r.value);
            received += r.value.length;
            if (showProgress) Downloads.progress(received, total);
          }
        }
        buf = new Uint8Array(received);
        let off = 0;
        for (const c of chunks) { buf.set(c, off); off += c.length; }
      } else {
        buf = new Uint8Array(await res.arrayBuffer());
      }
    } catch (err) {
      ctrl.abort();
      if (showProgress) Downloads.end();
      throw new Error('Stream interrupted: ' + (err?.message || String(err)));
    } finally {
      if (inst) inst.aborts.delete(ctrl);
    }
    if (showProgress) Downloads.end();
    if (as === 'bytes') {
      return { ok: res.ok, status: res.status, statusText: res.statusText, url: res.url, headers: headersOut, body: buf };
    }
    return { ok: res.ok, status: res.status, statusText: res.statusText, url: res.url, headers: headersOut, body: new TextDecoder('utf-8').decode(buf) };
  }
};

let host = null;
let ui = null;

const Runtime = {
  _index: [],
  _instances: new Map(),
  _sigCache: new WeakMap(),
  _hooks: new Map(),
  _importers: new Map(),
  _exporters: new Map(),
  _shortcuts: new Map(),
  _toolbarButtons: [],
  _dashboardCards: [],
  _styles: new Map(),

  listMeta() { return Runtime._index.slice(); },
  getMeta(id) { return Runtime._index.find(p => p.id === id) || null; },

  hook(name, fn, inst) {
    if (typeof name !== 'string' || !name || typeof fn !== 'function') return null;
    if (!Runtime._hooks.has(name)) Runtime._hooks.set(name, []);
    const entry = { fn, inst: inst || null };
    Runtime._hooks.get(name).push(entry);
    return { name, entry };
  },

  unhook(token) {
    if (!token || typeof token !== 'object') return;
    const arr = Runtime._hooks.get(token.name);
    if (!arr) return;
    const i = arr.indexOf(token.entry);
    if (i >= 0) arr.splice(i, 1);
  },

  async runHooks(name, ...args) {
    const arr = Runtime._hooks.get(name);
    if (!arr || !arr.length) return args;
    for (const entry of arr.slice()) {
      try {
        const r = await entry.fn(...args);
        if (r !== undefined) args[0] = r;
      } catch (e) { Runtime._fail(entry.inst?.meta, e); }
    }
    return args;
  },

  runHooksSync(name, value, ...rest) {
    const arr = Runtime._hooks.get(name);
    if (!arr || !arr.length) return value;
    for (const entry of arr.slice()) {
      try {
        const r = entry.fn(value, ...rest);
        if (r !== undefined) value = r;
      } catch (e) { Runtime._fail(entry.inst?.meta, e); }
    }
    return value;
  },

  clearHooksFor(inst) {
    for (const [name, arr] of Runtime._hooks) {
      Runtime._hooks.set(name, arr.filter(e => e.inst !== inst));
    }
  },

  registerImporter(name, handler, inst) {
    if (typeof name !== 'string' || !name || typeof handler !== 'function') return null;
    Runtime._importers.set(name, { handler, inst });
    host.ui.onPluginsChanged();
    return name;
  },

  unregisterImporter(name) {
    if (Runtime._importers.delete(name)) host.ui.onPluginsChanged();
  },

  registerExporter(name, handler, inst) {
    if (typeof name !== 'string' || !name || typeof handler !== 'function') return null;
    Runtime._exporters.set(name, { handler, inst });
    host.ui.onPluginsChanged();
    return name;
  },

  unregisterExporter(name) {
    if (Runtime._exporters.delete(name)) host.ui.onPluginsChanged();
  },

  listImporters() { return Array.from(Runtime._importers.keys()); },
  getImporter(name) { return Runtime._importers.get(name) || null; },

  listExporters() { return Array.from(Runtime._exporters.keys()); },
  getExporter(name) { return Runtime._exporters.get(name) || null; },

  registerShortcut(id, label, combo, handler, opts, inst) {
    if (typeof id !== 'string' || !id || typeof handler !== 'function') return null;
    Runtime._shortcuts.set(id, { id, label, combo: combo || '', handler, opts: opts || {}, inst });
    host.ui.rebuildShortcuts();
    return id;
  },

  unregisterShortcut(id) {
    if (Runtime._shortcuts.delete(id)) host.ui.rebuildShortcuts();
  },

  listPluginShortcuts() {
    return Array.from(Runtime._shortcuts.values());
  },

  addToolbarButton(label, onClick, opts, inst) {
    const btn = host.ui.addToolbarButton(label, onClick, opts);
    if (btn) Runtime._toolbarButtons.push({ btn, inst });
    return btn;
  },

  removeToolbarButton(btn) {
    host.ui.removeToolbarButton(btn);
    const i = Runtime._toolbarButtons.findIndex(e => e.btn === btn);
    if (i >= 0) Runtime._toolbarButtons.splice(i, 1);
  },

  clearToolbarButtonsFor(inst) {
    for (let i = Runtime._toolbarButtons.length - 1; i >= 0; i--) {
      if (Runtime._toolbarButtons[i].inst === inst) {
        host.ui.removeToolbarButton(Runtime._toolbarButtons[i].btn);
        Runtime._toolbarButtons.splice(i, 1);
      }
    }
  },

  createModal(title, bodyHtml, opts, inst) {
    const modal = host.ui.createModal(title, bodyHtml, opts);
    if (modal && inst) {
      if (!inst.modals) inst.modals = [];
      inst.modals.push(modal);
    }
    return modal;
  },

  closeModal(modal) {
    if (!modal) return;
    host.ui.closeModal(modal);
  },

  addDashboardCard(cardEl, inst) {
    const ok = host.ui.addDashboardCard(cardEl);
    if (ok) Runtime._dashboardCards.push({ card: cardEl, inst });
    return ok ? cardEl : null;
  },

  removeDashboardCard(cardEl) {
    host.ui.removeDashboardCard(cardEl);
    const i = Runtime._dashboardCards.findIndex(e => e.card === cardEl);
    if (i >= 0) Runtime._dashboardCards.splice(i, 1);
  },

  clearDashboardCardsFor(inst) {
    for (let i = Runtime._dashboardCards.length - 1; i >= 0; i--) {
      if (Runtime._dashboardCards[i].inst === inst) {
        host.ui.removeDashboardCard(Runtime._dashboardCards[i].card);
        Runtime._dashboardCards.splice(i, 1);
      }
    }
  },

  setTheme(vars) {
    host.ui.setTheme(vars);
  },

  injectStyle(css, id, inst) {
    const existing = id ? Runtime._styles.get(id) : null;
    if (existing) {
      existing.el.textContent = css;
      existing.inst = inst;
      return existing.el;
    }
    const el = host.ui.injectStyle(css, id);
    if (el && id) Runtime._styles.set(id, { el, inst });
    return el;
  },

  removeStyle(id) {
    const entry = Runtime._styles.get(id);
    if (entry) { entry.el.remove(); Runtime._styles.delete(id); }
  },

  clearStylesFor(inst) {
    for (const [id, entry] of Runtime._styles) {
      if (entry.inst === inst) { entry.el.remove(); Runtime._styles.delete(id); }
    }
  },

  async persistPluginIndex() { await host.storage.writePluginIndex(Runtime._index); },

  async loadGlobalPluginSettings() {
    const raw = await host.storage.readGlobalPluginSettings();
    const store = isPlainObject(raw) ? raw : {};
    for (const k of Object.keys(store)) {
      if (!isPlainObject(store[k])) delete store[k];
    }
    Runtime._store = store;
  },

  async saveGlobalPluginSettings() {
    try { await host.storage.writeGlobalPluginSettings(Runtime._store); }
    catch (e) { console.error('[plugins] failed to save settings:', e); }
  },

  async init() {
    await Runtime.loadGlobalPluginSettings();
    const raw = await host.storage.readPluginIndex();
    const list = Array.isArray(raw) ? raw : [];
    const valid = [];
    const dropped = [];
    for (const p of list) {
      if (!p || typeof p.id !== 'string' || !Array.isArray(p.files)) {
        dropped.push(p?.id || '<unknown>');
        continue;
      }
      valid.push(p);
    }
    if (dropped.length) {
      console.warn(`[plugins] dropped ${dropped.length} plugin(s) with invalid metadata: ${dropped.join(', ')}.`);
    }
    Runtime._index = valid;
    await Runtime._sweepOrphanPacks();
    if (dropped.length) await Runtime.persistPluginIndex();
    await Runtime.sync();
    let dirty = false;
    for (const meta of Runtime._index) {
      if (meta.enabled !== true) continue;
      try { await Runtime.activatePlugin(meta); }
      catch (e) {
        console.error(`[plugin:${meta.id}] failed to activate:`, e);
        meta.enabled = false;
        dirty = true;
      }
    }
    if (dirty) await Runtime.persistPluginIndex();
    host.ui.onPluginsChanged();
  },

  async sync() {
    let changed = false;
    const alive = [];
    for (const meta of Runtime._index) {
      try {
        const exists = await host.storage.pluginInstalled(meta.id);
        if (exists) alive.push(meta);
        else { await Runtime.deactivatePlugin(meta.id); changed = true; }
      } catch {
        await Runtime.deactivatePlugin(meta.id);
        changed = true;
      }
    }
    if (!changed) return false;
    Runtime._index = alive;
    await Runtime.persistPluginIndex();
    host.ui.onPluginsChanged();
    return true;
  },

  async _sweepOrphanPacks() {
    const ids = await host.storage.listInstalledPluginIds();
    const installed = new Set(Runtime._index.map(p => p.id));
    for (const id of ids) {
      if (installed.has(id)) continue;
      await host.storage.deletePlugin(id);
    }
  },

  projectSettingsFor(meta) {
    const vals = host.state.pluginSettings();
    const v = (vals && typeof vals === 'object' && vals[meta.id]) ? vals[meta.id] : {};
    const out = {};
    for (const s of (meta.settings?.project || [])) out[s.key] = (s.key in v) ? v[s.key] : s.default;
    return out;
  },

  globalSettingsFor(meta) {
    const v = isPlainObject(Runtime._store[meta.id]) ? Runtime._store[meta.id] : {};
    const out = {};
    for (const s of (meta.settings?.global || [])) out[s.key] = (s.key in v) ? v[s.key] : s.default;
    return out;
  },

  setProjectPluginSettings(id, values) {
    const next = { ...(host.state.pluginSettings() || {}) };
    if (isPlainObject(values) && Object.keys(values).length) next[id] = values;
    else delete next[id];
    host.state.setPluginSettings(next);
    host.state.queueSave();
    Runtime.syncSettings();
  },

  setGlobalPluginSettings(id, values) {
    if (isPlainObject(values) && Object.keys(values).length) Runtime._store[id] = values;
    else delete Runtime._store[id];
    Runtime.saveGlobalPluginSettings();
    Runtime.syncSettings();
  },

  syncSettings() {
    for (const inst of Runtime._instances.values()) {
      if (typeof inst.onSettings === 'function') {
        try {
          inst.onSettings({
            settings: Runtime.projectSettingsFor(inst.meta),
            globalSettings: Runtime.globalSettingsFor(inst.meta)
          });
        } catch (e) { Runtime._fail(inst.meta, e); }
      }
    }
  },

  async activatePlugin(meta) {
    if (Runtime._instances.has(meta.id)) return;
    const code = await host.storage.readPluginCode(meta.id);

    host.util.progress.show('Loading plugin...', `Activating "${meta.name}"...`);
    let inst;
    try {
      const factory = new Function('module', 'exports', 'CSTL', 'document', 'window',
        '"use strict";\n' + code + '\n;return module.exports;');
      const mod = { exports: {} };
      const pluginObj = factory(mod, mod.exports, CSTL, document, window);
      if (!pluginObj || typeof pluginObj !== 'object') throw new Error("Plugin doesn't export an object (module.exports).");

      inst = {
        meta,
        pluginObj,
        aborts: new Set(),
        menuItems: [],
        settingsSections: [],
        panelCard: null,
        panelBody: null,
        listeners: new Map(),
        onSettings: typeof pluginObj.onSettings === 'function' ? pluginObj.onSettings.bind(pluginObj) : null,
        hasExtract: typeof pluginObj.extract === 'function',
        hasPack: typeof pluginObj.pack === 'function',
        hasPanel: typeof pluginObj.panel === 'function',
        hasOnCopy: typeof pluginObj.onCopy === 'function',
        hasOnApply: typeof pluginObj.onApply === 'function',
      };

      const api = Runtime._buildApi(inst);
      inst.api = api;

      if (typeof pluginObj.activate === 'function') {
        Runtime._instances.set(meta.id, inst);
        try {
          await pluginObj.activate.call(pluginObj, api);
        } catch (e) {
          Runtime._instances.delete(meta.id);
          throw e;
        }
      } else {
        Runtime._instances.set(meta.id, inst);
      }

      if (meta.ui && inst.hasPanel) {
        const panelHostEl = PluginUI.panelHost(meta);
        if (panelHostEl) {
          PluginUI.wirePanel(inst, panelHostEl);
        }
      }
    } catch (e) {
      if (inst) {
        await Runtime.deactivatePlugin(meta.id);
      }
      host.util.progress.hide();
      throw e;
    }
    host.util.progress.hide();
    Runtime.syncSettings();
  },

  async deactivatePlugin(id) {
    const inst = Runtime._instances.get(id);
    if (!inst) return;
    Runtime._instances.delete(id);
    try {
      if (typeof inst.pluginObj.deactivate === 'function') {
        await inst.pluginObj.deactivate.call(inst.pluginObj);
      }
    } catch (e) { console.error(`[plugin:${id}] deactivate error:`, e); }
    inst.listeners.clear();
    for (const ctrl of inst.aborts) { try { ctrl.abort(); } catch {} }
    inst.aborts.clear();
    for (const el of inst.menuItems) { try { host.ui.removeMenuItem(el); } catch {} }
    inst.menuItems.length = 0;
    for (const entry of inst.settingsSections) { try { host.ui.removeSettingsSection(entry); } catch {} }
    inst.settingsSections.length = 0;
    if (inst.panelCard) { try { inst.panelCard.remove(); } catch {} }
    if (inst.modals) { for (const m of inst.modals) { try { host.ui.closeModal(m); } catch {} } inst.modals.length = 0; }
    Runtime.clearHooksFor(inst);
    Runtime.clearToolbarButtonsFor(inst);
    Runtime.clearDashboardCardsFor(inst);
    Runtime.clearStylesFor(inst);
    for (const [name, entry] of Runtime._importers) if (entry.inst === inst) Runtime._importers.delete(name);
    for (const [name, entry] of Runtime._exporters) if (entry.inst === inst) Runtime._exporters.delete(name);
    for (const [sid, entry] of Runtime._shortcuts) if (entry.inst === inst) { Runtime._shortcuts.delete(sid); }
    host.ui.rebuildShortcuts();
    host.ui.onPluginsChanged();
  },

  async setEnabled(id, enabled) {
    const meta = Runtime.getMeta(id);
    if (!meta) return false;
    if (enabled) {
      try { await Runtime.activatePlugin(meta); }
      catch (e) {
        await Dialogs.info("Couldn't activate plugin", `<p class="hint m-0">${esc(`Plugin "${meta.name}" failed to activate.`)}</p><p class="mono cstl-err-detail">${esc(e?.message || String(e))}</p>`);
        PluginUI.renderList();
        return false;
      }
    } else {
      await Runtime.deactivatePlugin(id);
    }
    meta.enabled = !!enabled;
    await Runtime.persistPluginIndex();
    host.ui.onPluginsChanged();
    return true;
  },

  async install(file) {
    if (!file || typeof file.slice !== 'function' || typeof file.stream !== 'function' || typeof file.arrayBuffer !== 'function') throw new Error('Invalid plugin file.');
    const name = String(file.name || '');
    if (!/\.zip$/i.test(name)) throw new Error('Plugins must be .zip files with manifest.json and plugin.js at the root.');

    host.util.progress.show('Checking plugin package...', 'Reading manifest.json...');

    let meta, manifestText, pluginCode, assetFiles;
    try {
      const zip = await ZipReader.open(file).catch(() => { throw new Error('Invalid or corrupted .zip file.'); });
      if (!zip.has(MANIFEST_FILE)) {
        throw new Error(`${MANIFEST_FILE} not found at package root. Standard structure: .zip containing ${MANIFEST_FILE} + ${ENTRY_FILE}.`);
      }
      manifestText = await zip.readText(MANIFEST_FILE);

      const parsed = Manifest.parse(manifestText);
      if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
      const errors = Manifest.validate(parsed.data);
      if (errors.length) throw new Error('Invalid manifest:\n- ' + errors.join('\n- '));
      const manifest = parsed.data;

      if (!zip.has(ENTRY_FILE)) throw new Error(`${ENTRY_FILE} not found at package root. It is required as the entry point.`);
      pluginCode = await zip.readText(ENTRY_FILE);

      const assetNames = zip.names().filter(nm => nm !== MANIFEST_FILE && nm !== ENTRY_FILE).sort();
      assetFiles = [];
      for (const nm of assetNames) {
        assetFiles.push([nm, await zip.readBytes(nm)]);
      }

      const fingerprint = await sha256HexOfBlob(file);
      meta = Manifest.normalize(manifest, assetNames, {
        fingerprint,
        size: file.size,
        updatedAt: Date.now()
      });
    } finally {
      host.util.progress.hide();
    }

    const existing = Runtime.getMeta(meta.id);

    host.util.progress.show('Installing plugin...', 'Extracting files...');
    try {
      await host.storage.installPluginFiles(meta.id, manifestText, pluginCode, assetFiles);
      meta.enabled = existing ? existing.enabled === true : true;
      const i = Runtime._index.findIndex(p => p.id === meta.id);
      if (i >= 0) Runtime._index[i] = meta; else Runtime._index.push(meta);

      await Runtime.deactivatePlugin(meta.id);
      if (meta.enabled) {
        try {
          await Runtime.activatePlugin(meta);
        } catch (e) {
          meta.enabled = false;
          host.ui.flash(`Plugin "${meta.name}" failed to activate: ${e?.message || e}`);
        }
      }
      await Runtime.persistPluginIndex();
      host.ui.onPluginsChanged();
      if (existing) host.ui.flash(`Plugin "${meta.name}" updated to v${meta.version}.`);
      return meta;
    } finally {
      host.util.progress.hide();
    }
  },

  async uninstall(id) {
    const meta = Runtime.getMeta(id);
    if (!meta) throw new Error('Plugin not found.');
    const linked = (await host.storage.listProjects()).filter(p => p.projectType === 'plugin' && p.pluginId === id);
    const linkedNote = linked.length
      ? `<p>${linked.length} linked project(s) remain saved with their data. Just reinstall this plugin to reopen them. Data is only deleted when the project is deleted.</p>`
      : '';
    const ok = await Dialogs.confirm({
      title: 'Delete plugin?',
      danger: true,
      confirmLabel: 'Delete',
      bodyHtml: `<p>Plugin <strong>${esc(meta.name)}</strong> v${esc(meta.version)} will be deleted.</p>${linkedNote}`
    });
    if (!ok) return false;

    await Runtime.deactivatePlugin(id);
    for (const p of linked) {
      try {
        const data = await host.storage.loadProject(p.id);
        if (data && !data.pluginName) {
          data.pluginName = meta.name;
          await host.storage.saveProject(p.id, data);
        }
      } catch (e) {
        console.error(`[plugin:${id}] failed to preserve pluginName for project ${p.id}:`, e);
      }
    }
    await host.storage.deletePlugin(id);
    delete Runtime._store[id];
    await Runtime.saveGlobalPluginSettings();
    Runtime._index = Runtime._index.filter(p => p.id !== id);
    await Runtime.persistPluginIndex();
    host.ui.onPluginsChanged();
    return true;
  },

  _buildApi(inst) {
    const meta = inst.meta;
    const api = {
      version: VERSION,
      pluginId: meta.id,
      get settings() { return Runtime.projectSettingsFor(meta); },
      get globalSettings() { return Runtime.globalSettingsFor(meta); },

      getProject: () => host.state.projectInfo(),
      getLines: () => host.state.lines().map(Runtime.toPluginLine),
      getSelection: () => host.state.selection(),
      selectRange: (from, to) => {
        const f = Number(from), t = Number(to);
        if (!Number.isInteger(f) || !Number.isInteger(t) || f < 1 || t < f) throw new Error('Invalid line range.');
        host.state.selectRangeUI(f, t);
      },
      clearSelection: () => host.state.clearSelection(),
      copySelection: () => host.state.copyForAi(),

      listAssets: () => meta.files.slice(),
      asset: async path => host.storage.readPluginAssetBytes(meta.id, String(path ?? '')),
      assetText: async path => host.storage.readPluginAssetText(meta.id, String(path ?? '')),

      toast: msg => host.ui.flash(String(msg ?? '')),
      copy: text => host.util.clipboard(String(text ?? '')),
      pickFile: accept => Runtime.pickFile(accept),
      download: (data, filename) => Runtime.download(data, filename),
      fetch: (url, opts) => NetRunner.fetch(url, opts, inst),

      get JSZip() { return window.JSZip; },
      get gpu() { return navigator.gpu; },
      wasm: (source, imports) => WasmRunner.instantiate(source, imports),

      saveData: (key, data) => {
        if (!validDataKey(key)) throw new Error('Invalid data key.');
        if (!host.state.projectId()) throw new Error('Open a project first to save data.');
        return host.storage.savePluginData(meta.id, key, data);
      },
      loadData: key => {
        if (!validDataKey(key)) return null;
        if (!host.state.projectId()) return null;
        return host.storage.loadPluginData(meta.id, key);
      },
      deleteData: key => {
        if (!validDataKey(key)) return;
        if (!host.state.projectId()) return;
        return host.storage.deletePluginData(meta.id, key);
      },
      listData: () => {
        if (!host.state.projectId()) return [];
        return host.storage.listPluginData(meta.id);
      },
      dataExists: key => {
        if (!validDataKey(key)) return false;
        if (!host.state.projectId()) return false;
        return host.storage.pluginDataExists(meta.id, key);
      },

      decode: (buf, encodings) => {
        const bytes = buf instanceof Uint8Array ? buf : buf instanceof ArrayBuffer ? new Uint8Array(buf) : null;
        if (!bytes) throw new Error('decode accepts Uint8Array or ArrayBuffer.');
        const encs = Array.isArray(encodings) && encodings.length ? encodings : ['utf-8', 'shift_jis', 'windows-31j', 'cp932'];
        for (const enc of encs) {
          try { return new TextDecoder(enc, { fatal: true }).decode(bytes); } catch {}
        }
        return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      },

      addMenuItem: (menu, label, onClick) => {
        const el = host.ui.addMenuItem(menu, label, onClick);
        inst.menuItems.push(el);
        return el;
      },
      removeMenuItem: el => {
        host.ui.removeMenuItem(el);
        const i = inst.menuItems.indexOf(el);
        if (i >= 0) inst.menuItems.splice(i, 1);
      },
      addSettingsSection: (target, title, hooks) => {
        const entry = host.ui.addSettingsSection(target, title, hooks);
        inst.settingsSections.push(entry);
        return entry;
      },
      removeSettingsSection: entry => {
        host.ui.removeSettingsSection(entry);
        const i = inst.settingsSections.indexOf(entry);
        if (i >= 0) inst.settingsSections.splice(i, 1);
      },
      ui: name => host.ui.getRegion(name),

      on: (event, handler) => Runtime._subscribe(inst, event, handler),
      off: token => Runtime._unsubscribe(inst, token),
      emit: (event, payload) => Runtime.emit(event, payload),

      hook: (name, fn) => Runtime.hook(name, fn, inst),
      unhook: token => Runtime.unhook(token),

      registerImporter: (name, handler) => Runtime.registerImporter(name, handler, inst),
      unregisterImporter: name => Runtime.unregisterImporter(name),
      registerExporter: (name, handler) => Runtime.registerExporter(name, handler, inst),
      unregisterExporter: name => Runtime.unregisterExporter(name),

      registerShortcut: (id, label, combo, handler, opts) => Runtime.registerShortcut(id, label, combo, handler, opts, inst),
      unregisterShortcut: id => Runtime.unregisterShortcut(id),

      addToolbarButton: (label, onClick, opts) => Runtime.addToolbarButton(label, onClick, opts, inst),
      removeToolbarButton: btn => Runtime.removeToolbarButton(btn),

      createModal: (title, bodyHtml, opts) => Runtime.createModal(title, bodyHtml, opts, inst),
      closeModal: modal => Runtime.closeModal(modal),

      addDashboardCard: cardEl => Runtime.addDashboardCard(cardEl, inst),
      removeDashboardCard: cardEl => Runtime.removeDashboardCard(cardEl),

      setTheme: vars => Runtime.setTheme(vars),
      injectStyle: (css, id) => Runtime.injectStyle(css, id, inst),
      removeStyle: id => Runtime.removeStyle(id),

      getState: () => host.state.snapshot(),
      getStorage: () => host.storage.root(),
      getPluginMeta: () => ({ ...meta }),

      getLine: num => {
        const l = host.state.lineByNum(num);
        return l ? Runtime.toPluginLine(l) : null;
      },
      updateLine: (num, changes) => host.state.updateLine(num, changes),
      addLine: line => host.state.addLine(line),
      removeLine: num => host.state.removeLine(num),
      markTranslated: (num, transMsg, transName) => host.state.markTranslated(num, transMsg, transName),

      prompt: (title, def) => host.ui.prompt(title, def),
      confirm: (title, body) => host.ui.confirm(title, body),
      alert: (title, body) => host.ui.alert(title, body),

      abort: () => {
        for (const ctrl of inst.aborts) { try { ctrl.abort(); } catch {} }
        inst.aborts.clear();
      }
    };
    return api;
  },

  _subscribe(inst, event, handler) {
    if (typeof event !== 'string' || !event || typeof handler !== 'function') return null;
    if (!inst.listeners.has(event)) inst.listeners.set(event, new Set());
    inst.listeners.get(event).add(handler);
    return { event, handler };
  },

  _unsubscribe(inst, token) {
    if (!token || typeof token !== 'object') return;
    const set = inst.listeners.get(token.event);
    if (set) set.delete(token.handler);
  },

  pickFile(accept) {
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file';
      if (accept && typeof accept === 'string') inp.accept = accept;
      inp.style.display = 'none';
      document.body.appendChild(inp);
      let settled = false;
      const finish = val => {
        if (settled) return;
        settled = true;
        inp.remove();
        resolve(val);
      };
      inp.addEventListener('change', async () => {
        const f = inp.files && inp.files[0];
        if (!f) return finish(null);
        try { finish({ name: f.name, buffer: await f.arrayBuffer() }); }
        catch { finish(null); }
      });
      inp.addEventListener('cancel', () => finish(null));
      inp.click();
    });
  },

  download(data, filename) {
    let blob = data instanceof Blob ? data : null;
    if (!blob) {
      const body = (data instanceof Uint8Array || data instanceof ArrayBuffer) ? data : String(data ?? '');
      blob = new Blob([body], { type: 'application/octet-stream' });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeName(filename, { stripTrailing: false, fallback: 'download' });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), CFG.delay.revokeUrlMs);
  },

  resolveByExtension(fileName) {
    const name = String(fileName || '');
    const dot = name.lastIndexOf('.');
    if (dot < 0) return null;
    const ext = name.slice(dot).toLowerCase();
    return Runtime._index.find(p => p.enabled === true && (p.extensions || []).some(e => String(e).toLowerCase() === ext)) || null;
  },

  resolveByMagic(head) {
    if (!(head instanceof Uint8Array) || !head.length) return null;
    for (const p of Runtime._index) {
      if (p.enabled !== true || !(p.magic || []).length) continue;
      let sigs = Runtime._sigCache.get(p);
      if (!sigs) {
        sigs = p.magic.map(raw => {
          const bytes = new Uint8Array(raw.hex.length / 2);
          for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(raw.hex.slice(i * 2, i * 2 + 2), 16);
          return { bytes, offset: raw.offset || 0 };
        });
        Runtime._sigCache.set(p, sigs);
      }
      for (const sig of sigs) {
        if (sig.offset + sig.bytes.length <= head.length && sig.bytes.every((b, i) => head[sig.offset + i] === b)) return p;
      }
    }
    return null;
  },

  activeParserInfo() {
    const exts = new Set(BUILTIN_EXTENSIONS);
    let magic = false;
    for (const p of Runtime._index) {
      if (p.enabled !== true) continue;
      for (const e of (p.extensions || [])) exts.add(String(e).toLowerCase());
      if ((p.magic || []).length) magic = true;
    }
    return { extensions: exts, magic };
  },

  _hookCtx() {
    const info = host.state.projectInfo();
    return {
      projectName: info?.name || null,
      lineCount: info?.lineCount || 0,
      translatedCount: info?.translatedCount || 0,
      selectedLines: host.state.selection()
    };
  },

  async runCopyHook(text) {
    let out = text;
    for (const inst of Runtime._instances.values()) {
      if (!inst.hasOnCopy) continue;
      try {
        const r = await inst.pluginObj.onCopy.call(inst.pluginObj, out, Runtime._hookCtx());
        if (typeof r === 'string') out = r;
      } catch (e) { Runtime._fail(inst.meta, e); }
    }
    return out;
  },

  async runApplyHook(text) {
    let out = text;
    for (const inst of Runtime._instances.values()) {
      if (!inst.hasOnApply) continue;
      try {
        const r = await inst.pluginObj.onApply.call(inst.pluginObj, out, Runtime._hookCtx());
        if (typeof r === 'string') out = r;
      } catch (e) { Runtime._fail(inst.meta, e); }
    }
    return out;
  },

  emit(event, payload) {
    for (const inst of Runtime._instances.values()) {
      const set = inst.listeners.get(event);
      if (!set) continue;
      for (const handler of set) {
        try { handler(payload); } catch (e) { Runtime._fail(inst.meta, e); }
      }
    }
  },

  async callExtract(meta, input) {
    const inst = Runtime._instances.get(meta.id);
    if (!inst) throw new Error(`Plugin "${meta.name}" isn't active.`);
    if (!inst.hasExtract) throw new Error(`Plugin "${meta.name}" doesn't support extract.`);
    const out = await inst.pluginObj.extract.call(inst.pluginObj, {
      fileName: input.fileName,
      buffer: input.buffer,
      settings: Runtime.projectSettingsFor(meta),
      globalSettings: Runtime.globalSettingsFor(meta),
      api: inst.api
    });
    if (!out || !Array.isArray(out.lines)) throw new Error(`Plugin "${meta.name}" didn't return a lines array.`);
    return out;
  },

  async callPack(meta, input) {
    const inst = Runtime._instances.get(meta.id);
    if (!inst) throw new Error(`Plugin "${meta.name}" isn't active.`);
    if (!inst.hasPack) throw new Error(`Plugin "${meta.name}" doesn't support pack.`);
    const out = await inst.pluginObj.pack.call(inst.pluginObj, {
      lines: input.lines,
      sourceMap: input.sourceMap,
      projectName: input.projectName,
      settings: Runtime.projectSettingsFor(meta),
      globalSettings: Runtime.globalSettingsFor(meta),
      api: inst.api
    });
    if (!out || !(out.blob instanceof Blob)) throw new Error(`Plugin "${meta.name}" didn't return a valid blob.`);
    return out;
  },

  normalizePluginLines(raw, startNum) {
    const out = [];
    let n = startNum;
    for (const l of (raw || [])) {
      if (!l || typeof l !== 'object') continue;
      const msg = String(l.message ?? '').trim();
      if (!msg) continue;
      out.push({
        line_num: n++,
        file: String(l.file || ''),
        name: l.name == null ? null : stripNewlines(l.name),
        message: msg.replace(/\r?\n/g, '\\n').trim(),
        trans_name: null,
        trans_message: null,
        is_translated: false,
        _n: 1
      });
    }
    return out;
  },

  toPluginLine(l) {
    return {
      line_num: l.line_num,
      file: l.file,
      name: l.name,
      message: l.message,
      trans_name: l.trans_name,
      trans_message: l.trans_message,
      is_translated: !!l.is_translated
    };
  },

  onProjectOpened() {
    Runtime.syncSettings();
    host.ui.onPluginsChanged();
    const info = host.state.projectInfo();
    Runtime.emit('projectOpen', info ? {
      name: info.name, type: info.type, lineCount: info.lineCount, translatedCount: info.translatedCount
    } : null);
  },

  onProjectClosed() {
    Runtime.emit('projectClose', null);
    Runtime.syncSettings();
    host.ui.onPluginsChanged();
  },

  _fail(meta, e) {
    console.error(`[plugin:${meta?.id || '?'}]`, e);
    host.ui.flash(`Plugin "${meta?.name || '?'}" error: ${e?.message || e}`);
  }
};

const PluginUI = {

  bind() {
    ui.btnPluginManagerOpen.addEventListener('click', PluginUI.openManager);
    ui.btnPluginManagerClose.addEventListener('click', PluginUI.closeManager);
    ui.btnPluginRefresh.addEventListener('click', async () => {
      await Runtime.sync();
      PluginUI.renderList();
      host.ui.flash('Plugin list reloaded.');
    });
    ui.btnInstallPlugin.addEventListener('click', () => ui.pluginFileInput.click());
    ui.pluginFileInput.addEventListener('change', async e => {
      if (!e.target.files.length) { e.target.value = ''; return; }
      try { await PluginUI.installFlow(e.target.files[0]); }
      finally { e.target.value = ''; }
    });

    const list = ui.pluginList;
    if (list) {
      list.addEventListener('dragover', e => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          list.classList.add('dragover');
        }
      });
      list.addEventListener('dragleave', e => {
        if (e.target === list) list.classList.remove('dragover');
      });
      list.addEventListener('drop', async e => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        list.classList.remove('dragover');
        for (const f of Array.from(e.dataTransfer.files)) {
          if (/\.zip$/i.test(f.name)) {
            await PluginUI.installFlow(f);
            break;
          }
        }
      });
    }
  },

  async openManager() {
    await Runtime.sync();
    ui.pluginManagerModal.classList.add('open');
    PluginUI.renderList();
  },

  closeManager() {
    ui.pluginManagerModal.classList.remove('open');
  },

  async installFlow(file) {
    try {
      const meta = await Runtime.install(file);
      if (!meta) return;
      PluginUI.renderList();
      host.ui.onShortcutListMaybeRender();
      host.ui.flash(`Plugin "${meta.name}" v${meta.version} ${meta.enabled ? 'active' : 'installed (disabled)'}.`);
    } catch (e) {
      await Dialogs.info("Couldn't install plugin",
        `<p class="hint m-0">${esc(e?.message || String(e))}</p>`);
    }
  },

  renderList() {
    const container = ui.pluginList;
    if (!container) return;
    const plugins = Runtime.listMeta();
    container.replaceChildren();
    if (!plugins.length) {
      container.innerHTML = `
        <div class="plugin-empty">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 5h4.5a2.5 2.5 0 1 1 5 0H19v4.5a2.5 2.5 0 1 1 0 5V19h-4.5a2.5 2.5 0 1 0-5 0H5v-4.5a2.5 2.5 0 1 0 0-5z"/></svg>
          <span>No plugins installed yet.</span>
          <span class="plugin-empty-sub">Import the ZIP or drag it here.</span>
        </div>`;
      return;
    }
    const frag = document.createDocumentFragment();
    for (const p of plugins) frag.appendChild(PluginUI.buildCard(p));
    container.appendChild(frag);
  },

  buildCard(p) {
    const row = document.createElement('div');
    row.className = 'plugin-row' + (p.enabled ? ' is-enabled' : '');

    const parserBadge = (p.extensions?.length || p.magic?.length)
      ? `<span class="plugin-badge plugin-badge-parser" title="Handles custom format import/export">Parser ${esc(p.extensions.join(' '))}${p.magic?.length ? ' +magic' : ''}</span>`
      : '';
    const panelBadge = p.ui ? '<span class="plugin-badge plugin-badge-panel" title="Provides a UI panel in the Tools panel">Panel</span>' : '';
    const totalSettings = (p.settings?.global?.length || 0) + (p.settings?.project?.length || 0);
    const settingsBadges = totalSettings
      ? `<span class="plugin-badge plugin-badge-settings" title="Settings available">Settings · ${totalSettings}</span>`
      : '';
    const assetsBadge = p.files.length
      ? `<span class="plugin-badge plugin-badge-package" title="${esc(p.files.join('\n'))}">Asset · ${p.files.length}</span>`
      : '';

    const detail = `
      <div class="plugin-detail">
        <div class="plugin-detail-grid">
          <div>
            <div class="plugin-detail-label">Package info</div>
            <div class="plugin-detail-kv"><span>Manifest</span><span>v${esc(String(p.manifest_version))}</span></div>
            <div class="plugin-detail-kv"><span>Size</span><span>${esc(humanBytes(p.size))}</span></div>
            <div class="plugin-detail-kv"><span>Installed</span><span>${esc(new Date(p.updatedAt || Date.now()).toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span></div>
            ${p.fingerprint ? `<div class="plugin-detail-kv is-stack"><span>SHA-256</span><code class="plugin-detail-fp" title="Click to copy">${esc(p.fingerprint)}</code></div>` : ''}
          </div>
          <div>
            ${p.files.length ? `<div class="plugin-detail-label">Package files (${p.files.length})</div><div class="plugin-detail-files">${p.files.map(f => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
          </div>
        </div>
      </div>`;

    row.innerHTML = `
      <div class="plugin-head">
        <div class="plugin-head-main">
          <span class="plugin-name">${esc(p.name)}</span>
          <span class="plugin-version">v${esc(p.version)}</span>
        </div>
        <label class="switch" title="${p.enabled ? 'Disable' : 'Enable'} plugin">
          <input type="checkbox" class="plugin-toggle" ${p.enabled ? 'checked' : ''} />
          <span class="switch-track"></span>
        </label>
      </div>
      ${p.author || p.description ? `
      <div class="plugin-meta">
        ${p.author ? `<span class="plugin-author">by ${esc(p.author)}</span>` : ''}
        ${p.description ? `<span class="plugin-desc-inline">${esc(p.description)}</span>` : ''}
      </div>` : ''}
      ${parserBadge || panelBadge || settingsBadges || assetsBadge ? `<div class="plugin-badges">${[parserBadge, panelBadge, settingsBadges, assetsBadge].filter(Boolean).join('')}</div>` : ''}
      <div class="plugin-actions">
        <button type="button" class="btn btn-ghost btn-xs btn-plugin-details" aria-expanded="false">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          Detail
        </button>
        ${(p.settings?.global?.length || (p.settings?.project?.length && host.state.projectId())) ? `<button type="button" class="btn btn-ghost btn-xs btn-plugin-settings" title="Plugin settings">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
          Settings
        </button>` : ''}
        <button type="button" class="btn btn-ghost btn-xs btn-uninstall-plugin" title="Delete plugin">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1.4 14.1A2 2 0 0 1 15.6 22H8.4a2 2 0 0 1-2-1.9L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>
          Delete
        </button>
      </div>
      ${detail}`;

    row.querySelector('.plugin-toggle').addEventListener('change', async e => {
      const ok = await Runtime.setEnabled(p.id, e.target.checked);
      if (ok) PluginUI.renderList();
      else e.target.checked = !e.target.checked;
    });

    row.querySelector('.btn-plugin-details').addEventListener('click', e => {
      const btn = e.currentTarget;
      const expanded = row.classList.toggle('show-detail');
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    });

    row.querySelector('.btn-plugin-settings')?.addEventListener('click', () => {
      const scope = p.settings?.global?.length ? 'global' : 'project';
      PluginUI.openSettings(p, scope);
    });

    row.querySelector('.btn-uninstall-plugin').addEventListener('click', async () => {
      try {
        const ok = await Runtime.uninstall(p.id);
        if (ok) {
          row.classList.add('is-removing');
          setTimeout(() => {
            PluginUI.renderList();
            host.ui.loadDashboard();
            host.ui.onShortcutListMaybeRender();
            host.ui.flash(`Plugin "${p.name}" deleted.`);
          }, 280);
        }
      } catch (e) {
        await Dialogs.info("Couldn't delete plugin", `<p class="hint m-0">${esc(e?.message || String(e))}</p>`);
      }
    });

    row.querySelector('.plugin-detail-fp')?.addEventListener('click', async () => {
      try { await host.util.clipboard(p.fingerprint || ''); host.ui.flash('Fingerprint copied.'); } catch {}
    });

    return row;
  },

  panelHost(meta) {
    const wrap = ui.pluginPanels;
    if (!wrap) return null;
    const cfg = meta.ui || {};
    const card = document.createElement('div');
    card.className = 'plugin-panel-card open';
    card.dataset.pluginId = meta.id;
    card.innerHTML = `
      <button class="plugin-panel-head" type="button">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>
        <span class="plugin-panel-title">${esc(cfg.title || meta.name)}</span>
        <svg class="plugin-panel-chevron" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <div class="plugin-panel-body" style="--plugin-panel-height:${cfg.height || CFG.panel.defaultHeight}px"></div>`;
    wrap.appendChild(card);
    return { card, body: card.querySelector('.plugin-panel-body') };
  },

  wirePanel(inst, hostEl) {
    inst.panelCard = hostEl.card;
    inst.panelBody = hostEl.body;
    hostEl.card.querySelector('.plugin-panel-head').addEventListener('click', () => {
      if (hostEl.card.classList.toggle('open')) PluginUI.panelShow(inst);
    });
    PluginUI.panelShow(inst);
  },

  panelShow(inst) {
    if (!inst.hasPanel || !inst.panelBody) return;
    try {
      inst.pluginObj.panel.call(inst.pluginObj, inst.panelBody, inst.api);
    } catch (e) { Runtime._fail(inst.meta, e); }
  },

  _fieldRow(meta, s, values) {
    const row = document.createElement('div');
    row.className = 'plugin-settings-row';
    const id = `pluginSetting_${meta.id}_${s.key}`;
    const cur = values[s.key];
    const type = s.type;
    let inputHtml;
    if (type === 'boolean') {
      inputHtml = `<label class="check-line"><input id="${id}" type="checkbox" ${cur ? 'checked' : ''}/> ${esc(s.label)}</label>`;
    } else if (type === 'select') {
      const opts = (s.options || []).map(o => `<option value="${esc(o.value)}" ${String(cur) === o.value ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
      inputHtml = `<select id="${id}" class="input w-full">${opts}</select>`;
    } else if (type === 'textarea') {
      inputHtml = `<textarea id="${id}" class="textarea w-full" rows="4" placeholder="${esc(s.placeholder || '')}">${esc(String(cur ?? ''))}</textarea>`;
    } else if (type === 'number') {
      inputHtml = `<input id="${id}" class="input w-full" type="number" value="${esc(String(cur ?? ''))}" ${s.min != null ? `min="${esc(String(s.min))}"` : ''} ${s.max != null ? `max="${esc(String(s.max))}"` : ''} ${s.step != null ? `step="${esc(String(s.step))}"` : ''}/>`;
    } else {
      inputHtml = `<input id="${id}" class="input w-full" type="text" value="${esc(String(cur ?? ''))}" placeholder="${esc(s.placeholder || '')}"/>`;
    }
    const descHtml = s.description ? `<span class="plugin-settings-desc">${esc(s.description)}</span>` : '';
    const labelHtml = type === 'boolean' ? '' : `<label for="${id}" class="plugin-settings-label">${esc(s.label)}${descHtml}</label>`;
    row.innerHTML = `<div class="plugin-settings-cell">${labelHtml}${inputHtml}${type === 'boolean' ? descHtml : ''}</div>`;
    return row;
  },

  _readFields(meta, fields) {
    const out = {};
    for (const s of fields) {
      const el = document.getElementById(`pluginSetting_${meta.id}_${s.key}`);
      if (!el) continue;
      if (s.type === 'boolean') out[s.key] = !!el.checked;
      else if (s.type === 'number') {
        if (el.value === '') out[s.key] = s.default;
        else { const n = Number(el.value); out[s.key] = Number.isFinite(n) ? n : s.default; }
      }
      else out[s.key] = el.value;
    }
    return out;
  },

  _resetFields(meta, fields) {
    for (const s of fields) {
      const el = document.getElementById(`pluginSetting_${meta.id}_${s.key}`);
      if (!el) continue;
      if (s.type === 'boolean') el.checked = !!s.default;
      else el.value = String(s.default ?? '');
    }
  },

  openSettings(meta, scope) {
    const ownFields = (scope === 'global') ? meta.settings?.global : meta.settings?.project;
    const hasOwn = Array.isArray(ownFields) && ownFields.length > 0;
    if (!hasOwn) {
      host.ui.flash("This plugin doesn't have settings.");
      return;
    }
    if (scope === 'project' && !host.state.projectId()) {
      host.ui.flash('Open a project first to change settings.');
      return;
    }
    const ownMerged = scope === 'global' ? Runtime.globalSettingsFor(meta) : Runtime.projectSettingsFor(meta);
    const form = document.createElement('div');
    form.className = 'plugin-settings-form';
    const ownWrap = document.createElement('div');
    ownWrap.className = 'plugin-settings-own';
    for (const s of ownFields) ownWrap.appendChild(PluginUI._fieldRow(meta, s, ownMerged));
    form.appendChild(ownWrap);

    const overlay = document.createElement('div');
    overlay.className = 'backdrop backdrop-top';
    overlay.innerHTML = `
      <div class="modal modal-wide" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>Settings: ${esc(meta.name)}</h3></div>
        <div class="modal-body"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost btn-plugin-settings-reset">Reset Default</button>
          <span class="grow"></span>
          <button class="btn btn-ghost btn-plugin-settings-cancel">Cancel</button>
          <button class="btn btn-primary btn-plugin-settings-save">Save</button>
        </div>
      </div>`;
    const body = overlay.querySelector('.modal-body');
    const scopeHint = document.createElement('p');
    scopeHint.className = 'hint m-0 mt-1 mb-2';
    if (scope === 'project') {
      const pn = host.state.projectName() || 'this one';
      scopeHint.textContent = `Only applies to project "${pn}".`;
    } else {
      scopeHint.textContent = 'Applies to all projects.';
    }
    body.append(scopeHint, form);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));

    let settled = false;
    const close = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      overlay.classList.remove('open');
      overlay.remove();
    };
    const observer = new MutationObserver(() => {
      if (!overlay.classList.contains('open')) close();
    });
    observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });

    overlay.querySelector('.btn-plugin-settings-cancel').addEventListener('click', close);
    overlay.querySelector('.btn-plugin-settings-reset').addEventListener('click', () => {
      PluginUI._resetFields(meta, ownFields);
    });
    overlay.querySelector('.btn-plugin-settings-save').addEventListener('click', () => {
      if (scope === 'global') Runtime.setGlobalPluginSettings(meta.id, PluginUI._readFields(meta, ownFields));
      else Runtime.setProjectPluginSettings(meta.id, PluginUI._readFields(meta, ownFields));
      close();
      host.ui.flash(`Settings for "${meta.name}" saved.`);
    });
  }
};

CSTL.plugins = {
  attach(bridge) {
    host = bridge;
    const g = id => document.getElementById(id);
    ui = {
      pluginManagerModal: g('pluginManagerModal'),
      btnPluginManagerOpen: g('btnPluginManagerOpen'),
      btnPluginManagerClose: g('btnPluginManagerClose'),
      btnPluginRefresh: g('btnPluginRefresh'),
      btnInstallPlugin: g('btnInstallPlugin'),
      pluginFileInput: g('pluginFileInput'),
      pluginList: g('pluginList'),
      pluginPanels: g('pluginPanels')
    };
    PluginUI.bind();
  },

  async init() { return Runtime.init(); },
  async sync() { return Runtime.sync(); },
  getMeta(id) { return Runtime.getMeta(id); },
  projectSettingsFor(meta) { return Runtime.projectSettingsFor(meta); },
  activeParserInfo() { return Runtime.activeParserInfo(); },
  resolveByExtension(name) { return Runtime.resolveByExtension(name); },
  resolveByMagic(head) { return Runtime.resolveByMagic(head); },
  async callExtract(meta, input) { return Runtime.callExtract(meta, input); },
  async callPack(meta, input) { return Runtime.callPack(meta, input); },
  abort(meta) {
    const inst = Runtime._instances.get(meta.id);
    if (inst) {
      for (const ctrl of inst.aborts) { try { ctrl.abort(); } catch {} }
      inst.aborts.clear();
    }
  },
  normalizePluginLines(raw, startNum) { return Runtime.normalizePluginLines(raw, startNum); },
  toPluginLine(l) { return Runtime.toPluginLine(l); },
  async runCopyHook(text) { return Runtime.runCopyHook(text); },
  async runApplyHook(text) { return Runtime.runApplyHook(text); },
  emit(event, payload) { return Runtime.emit(event, payload); },
  onProjectOpened() { return Runtime.onProjectOpened(); },
  onProjectClosed() { return Runtime.onProjectClosed(); },

  async runHooks(name, ...args) { return Runtime.runHooks(name, ...args); },
  runHooksSync(name, value, ...rest) { return Runtime.runHooksSync(name, value, ...rest); },

  listImporters() { return Runtime.listImporters(); },
  getImporter(name) { return Runtime.getImporter(name); },
  listExporters() { return Runtime.listExporters(); },
  getExporter(name) { return Runtime.getExporter(name); },
  listPluginShortcuts() { return Runtime.listPluginShortcuts(); }
};

})();
