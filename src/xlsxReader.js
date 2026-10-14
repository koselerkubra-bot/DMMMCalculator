// Minimal, dependency-light reader for .xlsx / .xlsm files.
// Runs unchanged in the browser and in Node (tests, CLI). It only decompresses the
// parts that are actually requested, so large legacy trackers stay cheap to read.
// Values are the cached results Excel stored in the file; formulas are kept as text.
import { unzipSync, strFromU8 } from '../vendor/fflate.mjs';

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function decodeXml(s) {
  if (!s || s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITY[e];
  });
}

export function colToNum(col) {
  let n = 0;
  for (const ch of col.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
export function numToCol(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
export function splitRef(ref) {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(ref);
  if (!m) throw new Error(`Invalid cell reference ${ref}`);
  return { col: colToNum(m[1]), row: parseInt(m[2], 10) };
}

function attr(attrs, name) {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? decodeXml(m[1]) : undefined;
}

function textOf(xml) {
  // Concatenate <t> runs, ignoring phonetic runs (<rPh>).
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m;
  while ((m = re.exec(clean))) out += m[1] ? decodeXml(m[1]) : '';
  return out;
}

class Sheet {
  constructor(name, cells, maxRow, maxCol) {
    this.name = name; this.cells = cells; this.maxRow = maxRow; this.maxCol = maxCol;
  }
  _cell(ref) { return this.cells.get(ref.replace(/\$/g, '').toUpperCase()); }
  value(ref) { const c = this._cell(ref); return c ? c.v : null; }
  formula(ref) { const c = this._cell(ref); return c ? c.f : null; }
  at(row, col) { const c = this.cells.get(numToCol(col) + row); return c ? c.v : null; }
  formulaAt(row, col) { const c = this.cells.get(numToCol(col) + row); return c ? c.f : null; }
  row(r, fromCol = 1, toCol = this.maxCol) {
    const out = [];
    for (let c = fromCol; c <= toCol; c++) out.push(this.at(r, c));
    return out;
  }
}

export class Workbook {
  constructor(bytes) {
    this.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const base = this._unzip((n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || n === '[Content_Types].xml');
    if (!base['xl/workbook.xml']) throw new Error('Not an Excel workbook (xl/workbook.xml missing).');
    const wbXml = strFromU8(base['xl/workbook.xml']);
    const relXml = base['xl/_rels/workbook.xml.rels'] ? strFromU8(base['xl/_rels/workbook.xml.rels']) : '';
    const rels = new Map();
    for (const m of relXml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = attr(m[1], 'Id'); let target = attr(m[1], 'Target');
      if (!id || !target) continue;
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      rels.set(id, target);
    }
    this.sheets = [];
    for (const m of wbXml.matchAll(/<sheet\b([^>]*)\/?>/g)) {
      const name = attr(m[1], 'name');
      const rid = attr(m[1], 'r:id');
      const state = attr(m[1], 'state') || 'visible';
      this.sheets.push({ name, path: rels.get(rid), state });
    }
    this.sheetNames = this.sheets.map((s) => s.name);
    this.sharedStrings = [];
    if (base['xl/sharedStrings.xml']) {
      const ss = strFromU8(base['xl/sharedStrings.xml']);
      for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) this.sharedStrings.push(m[1] ? textOf(m[1]) : '');
    }
    this.hasMacros = false;
    if (base['[Content_Types].xml']) this.hasMacros = /vbaProject|macroEnabled/i.test(strFromU8(base['[Content_Types].xml']));
    this._cache = new Map();
  }

  _unzip(filter) {
    return unzipSync(this.bytes, { filter: (f) => filter(f.name) });
  }

  hasSheet(name) { return this.sheetNames.includes(name); }

  sheet(name) {
    if (this._cache.has(name)) return this._cache.get(name);
    const meta = this.sheets.find((s) => s.name === name);
    if (!meta) return null;
    const files = this._unzip((n) => n === meta.path);
    const xml = files[meta.path] ? strFromU8(files[meta.path]) : '';
    const sh = this._parseSheet(name, xml);
    this._cache.set(name, sh);
    return sh;
  }

  _parseSheet(name, xml) {
    const cells = new Map();
    let maxRow = 0, maxCol = 0;
    const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let m;
    while ((m = re.exec(xml))) {
      const inner = m[2];
      if (!inner) continue; // styled but empty cell
      const attrs = m[1];
      const ref = attr(attrs, 'r');
      if (!ref) continue;
      const t = attr(attrs, 't');
      const fm = /<f\b[^>]*>([\s\S]*?)<\/f>/.exec(inner);
      const vm = /<v>([\s\S]*?)<\/v>/.exec(inner);
      let v = null;
      if (t === 's') v = vm ? this.sharedStrings[parseInt(vm[1], 10)] ?? null : null;
      else if (t === 'inlineStr') { const im = /<is>([\s\S]*?)<\/is>/.exec(inner); v = im ? textOf(im[1]) : null; }
      else if (t === 'str') v = vm ? decodeXml(vm[1]) : null;
      else if (t === 'b') v = vm ? vm[1] === '1' : null;
      else if (t === 'e') v = vm ? { error: decodeXml(vm[1]) } : null;
      else if (vm) { const num = Number(vm[1]); v = Number.isFinite(num) ? num : decodeXml(vm[1]); }
      const f = fm ? decodeXml(fm[1]) : null;
      if (v === null && f === null) continue;
      cells.set(ref, { v, f });
      const { row, col } = splitRef(ref);
      if (row > maxRow) maxRow = row;
      if (col > maxCol) maxCol = col;
    }
    return new Sheet(name, cells, maxRow, maxCol);
  }
}

export function openWorkbook(bytes) {
  return new Workbook(bytes);
}
