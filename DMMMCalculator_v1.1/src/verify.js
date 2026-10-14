// Reads an exported tracker back and proves every figure that appears in more than one place
// is identical to the Results tab (regional tabs, Lighthouses, country tabs, Validation Queue).
import { openWorkbook } from './xlsxReader.js';
import { regionalViews, countrySheetName } from './trackerExport.js';

function headerIndex(sheet, row) {
  const m = new Map();
  for (let c = 1; c <= sheet.maxCol; c++) { const v = sheet.at(row, c); if (v !== null) m.set(String(v), c); }
  return m;
}

function rowsUnder(sheet, headerRow) {
  const out = [];
  for (let r = headerRow + 1; r <= sheet.maxRow; r++) {
    const market = sheet.at(r, 3);
    if (market === null || market === 'AVG' || market === 'n') break;
    out.push(r);
  }
  return out;
}

const same = (a, b) => (a === null && b === null) || (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b);

export function verifyTracker(bytes, rows) {
  const wb = openWorkbook(bytes);
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });

  const res = wb.sheet('Results');
  const rh = headerIndex(res, 4);
  const resRows = rowsUnder(res, 4);
  add('Results has one row per active country + BU', resRows.length === rows.length, `${resRows.length} rows, expected ${rows.length}`);
  const keyOf = (sh, r, h) => `${sh.at(r, h.get('Country ID'))}|${sh.at(r, h.get('BU'))}`;
  const resByKey = new Map(resRows.map((r) => [keyOf(res, r, rh), r]));
  add('No duplicate country + BU in Results', resByKey.size === resRows.length);

  const compareSheet = (name, headerRows) => {
    const sh = wb.sheet(name);
    if (!sh) { add(`${name} exists`, false); return; }
    let n = 0; const bad = [];
    for (const hr of headerRows) {
      const h = headerIndex(sh, hr);
      for (const r of rowsUnder(sh, hr)) {
        const rr = resByKey.get(keyOf(sh, r, h));
        if (!rr) { bad.push(`row ${r} not in Results`); continue; }
        for (const [label, c] of h) {
          const rc = rh.get(label);
          if (!rc) continue;
          if (!same(sh.at(r, c), res.at(rr, rc))) bad.push(`${sh.at(r, 3)} "${label}": ${sh.at(r, c)} vs Results ${res.at(rr, rc)}`);
        }
        n++;
      }
    }
    add(`${name} matches Results`, bad.length === 0, bad.length ? bad.slice(0, 5).join('; ') : `${n} rows identical`);
  };
  for (const v of regionalViews(rows)) {
    const sh = wb.sheet(v.sheet);
    const headerRows = [];
    if (sh) for (let r = 1; r <= sh.maxRow; r++) if (sh.at(r, 1) === 'Region' && sh.at(r, 3) === 'Market') headerRows.push(r);
    compareSheet(v.sheet, headerRows);
  }
  if (rows.some((r) => r.lighthouse)) compareSheet('Lighthouses', [4]);

  let ctBad = [];
  for (const r of rows.filter((x) => !x.needs_choice)) {
    const sh = wb.sheet(countrySheetName(r));
    const rr = resByKey.get(`${r.identity.country_id}|${r.business_unit}`);
    if (!sh || !rr) { ctBad.push(`${countrySheetName(r)} missing`); continue; }
    const pairs = [[2, '2026 Self Current'], [3, '2026 Validated Current'], [4, '2027 Target Maturity']];
    for (const [c, label] of pairs) if (!same(sh.at(5, c), res.at(rr, rh.get(label)))) ctBad.push(`${sh.name} ${label}: ${sh.at(5, c)} vs ${res.at(rr, rh.get(label))}`);
  }
  add('Country tabs match Results', ctBad.length === 0, ctBad.slice(0, 5).join('; ') || `${rows.filter((x) => !x.needs_choice).length} country tabs identical`);

  const vq = wb.sheet('Validation Queue');
  const expected = rows.filter((x) => !x.needs_choice).reduce((a, r) => a + r.gdm.rows.size, 0);
  let vqn = 0; for (let r = 5; r <= vq.maxRow; r++) if (vq.at(r, 1)) vqn++;
  add('Validation Queue lists every GDM-managed row', vqn === expected, `${vqn} rows, expected ${expected}`);
  return { ok: checks.every((c) => c.ok), checks };
}
