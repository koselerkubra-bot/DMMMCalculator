// Imports 2022-2025 results from the legacy Global Tracker and reconciles the same figure
// across the tracker's tabs. The legacy file is read only; nothing in it is recalculated.
import { openWorkbook, numToCol } from './xlsxReader.js';
import { norm, compact, parseNumber, isBlank, sha256Hex, nowIso } from './util.js';

function classifyHeader(label, model) {
  const m = /^\s*(20\d\d)\s+(.+?)\s*$/.exec(String(label ?? ''));
  if (!m) return null;
  const year = Number(m[1]);
  const rest = compact(m[2]);
  const h = model.history;
  if (h.overall_labels.target.some((x) => compact(x) === rest)) return { year, measure: 'overall_target' };
  if (h.overall_labels.current.some((x) => compact(x) === rest)) return { year, measure: 'overall_current' };
  for (const cap of model.capabilities) {
    if (cap.history_goal_labels.some((x) => compact(x) === rest)) return { year, measure: 'cap_goal', capability_id: cap.id };
  }
  for (const cap of model.capabilities) {
    if (cap.history_labels.some((x) => compact(x) === rest)) return { year, measure: 'cap_current', capability_id: cap.id };
  }
  return null;
}

/** Returns all data rows of every "Region | BU | Market" block in a sheet. */
function readBlocks(sheet, model, resolver) {
  const out = [];
  const issues = [];
  let header = null;
  for (let r = 1; r <= sheet.maxRow; r++) {
    const a = norm(sheet.at(r, 1)), c = norm(sheet.at(r, 3));
    if (a === 'REGION' && c === 'MARKET') {
      header = [];
      for (let col = 4; col <= Math.min(sheet.maxCol, 200); col++) {
        const cls = classifyHeader(sheet.at(r, col), model);
        if (cls) header.push({ col, ...cls, label: String(sheet.at(r, col)).trim() });
      }
      continue;
    }
    if (!header) continue;
    const market = sheet.at(r, 3);
    if (isBlank(market) || typeof market === 'number') continue;
    if (isBlank(sheet.at(r, 1))) continue; // totals / averages / notes have no Region
    const mk = norm(market);
    if (/^(TOTAL|AVG|AVERAGE|#)/.test(mk) || /DID NOT/.test(mk)) continue;
    const buRaw = sheet.at(r, 2);
    const res = resolver.resolveCountry(market);
    const bu = resolver.normalizeBU(buRaw).bu || res.buHint;
    if (!res.country || !bu) {
      issues.push({ sheet: sheet.name, row: r, market, message: res.issue || `Business unit "${buRaw ?? ''}" not recognised` });
      continue;
    }
    const key = `${res.country.country_id}|${bu}`;
    const values = [];
    for (const h of header) {
      const raw = sheet.at(r, h.col);
      const v = parseNumber(raw);
      if (v === null) continue;
      values.push({ year: h.year, measure: h.measure, capability_id: h.capability_id || null, value: v, label: h.label, cell: `${numToCol(h.col)}${r}` });
    }
    out.push({ key, market_raw: String(market), region_raw: sheet.at(r, 1), lighthouse: /\*/.test(String(market)), row: r, values });
  }
  return { rows: out, issues };
}

const measureKey = (v) => `${v.year}|${v.measure}|${v.capability_id || ''}`;

export async function importHistory(bytes, fileName, cfg, resolver) {
  const model = cfg.model;
  const hash = await sha256Hex(bytes);
  const wb = openWorkbook(bytes);
  const hist = {
    source_file_name: fileName,
    source_file_hash: hash,
    imported_at: nowIso(),
    records: new Map(), // key -> { market_raw, lighthouse, values: Map(measureKey -> {value, label, cell}) }
    issues: [],
    reconciliation: [],
  };
  const primaryName = model.history.primary_sheet;
  if (!wb.hasSheet(primaryName)) {
    hist.issues.push({ sheet: primaryName, message: `Sheet "${primaryName}" not found; no history imported.` });
    return hist;
  }
  const prim = readBlocks(wb.sheet(primaryName), model, resolver);
  hist.issues.push(...prim.issues);
  for (const row of prim.rows) {
    if (hist.records.has(row.key)) {
      hist.issues.push({ sheet: primaryName, row: row.row, market: row.market_raw, message: `Duplicate market in ${primaryName} (${row.key}); first occurrence kept` });
      continue;
    }
    const values = new Map();
    for (const v of row.values) values.set(measureKey(v), { ...v, sheet: primaryName });
    hist.records.set(row.key, { key: row.key, market_raw: row.market_raw, lighthouse: row.lighthouse, values });
  }
  // Cross-check every other tab that repeats the same figures
  const tol = model.history.tolerance;
  for (const name of model.history.cross_check_sheets) {
    if (!wb.hasSheet(name)) continue;
    const blk = readBlocks(wb.sheet(name), model, resolver);
    for (const row of blk.rows) {
      const rec = hist.records.get(row.key);
      for (const v of row.values) {
        const p = rec?.values.get(measureKey(v));
        if (!p) {
          hist.reconciliation.push({ key: row.key, market: row.market_raw, measure: v.label, primary_value: null, primary_cell: null, other_sheet: name, other_value: v.value, other_cell: v.cell, result: `Only in ${name}` });
        } else if (Math.abs(p.value - v.value) > tol) {
          hist.reconciliation.push({ key: row.key, market: row.market_raw, measure: v.label, primary_value: p.value, primary_cell: `${primaryName}!${p.cell}`, other_sheet: name, other_value: v.value, other_cell: v.cell, result: 'Mismatch - Results value used' });
        }
      }
    }
  }
  return hist;
}

export function historyValue(hist, key2, year, measure, capId = null) {
  const rec = hist?.records.get(key2);
  if (!rec) return null;
  const v = rec.values.get(`${year}|${measure}|${capId || ''}`);
  return v ? v.value : null;
}

/** Map a 2025-style overall column label to (year, measure). */
export function parseOverallLabel(label, model) {
  return classifyHeader(label, model);
}
