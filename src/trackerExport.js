// Writes the Global DMMM Results Tracker 2026 workbook. ExcelJS is injected so the same code
// runs in the browser (vendor/exceljs.min.js) and in Node (npm exceljs).
import { round, nowIso } from './util.js';
import { BU_SHORT } from './identity.js';
import { regionOrder, missingFrom2026 } from './portfolio.js';
import { DECISION_OPTIONS } from './validation.js';

export const STATE_FORMAT = 'dmmm-tracker-state/1';
const FONT = 'Arial';
const C = {
  // Syngenta palette: Super Green 009F3C, Deep Blue 36398E, Sunlight F4A000, Earth E24A1E, neutrals
  ink: 'FF1A202C', header: 'FF009F3C', headerGdm: 'FF36398E', headerHist: 'FF64748B', headerText: 'FFFFFFFF',
  title: 'FF36398E', edit: 'FFFFF4DB', ok: 'FFE6F5EC', warn: 'FFFFF4DB', bad: 'FFFDECE6', info: 'FFEBEBF6', muted: 'FFF4F6F8',
};
const STATUS_FILL = {
  'Complete': C.ok, 'Validated': C.info, 'Pending Global Data': C.warn, 'Ready for Global review': C.warn,
  'Incomplete country-owned inputs': C.bad, 'Validation conflict': C.bad, 'Template error': C.bad, 'Identity error': C.bad,
  'Duplicate - choose active version': C.bad, 'Not started (no country ratings)': C.muted,
};

const r2 = (v) => (v === null || v === undefined ? null : round(v, 2));

function marketLabel(r) { return r.identity.country_name + (r.lighthouse ? '*' : ''); }
export function countrySheetName(r) { return `${r.identity.country_id} - ${BU_SHORT[r.business_unit] || r.business_unit}`.slice(0, 31); }

/** Column definitions shared by Results and every regional view. */
export function resultColumns(model) {
  const cols = [
    { h: 'Region', w: 8, g: 'id', v: (r) => r.identity.region },
    { h: 'BU', w: 7, g: 'id', v: (r) => r.business_unit },
    { h: 'Market', w: 26, g: 'id', v: (r) => marketLabel(r) },
    { h: 'Country ID', w: 9, g: 'id', v: (r) => r.identity.country_id },
    { h: 'Subregion', w: 9, g: 'id', v: (r) => r.identity.subregion },
    { h: 'Profile', w: 9, g: 'id', v: (r) => r.identity.profile },
  ];
  for (const label of model.history.results_columns_overall) cols.push({ h: label, w: 10, g: 'hist', num: true, v: (r) => r2(r.history.overall[label]) });
  cols.push(
    { h: '2026 Self Current', w: 11, g: 'country', num: true, v: (r) => r2(r.self_current) },
    { h: '2026 Validated Current', w: 11, g: 'gdm', num: true, v: (r) => r2(r.validated_current) },
    { h: '2027 Target Maturity', w: 11, g: 'country', num: true, v: (r) => r2(r.country_target) },
    { h: 'Country Input Status', w: 22, g: 'country', status: true, v: (r) => r.country_status },
    { h: 'GDM Validation Status', w: 20, g: 'gdm', status: true, v: (r) => r.gdm_status },
    { h: 'Global Rows Pending', w: 9, g: 'gdm', v: (r) => (r.needs_choice ? null : r.gdm.pending) },
    { h: 'YoY vs 2025 (validated)', w: 10, g: 'bench', num: true, v: (r) => r2(r.bench.yoy) },
    { h: 'YoY vs 2025 (self, provisional)', w: 11, g: 'bench', num: true, v: (r) => r2(r.bench.yoy_self) },
    { h: '2026 Target Met (validated)', w: 10, g: 'bench', v: (r) => r.bench.target_2026_met },
    { h: '2026 Target Met (self, provisional)', w: 11, g: 'bench', v: (r) => r.bench.target_2026_met_self },
    { h: 'YoY Basis', w: 16, g: 'bench', v: (r) => r.yoy_status },
    { h: 'Region Avg 2026 (validated)', w: 10, g: 'bench', num: true, v: (r) => r2(r.bench.region_avg) },
    { h: 'vs Region Avg', w: 9, g: 'bench', num: true, v: (r) => r2(r.bench.vs_region) },
    { h: 'Global Avg 2026 (validated)', w: 10, g: 'bench', num: true, v: (r) => r2(r.bench.global_avg) },
  );
  for (const cap of model.capabilities) {
    const n = cap.short_name;
    for (const y of model.history.results_capability_years.current) cols.push({ h: `${y} ${n}`, w: 9, g: 'hist', num: true, v: (r) => r2(r.history.cap[cap.id].current[y]) });
    for (const y of model.history.results_capability_years.goal) cols.push({ h: `${y} ${n} Goal`, w: 9, g: 'hist', num: true, v: (r) => r2(r.history.cap[cap.id].goal[y]) });
    const capOf = (r) => r.scores.capabilities.find((c) => c.id === cap.id);
    cols.push(
      { h: `2026 ${n} Self`, w: 9, g: 'country', num: true, v: (r) => (r.needs_choice ? null : r2(capOf(r).self_current)) },
      { h: `2026 ${n} Validated`, w: 9, g: 'gdm', num: true, v: (r) => (r.validated_current === null ? null : r2(capOf(r).validated_current)) },
      { h: `2027 ${n} Goal`, w: 9, g: 'country', num: true, v: (r) => (r.needs_choice ? null : r2(capOf(r).country_target)) },
    );
  }
  for (const gq of model.general_questions) cols.push({ h: gq.label, w: 14, g: 'info', v: (r) => r.sub.general?.[gq.key] ?? null });
  cols.push(
    { h: 'Source Workbook', w: 34, g: 'audit', v: (r) => r.sub.source_file_name },
    { h: 'Version', w: 7, g: 'audit', v: (r) => r.sub.version },
    { h: 'Submitter', w: 18, g: 'audit', v: (r) => r.sub.submitter },
    { h: 'Submission ID', w: 14, g: 'audit', v: (r) => r.sub.submission_id },
  );
  return cols;
}

const GROUP_FILL = { id: C.header, hist: C.headerHist, country: C.header, gdm: C.headerGdm, bench: C.headerHist, info: C.headerHist, audit: C.headerHist };

function styleHeader(row, cols) {
  row.height = 42;
  row.eachCell((cell, i) => {
    const col = cols[i - 1];
    cell.font = { name: FONT, bold: true, size: 9, color: { argb: C.headerText } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GROUP_FILL[col?.g] || C.header } };
    cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    cell.border = { right: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
  });
}

function title(ws, text, sub) {
  ws.getCell('A1').value = text;
  ws.getCell('A1').font = { name: FONT, bold: true, size: 14, color: { argb: C.title } };
  if (sub) { ws.getCell('A2').value = sub; ws.getCell('A2').font = { name: FONT, size: 9, italic: true, color: { argb: 'FF64748B' } }; }
}

/** Write a simple table; returns { first, last } data rows. */
function table(ws, startRow, cols, rows, opts = {}) {
  const hr = ws.getRow(startRow);
  cols.forEach((c, i) => { hr.getCell(i + 1).value = c.h; });
  styleHeader(hr, cols);
  cols.forEach((c, i) => { if (c.w) ws.getColumn(i + 1).width = Math.max(ws.getColumn(i + 1).width || 0, c.w); });
  let r = startRow + 1;
  for (const row of rows) {
    const xr = ws.getRow(r);
    cols.forEach((c, i) => {
      const cell = xr.getCell(i + 1);
      const v = c.v(row);
      cell.value = v === undefined ? null : v;
      cell.font = { name: FONT, size: 9, color: { argb: C.ink } };
      if (c.num) cell.numFmt = '0.00';
      if (c.status && STATUS_FILL[v]) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STATUS_FILL[v] } };
      if (c.edit) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.edit } };
      if (c.wrap) cell.alignment = { wrapText: true, vertical: 'top' };
    });
    r++;
  }
  if (opts.filter !== false && rows.length) ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: startRow + rows.length, column: cols.length } };
  return { first: startRow + 1, last: r - 1, next: r };
}

function colLetter(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

/** Regional block with AVG and n rows written as live Excel formulas. */
function regionBlock(ws, startRow, heading, cols, rows) {
  ws.getCell(startRow, 1).value = heading;
  ws.getCell(startRow, 1).font = { name: FONT, bold: true, size: 11, color: { argb: C.title } };
  const t = table(ws, startRow + 1, cols, rows, { filter: false });
  if (rows.length) {
    const avgRow = ws.getRow(t.next), nRow = ws.getRow(t.next + 1);
    avgRow.getCell(3).value = 'AVG'; nRow.getCell(3).value = 'n';
    cols.forEach((c, i) => {
      if (!c.num) return;
      const L = colLetter(i + 1);
      avgRow.getCell(i + 1).value = { formula: `IF(COUNT(${L}${t.first}:${L}${t.last})=0,"",AVERAGE(${L}${t.first}:${L}${t.last}))` };
      avgRow.getCell(i + 1).numFmt = '0.00';
      nRow.getCell(i + 1).value = { formula: `COUNT(${L}${t.first}:${L}${t.last})` };
    });
    for (const xr of [avgRow, nRow]) xr.eachCell((cell) => { cell.font = { name: FONT, bold: true, size: 9 }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.muted } }; });
  }
  return t.next + 3;
}

export function regionalViews(rows) {
  const views = [];
  const eur = rows.filter((r) => r.identity.region === 'EUR');
  if (eur.length) {
    views.push({ sheet: 'EUROPE ALL', blocks: [{ heading: 'Europe CP & Seeds DMMM Results 2026', rows: eur }] });
    const cp = eur.filter((r) => r.business_unit === 'CP');
    const sd = eur.filter((r) => r.business_unit === 'Seeds');
    if (cp.length) views.push({ sheet: 'EUROPE CP', blocks: [{ heading: 'Europe CP DMMM Results 2026', rows: cp }] });
    if (sd.length) views.push({ sheet: 'EUROPE SEED', blocks: [{ heading: 'Europe Seed DMMM Results 2026', rows: sd }] });
  }
  const amea = rows.filter((r) => r.identity.region === 'AMEA');
  if (amea.length) {
    const blocks = [{ heading: 'AMEA Results 2026', rows: amea }];
    const ame = amea.filter((r) => r.identity.subregion === 'AME');
    const asia = amea.filter((r) => r.identity.subregion === 'ASIA');
    if (ame.length) blocks.push({ heading: 'AME Results 2026', rows: ame });
    if (asia.length) blocks.push({ heading: 'ASIA Results 2026', rows: asia });
    views.push({ sheet: 'AMEA REGION', blocks });
  }
  for (const [reg, name] of [['LATAM', 'LATAM REGION'], ['NA', 'NA REGION'], ['JANZ', 'JANZ REGION']]) {
    const rr = rows.filter((r) => r.identity.region === reg);
    if (rr.length) views.push({ sheet: name, blocks: [{ heading: `${reg} DMMM Results 2026`, rows: rr }] });
  }
  const other = rows.filter((r) => regionOrder(r.identity.region) === 99);
  if (other.length) views.push({ sheet: 'OTHER REGIONS', blocks: [{ heading: 'Markets with an unlisted region', rows: other }] });
  return views;
}

function metricsColumns(cfg) {
  const m = cfg.metrics;
  const levelHeaders = [];
  const byRow = Object.fromEntries(m.skills.map((s) => [s.row, s]));
  const order2025 = [[13, 'level'], [23, 'level'], [24, 'level'], [46, 'level'], [69, 'raw'], [69, 'level']];
  for (const [row, kind] of order2025) {
    const s = byRow[row];
    levelHeaders.push(kind === 'raw' ? { row, kind, header: s.raw_column } : { row, kind, header: row === 13 ? s.aliases[0] : s.column });
  }
  const info = m.informational_columns.map((h) => ({ kind: 'info', header: h }));
  levelHeaders.push(...info.slice(0, 5));
  levelHeaders.push({ row: 89, kind: 'level', header: byRow[89].column });
  for (const s of m.skills.filter((x) => x.new_in_2026)) levelHeaders.push({ row: s.row, kind: 'level', header: s.column, isNew: true });
  for (const s of m.skills.filter((x) => !x.level4_verified_by_source)) levelHeaders.push({ row: s.row, kind: 'l4', header: s.column + m.level4_verification.column_suffix, isNew: true });
  return levelHeaders;
}

export async function buildTrackerWorkbook(ExcelJS, portfolio, rows, opts = {}) {
  const cfg = portfolio.cfg;
  const model = cfg.model;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DMMM 2026 Results Engine';
  wb.created = new Date();
  const exportedAt = opts.exportedAt || nowIso();
  const cols = resultColumns(model);
  const sub = `Generated ${exportedAt.slice(0, 16).replace('T', ' ')} UTC | model ${cfg.versions.model}, thresholds ${cfg.versions.thresholds}, metrics mapping ${cfg.versions.metrics}, country master ${cfg.versions.aliases} | ${rows.length} market(s)`;

  // ---- Results ---------------------------------------------------------------------------
  const res = wb.addWorksheet('Results', { views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }] });
  title(res, 'Global DMMM Results Tracker 2022 - 2026', sub);
  table(res, 4, cols, rows);

  // ---- Regional views --------------------------------------------------------------------
  for (const v of regionalViews(rows)) {
    const ws = wb.addWorksheet(v.sheet, { views: [{ state: 'frozen', xSplit: 3, ySplit: 0 }] });
    title(ws, `${v.sheet} - DMMM Results 2026`, sub);
    let r = 4;
    for (const b of v.blocks) r = regionBlock(ws, r, b.heading, cols, b.rows);
  }
  const lh = rows.filter((r) => r.lighthouse);
  if (lh.length) {
    const ws = wb.addWorksheet('Lighthouses', { views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }] });
    title(ws, 'Lighthouse markets - DMMM Results 2026', 'Lighthouse markets are set in config/country_alias_master.json (lighthouse_bu).');
    table(ws, 4, cols, lh);
  }

  // ---- Global Metrics 2026 (2025 layout, extended) -----------------------------------------
  const mws = wb.addWorksheet('Global Metrics 2026', { views: [{ state: 'frozen', xSplit: 3, ySplit: 2 }] });
  const mcols = metricsColumns(cfg);
  mws.getCell('A1').value = `${model.assessment_year} DMMM Global Metrics`;
  mws.getCell('A1').font = { name: FONT, bold: true, size: 14, color: { argb: C.title } };
  const mh = mws.getRow(2);
  ['Region', 'BU', 'Market', ...mcols.map((c) => c.header)].forEach((h, i) => { mh.getCell(i + 1).value = h; });
  styleHeader(mh, [{ g: 'id' }, { g: 'id' }, { g: 'id' }, ...mcols.map((c) => ({ g: c.isNew ? 'gdm' : 'id' }))]);
  [8, 7, 28, ...mcols.map(() => 12)].forEach((w, i) => { mws.getColumn(i + 1).width = w; });
  const metricRows = [];
  const metricsByKey = new Map((portfolio.metrics?.rows || []).map((r) => [r.key, r]));
  const keysDone = new Set();
  for (const r of rows) {
    metricRows.push({ region: r.identity.region, bu: r.business_unit, market: r.metricsRec?.market_raw ?? r.identity.country_name, rec: metricsByKey.get(r.key) || null });
    keysDone.add(r.key);
  }
  for (const rec of portfolio.metrics?.rows || []) if (!keysDone.has(rec.key)) metricRows.push({ region: rec.identity.region, bu: rec.business_unit, market: rec.market_raw, rec });
  let mr = 3;
  for (const m of metricRows) {
    const xr = mws.getRow(mr++);
    xr.getCell(1).value = m.region; xr.getCell(2).value = m.bu; xr.getCell(3).value = m.market;
    mcols.forEach((c, i) => {
      let v = null;
      if (m.rec) {
        if (c.kind === 'level') v = m.rec.values[c.row]?.level_raw ?? null;
        else if (c.kind === 'raw') v = m.rec.values[c.row]?.raw_value ?? null;
        else if (c.kind === 'l4') v = m.rec.values[c.row]?.l4_verified_raw ?? null;
        else if (c.kind === 'info') v = m.rec.informational?.[c.header] ?? null;
      }
      xr.getCell(i + 4).value = v;
    });
    xr.eachCell((cell) => { cell.font = { name: FONT, size: 9 }; });
  }
  const mnote = mws.getRow(mr + 1);
  mnote.getCell(1).value = `Source: ${portfolio.metrics ? `"${portfolio.metrics.source_file_name}" imported ${portfolio.metrics.imported_at.slice(0, 10)}` : 'no Global Metrics file loaded yet'}. Blue columns are new for ${model.assessment_year}. Fill this sheet and upload it (or the whole tracker) as the Global Metrics file.`;
  mnote.getCell(1).font = { name: FONT, size: 9, italic: true };

  // ---- Validation Queue ------------------------------------------------------------------
  const vq = wb.addWorksheet('Validation Queue', { views: [{ state: 'frozen', xSplit: 4, ySplit: 4 }] });
  title(vq, 'Validation Queue - GDM-managed rows', 'Yellow columns are for GDM reviewers. Save the tracker and upload it again to apply decisions. Only CURRENT scores are validated; country targets are never changed.');
  const vqRows = [];
  for (const r of rows) {
    if (r.needs_choice) continue;
    for (const g of r.gdm.rows.values()) {
      const skill = r.sub.skills.find((s) => s.row === g.row);
      vqRows.push({ r, g, skill, cap: model.capabilities.find((c) => c.id === g.capability_id) });
    }
  }
  const vqCols = [
    { h: 'Key', w: 16, v: (x) => x.r.key },
    { h: 'Region', w: 7, v: (x) => x.r.identity.region },
    { h: 'BU', w: 6, v: (x) => x.r.business_unit },
    { h: 'Market', w: 18, v: (x) => x.r.identity.country_name },
    { h: 'Capability', w: 22, v: (x) => x.cap.name },
    { h: 'Skill', w: 30, v: (x) => x.g.skill },
    { h: 'Questionnaire Row', w: 9, v: (x) => x.g.row },
    { h: 'Included (P)', w: 7, v: (x) => x.skill.inclusion },
    { h: 'Country Self Current (K)', w: 9, v: (x) => x.skill.self_current },
    { h: 'Global Source Metric', w: 20, v: (x) => x.g.proposal.source_metric },
    { h: 'Raw Metric', w: 14, v: (x) => x.g.proposal.raw_metric },
    { h: 'Raw Metric Value', w: 10, v: (x) => x.g.proposal.raw_value },
    { h: 'GDM Level in File', w: 9, v: (x) => x.g.proposal.level_raw },
    { h: 'Level from Thresholds', w: 9, v: (x) => x.g.proposal.derived_from_raw },
    { h: 'Threshold Version', w: 9, v: (x) => x.g.proposal.threshold_version },
    { h: 'Proposed Current', w: 9, v: (x) => x.g.proposal.proposed_level },
    { h: 'L4 Verified in Data', w: 8, v: (x) => (x.g.proposal.proposed_level === 4 ? (x.g.proposal.l4_verified_in_data ? 'Yes' : 'No') : null) },
    { h: 'Approval Status', w: 30, status: true, v: (x) => x.g.status },
    { h: 'Final Validated Current', w: 9, v: (x) => x.g.final_value },
    { h: 'GDM Decision', w: 14, edit: true, v: (x) => x.g.decision?.decision ?? null },
    { h: 'Override Score', w: 9, edit: true, v: (x) => x.g.decision?.override_score ?? null },
    { h: 'Reviewer', w: 16, edit: true, v: (x) => x.g.decision?.reviewer ?? null },
    { h: 'Decision Date', w: 12, edit: true, v: (x) => x.g.decision?.decided_at ?? null },
    { h: 'Rationale', w: 30, edit: true, v: (x) => x.g.decision?.rationale ?? null },
    { h: 'Notes', w: 50, wrap: true, v: (x) => [...x.g.proposal.notes, x.g.note].filter(Boolean).join(' | ') || null },
  ];
  const vt = table(vq, 4, vqCols, vqRows);
  if (vqRows.length) {
    const decCol = colLetter(vqCols.findIndex((c) => c.h === 'GDM Decision') + 1);
    const ovCol = colLetter(vqCols.findIndex((c) => c.h === 'Override Score') + 1);
    vq.dataValidations?.add?.(`${decCol}${vt.first}:${decCol}${vt.last}`, { type: 'list', allowBlank: true, formulae: [`"${DECISION_OPTIONS.join(',')}"`] });
    vq.dataValidations?.add?.(`${ovCol}${vt.first}:${ovCol}${vt.last}`, { type: 'decimal', allowBlank: true, operator: 'between', formulae: [0, 4] });
  }

  // ---- Intake Log ------------------------------------------------------------------------
  const il = wb.addWorksheet('Intake Log', { views: [{ state: 'frozen', ySplit: 4 }] });
  title(il, 'Intake Log', 'Every workbook ever loaded, including inactive versions. Original files are never modified.');
  const resByKey = new Map(rows.map((r) => [r.key, r]));
  const intake = portfolio.submissions.map((s) => {
    const r = s.key ? resByKey.get(s.key) : null;
    const own = s.skills.filter((x) => x.owner === 'country' && x.inclusion === 1);
    const dupCount = s.key ? portfolio.versionsOf(s.key).length : 0;
    return { s, r, own, dupCount };
  });
  for (const e of portfolio.intakeLog.filter((x) => x.duplicate_of)) intake.push({ skipped: e });
  const ilCols = [
    { h: 'Loaded At (UTC)', w: 17, v: (x) => (x.skipped ? x.skipped.at : x.s.uploaded_at).slice(0, 19).replace('T', ' ') },
    { h: 'Source Workbook', w: 34, v: (x) => (x.skipped ? x.skipped.file : x.s.source_file_name) },
    { h: 'Submission ID', w: 14, v: (x) => (x.skipped ? x.skipped.submission_id : x.s.submission_id) },
    { h: 'Market (Sign-up D7)', w: 14, v: (x) => x.s?.market_raw ?? null },
    { h: 'BU (Sign-up D9)', w: 12, v: (x) => x.s?.bu_raw ?? null },
    { h: 'Parsed Country', w: 16, v: (x) => x.s?.identity?.country_name ?? null },
    { h: 'Region', w: 7, v: (x) => x.s?.identity?.region ?? null },
    { h: 'BU', w: 6, v: (x) => x.s?.business_unit ?? null },
    { h: 'Profile', w: 8, v: (x) => x.s?.identity?.profile ?? null },
    { h: 'Template Detected', w: 16, v: (x) => (x.s ? (x.s.template_ok ? `DMMM ${model.assessment_year} (${x.s.capability_boundaries_source})` : 'Not a valid 2026 template') : null) },
    { h: 'Skills Parsed', w: 7, v: (x) => x.s?.skills.length ?? null },
    { h: 'Country Skills Included', w: 8, v: (x) => x.own?.length ?? null },
    { h: 'Missing Self (K)', w: 8, v: (x) => (x.own ? x.own.filter((k) => k.self_current === null).length : null) },
    { h: 'Missing Target (L)', w: 8, v: (x) => (x.own ? x.own.filter((k) => k.country_target === null).length : null) },
    { h: 'Excluded P=0', w: 7, v: (x) => x.s?.skills.filter((k) => k.inclusion === 0).length ?? null },
    { h: 'Country Input Completeness', w: 22, status: true, v: (x) => (x.r && x.r.sub === x.s ? x.r.country_status : null) },
    { h: 'Version', w: 7, v: (x) => x.s?.version ?? null },
    { h: 'Active', w: 7, v: (x) => (x.skipped ? 'Skipped' : x.s.active_flag ? 'Yes' : 'No') },
    { h: 'Duplicate Warning', w: 40, wrap: true, v: (x) => (x.skipped ? x.skipped.outcome : x.dupCount > 1 ? `${x.dupCount} versions of ${x.s.key}${portfolio.needsChoice.has(x.s.key) ? ' - choose the active one' : ''}` : null) },
    { h: 'Reading Check (workbook own Summary reproduced)', w: 16, v: (x) => (x.s?.parse_check?.match === true ? 'OK' : x.s?.parse_check?.match === false ? 'Differs' : null) },
    { h: 'Validation Errors', w: 50, wrap: true, v: (x) => x.s?.issues.filter((i) => i.level === 'error').map((i) => i.message).join(' | ') || null },
    { h: 'Warnings', w: 50, wrap: true, v: (x) => x.s?.issues.filter((i) => i.level !== 'error').map((i) => i.message).join(' | ') || null },
    { h: 'SHA-256', w: 18, v: (x) => (x.s ? x.s.source_file_hash.slice(0, 16) : null) },
  ];
  table(il, 4, ilCols, intake);

  // ---- YoY Comparison ------------------------------------------------------------------
  const yw = wb.addWorksheet('YoY Comparison', { views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }] });
  title(yw, 'Year-on-year comparison 2025 -> 2026', 'Validated = official (same basis as 2025, includes GDM data). Self = provisional, based on the country self-assessment until GDM data is available. Compared at overall and capability level only: the 2026 questionnaire has new and changed skills.');
  const yCols = [
    { h: 'Region', w: 8, v: (r) => r.identity.region }, { h: 'BU', w: 7, v: (r) => r.business_unit },
    { h: 'Market', w: 24, v: (r) => marketLabel(r) }, { h: 'Country ID', w: 9, v: (r) => r.identity.country_id },
    { h: 'YoY Basis', w: 18, v: (r) => r.yoy_status },
    { h: '2025 Current', w: 9, num: true, v: (r) => r2(r.history.overall['2025 Current Maturity']) },
    { h: '2026 Self', w: 9, num: true, v: (r) => r2(r.self_current) },
    { h: 'YoY Self (provisional)', w: 10, num: true, v: (r) => r2(r.bench.yoy_self) },
    { h: '2026 Validated', w: 9, num: true, v: (r) => r2(r.validated_current) },
    { h: 'YoY Validated', w: 9, num: true, v: (r) => r2(r.bench.yoy) },
  ];
  for (const cap of model.capabilities) {
    const n = cap.short_name;
    yCols.push(
      { h: `2025 ${n}`, w: 9, num: true, v: (r) => r2(r.yoy_cap[cap.id].prev) },
      { h: `YoY ${n} Self (prov.)`, w: 9, num: true, v: (r) => r2(r.yoy_cap[cap.id].d_self) },
      { h: `YoY ${n} Validated`, w: 9, num: true, v: (r) => r2(r.yoy_cap[cap.id].d_validated) },
    );
  }
  const yt = table(yw, 4, yCols, rows.filter((r) => !r.needs_choice));
  // colour the deltas: green up, red down
  yCols.forEach((c, i) => {
    if (!/^YoY/.test(c.h) || c.h === 'YoY Basis') return;
    for (let rr = yt.first; rr <= yt.last; rr++) {
      const cell = yw.getRow(rr).getCell(i + 1);
      if (typeof cell.value === 'number') {
        cell.numFmt = '+0.00;-0.00;0.00';
        cell.font = { name: FONT, size: 9, bold: true, color: { argb: cell.value > 0 ? 'FF00782D' : cell.value < 0 ? 'FFB4370F' : C.ink } };
      }
    }
  });
  const missing = missingFrom2026(portfolio, rows);
  let mrow = yt.next + 2;
  yw.getCell(mrow, 1).value = portfolio.history ? `In the 2025 tracker, no 2026 file yet (${missing.length})` : 'Load the 2025 Global Tracker to compare with last year.';
  yw.getCell(mrow, 1).font = { name: FONT, bold: true, size: 11, color: { argb: C.title } };
  if (missing.length) {
    table(yw, mrow + 1, [
      { h: 'Region', w: 8, v: (m) => m.region }, { h: 'BU', w: 7, v: (m) => m.business_unit },
      { h: 'Market', w: 24, v: (m) => m.country_name }, { h: 'Country ID', w: 9, v: (m) => m.country_id },
      { h: 'YoY Basis', w: 18, v: () => 'No 2026 submission yet' }, { h: '2025 Current', w: 9, num: true, v: (m) => m.current_2025 },
    ], missing, { filter: false });
  }

  // ---- Portfolio Benchmarks ----------------------------------------------------------------
  const pb = wb.addWorksheet('Portfolio Benchmarks');
  title(pb, 'Portfolio Benchmarks 2026', `Averages of validated scores are shown once at least ${model.benchmarks.min_records_for_average} validated markets exist in the group.`);
  const groups = [];
  const add = (label, rr) => groups.push({ label, rr });
  add('All markets', rows);
  for (const reg of [...new Set(rows.map((r) => r.identity.region))].sort((a, b) => regionOrder(a) - regionOrder(b))) {
    const rr = rows.filter((r) => r.identity.region === reg);
    add(reg, rr);
    for (const bu of [...new Set(rr.map((r) => r.business_unit))]) add(`${reg} ${bu}`, rr.filter((r) => r.business_unit === bu));
  }
  const avgBench = (rr, k, min) => { const xs = rr.map((r) => r.bench[k]).filter((v) => v !== null); return xs.length >= min ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 2) : null; };
  const avgOf = (rr, k, min = 1) => { const xs = rr.map((r) => r[k]).filter((v) => v !== null); return xs.length >= min ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 2) : null; };
  table(pb, 4, [
    { h: 'Group', w: 18, v: (g) => g.label },
    { h: 'Markets', w: 8, v: (g) => g.rr.length },
    { h: 'Country Input Complete', w: 10, v: (g) => g.rr.filter((r) => r.country_status === 'Complete').length },
    { h: 'GDM Validated', w: 10, v: (g) => g.rr.filter((r) => r.validated_current !== null).length },
    { h: 'Avg Self Current', w: 10, num: true, v: (g) => avgOf(g.rr, 'self_current') },
    { h: 'Avg Validated Current', w: 10, num: true, v: (g) => avgOf(g.rr, 'validated_current', model.benchmarks.min_records_for_average) },
    { h: 'Avg 2027 Target', w: 10, num: true, v: (g) => avgOf(g.rr, 'country_target') },
    { h: 'Avg YoY Self (provisional)', w: 11, num: true, v: (g) => avgBench(g.rr, 'yoy_self', 1) },
    { h: 'Avg YoY Validated', w: 10, num: true, v: (g) => avgBench(g.rr, 'yoy', model.benchmarks.min_records_for_average) },
    { h: 'Markets with 2025 Result', w: 10, v: (g) => g.rr.filter((r) => r.bench.yoy_self !== null || r.bench.yoy !== null).length },
  ], groups, { filter: false });

  // ---- History Reconciliation --------------------------------------------------------------
  const hr = wb.addWorksheet('History Reconciliation');
  title(hr, 'History Reconciliation (2022-2025 legacy tracker)', portfolio.history ? `Source "${portfolio.history.source_file_name}". The Results tab is authoritative; every figure repeated in another tab is compared to it.` : 'No legacy tracker loaded.');
  table(hr, 4, [
    { h: 'Key', w: 12, v: (x) => x.key }, { h: 'Market', w: 16, v: (x) => x.market }, { h: 'Measure', w: 28, v: (x) => x.measure },
    { h: 'Results Value', w: 10, v: (x) => x.primary_value }, { h: 'Results Cell', w: 14, v: (x) => x.primary_cell },
    { h: 'Other Tab', w: 14, v: (x) => x.other_sheet }, { h: 'Other Value', w: 10, v: (x) => x.other_value }, { h: 'Other Cell', w: 9, v: (x) => x.other_cell },
    { h: 'Result', w: 28, v: (x) => x.result },
  ], [...(portfolio.history?.reconciliation || []), ...(portfolio.history?.issues || []).map((i) => ({ key: '', market: i.market ?? '', measure: '', other_sheet: i.sheet, other_cell: i.row ? `row ${i.row}` : '', result: i.message }))]);

  // ---- Change Log ------------------------------------------------------------------------
  const cl = wb.addWorksheet('Change Log');
  title(cl, 'Change Log', 'Append-only record of versions, Global Metrics imports and GDM decisions.');
  table(cl, 4, [
    { h: 'At (UTC)', w: 17, v: (x) => x.at.slice(0, 19).replace('T', ' ') }, { h: 'Type', w: 16, v: (x) => x.type },
    { h: 'Key', w: 16, v: (x) => x.key }, { h: 'Detail', w: 120, wrap: true, v: (x) => x.detail },
  ], portfolio.changeLog);

  // ---- Configuration snapshots -------------------------------------------------------------
  const am = wb.addWorksheet('Country Alias Master');
  title(am, 'Country Alias Master', `Version ${cfg.aliases.version}. Edit config/country_alias_master.json in the repository to change it.`);
  table(am, 4, [
    { h: 'Country ID', w: 10, v: (c) => c.id }, { h: 'Country', w: 24, v: (c) => c.name }, { h: 'Region', w: 8, v: (c) => c.region },
    { h: 'Subregion', w: 9, v: (c) => c.subregion }, { h: 'Profile', w: 9, v: (c) => cfg.aliases.template_profiles[c.region] || cfg.aliases.template_profiles.default },
    { h: 'Region Source', w: 22, v: (c) => c.region_source }, { h: 'Lighthouse BU', w: 10, v: (c) => c.lighthouse_bu.join(', ') || null },
    { h: 'Aliases', w: 80, v: (c) => c.aliases.join(' | ') },
  ], cfg.aliases.countries);

  const tc = wb.addWorksheet('Threshold Configuration');
  title(tc, 'Threshold Configuration', `Thresholds ${cfg.thresholds.version} | metrics mapping ${cfg.metrics.version}. Source: ${cfg.thresholds.source}`);
  const tcRows = cfg.metrics.skills.map((s) => ({ s, scale: s.threshold ? cfg.thresholds.raw_scales[s.threshold] : null }));
  table(tc, 4, [
    { h: 'Questionnaire Row', w: 9, v: (x) => x.s.row }, { h: 'Skill', w: 34, v: (x) => x.s.skill },
    { h: 'Global Metrics Column', w: 30, v: (x) => x.s.column }, { h: 'Raw Metric Column', w: 16, v: (x) => x.s.raw_column || null },
    { h: 'Raw Bands', w: 40, wrap: true, v: (x) => (x.scale ? x.scale.bands.map((b) => `L${b.level}: ${b.min ?? '-inf'} to <${b.max_exclusive ?? '+inf'}`).join('; ') : null) },
    { h: 'Level Definitions', w: 90, wrap: true, v: (x) => cfg.thresholds.level_definitions[String(x.s.row)] || null },
    { h: 'Level 4 Rule', w: 50, wrap: true, v: (x) => (x.s.level4_verified_by_source ? x.s.level4_note : x.scale?.level4_conditions || 'Level 4 needs explicit Global verification') },
  ], tcRows, { filter: false });
  const pol = tc.getRow(4 + tcRows.length + 2);
  pol.getCell(1).value = `Policy: level 4 requires explicit verification = ${cfg.thresholds.policy.level4_requires_explicit_verification}; levels 0-3 accepted automatically = ${cfg.thresholds.policy.auto_accept_levels_below_4}.`;
  pol.getCell(1).font = { name: FONT, size: 9, italic: true };

  // ---- About -----------------------------------------------------------------------------
  const ab = wb.addWorksheet('About');
  title(ab, 'How to read this tracker');
  const about = [
    ['2026 Self Current', 'Mean of the 9 capability scores, each the mean of the country-owned skills (column K) with P = 1. GDM-managed rows are not part of it.'],
    ['2026 Validated Current', 'Same, plus the GDM values for the GDM-managed rows. Shown only when country input is Complete and GDM status is Validated.'],
    ['2027 Target Maturity', 'Country-owned targets (column L) of included skills. Global never sets or changes targets.'],
    ['P = 0', 'The skill is removed from numerator and denominator. A rating of 0 is a valid score and is averaged.'],
    ['Country Input Status', 'Complete | Incomplete country-owned inputs | Not started | Template error | Identity error | Duplicate - choose active version.'],
    ['GDM Validation Status', 'Pending Global Data | Ready for Global review | Validation conflict | Validated. Independent of country input status.'],
    ['Regional AVG rows', 'Live Excel formulas over the rows above them.'],
    ['Saving progress', 'This file is the saved state. Upload it to the tool together with new country workbooks to append them; earlier inputs are kept as versions.'],
    ['Data sheets', 'Submissions, Skill Data and History 2022-2025 hold the raw values the scores are calculated from. Do not edit them by hand.'],
  ];
  about.forEach(([a, b], i) => {
    ab.getCell(4 + i, 1).value = a; ab.getCell(4 + i, 2).value = b;
    ab.getCell(4 + i, 1).font = { name: FONT, bold: true, size: 9 }; ab.getCell(4 + i, 2).font = { name: FONT, size: 9 };
    ab.getCell(4 + i, 2).alignment = { wrapText: true, vertical: 'top' };
  });
  ab.getColumn(1).width = 24; ab.getColumn(2).width = 110;

  // ---- Country tabs ----------------------------------------------------------------------
  for (const r of rows) if (!r.needs_choice) writeCountrySheet(wb.addWorksheet(countrySheetName(r)), r, model);

  // ---- Data sheets (state) -----------------------------------------------------------------
  writeStateSheets(wb, portfolio, exportedAt);
  return wb;
}

export function writeCountrySheet(ws, r, model) {
  title(ws, `${r.identity.country_name} ${r.business_unit} - DMMM ${model.assessment_year}`, `${r.sub.source_file_name} (v${r.sub.version}) | Region ${r.identity.region} | Profile ${r.identity.profile} | Country input: ${r.country_status} | GDM: ${r.gdm_status}`);
  const head = [
    ['Overall', r2(r.self_current), r2(r.validated_current), r2(r.country_target)],
    ...r.scores.capabilities.map((c) => [c.name, r2(c.self_current), r.validated_current === null ? null : r2(c.validated_current), r2(c.country_target)]),
  ];
  const capCols = [
    { h: 'Capability', w: 40, v: (x) => x[0] }, { h: 'Self Current', w: 11, num: true, v: (x) => x[1] },
    { h: 'Validated Current', w: 11, num: true, v: (x) => x[2] }, { h: 'Target +1Y', w: 11, num: true, v: (x) => x[3] },
  ];
  const t = table(ws, 4, capCols, head, { filter: false });
  ws.getRow(t.first).font = { name: FONT, bold: true, size: 9 };
  const skillCols = [
    { h: 'Capability', w: 40, v: (x) => model.capabilities.find((c) => c.id === x.s.capability_id).name },
    { h: 'Skill', w: 11, v: (x) => x.s.skill },
    { h: 'Row', w: 11, v: (x) => x.s.row },
    { h: 'Owner', w: 11, v: (x) => (x.s.owner === 'gdm' ? 'GDM' : 'Country') },
    { h: 'P', w: 5, v: (x) => x.s.inclusion },
    { h: 'Country Self (K)', w: 9, v: (x) => x.s.self_current },
    { h: 'Country Target (L)', w: 9, v: (x) => x.s.country_target },
    { h: 'GDM Proposal', w: 9, v: (x) => x.g?.proposal.proposed_level ?? null },
    { h: 'GDM Approved', w: 9, v: (x) => x.g?.final_value ?? null },
    { h: 'GDM Status', w: 30, v: (x) => x.g?.status ?? null },
    { h: 'Country Comments', w: 60, wrap: true, v: (x) => x.s.comments },
    { h: 'Reviewer Notes / Audit', w: 50, wrap: true, v: (x) => [x.g?.decision ? `${x.g.decision.decision} by ${x.g.decision.reviewer || '?'} ${x.g.decision.decided_at || ''} ${x.g.decision.rationale || ''}`.trim() : null, x.g?.note, ...(x.s.issues || [])].filter(Boolean).join(' | ') || null },
  ];
  const srows = r.sub.skills.map((s) => ({ s, g: r.gdm.rows.get(s.row) }));
  table(ws, t.next + 2, skillCols, srows, { filter: false });
  ws.getColumn(2).width = 40;
}

// ---- State sheets ------------------------------------------------------------------------
function writeStateSheets(wb, p, exportedAt) {
  const sws = wb.addWorksheet('Submissions');
  const sCols = ['submission_id', 'key', 'version', 'active_flag', 'country_id', 'country_name', 'region', 'business_unit', 'assessment_year', 'source_file_name', 'source_file_hash', 'source_file_size', 'uploaded_at', 'parsed_at', 'submitter', 'market_raw', 'bu_raw', 'assessment_date_raw', 'review_date_raw', 'has_macros', 'template_ok', 'capability_boundaries_source', 'parse_check_cached', 'parse_check_reproduced', 'issues_json', 'general_json', 'engine_versions_json'];
  sws.addRow(sCols);
  for (const s of p.submissions) {
    sws.addRow([s.submission_id, s.key, s.version, s.active_flag ? 1 : 0, s.identity?.country_id ?? null, s.identity?.country_name ?? null, s.identity?.region ?? null, s.business_unit ?? null, s.assessment_year, s.source_file_name, s.source_file_hash, s.source_file_size, s.uploaded_at, s.parsed_at, s.submitter, s.market_raw, s.bu_raw, s.assessment_date_raw, s.review_date_raw, s.has_macros ? 1 : 0, s.template_ok ? 1 : 0, s.capability_boundaries_source ?? null, s.parse_check?.workbook_cached_overall ?? null, s.parse_check?.reproduced ?? null, JSON.stringify(s.issues), JSON.stringify(s.general), JSON.stringify(s.engine_versions)]);
  }
  const kws = wb.addWorksheet('Skill Data');
  kws.addRow(['submission_id', 'key', 'version', 'active_flag', 'row', 'capability_id', 'skill', 'owner', 'inclusion_raw', 'inclusion_used', 'self_raw', 'self_current', 'target_raw', 'country_target', 'comments', 'issues']);
  for (const s of p.submissions) for (const k of s.skills) {
    kws.addRow([s.submission_id, s.key, s.version, s.active_flag ? 1 : 0, k.row, k.capability_id, k.skill, k.owner, k.inclusion_raw ?? null, k.inclusion, k.self_raw ?? null, k.self_current, k.target_raw ?? null, k.country_target, k.comments, k.issues.join(' | ') || null]);
  }
  const hws = wb.addWorksheet('History 2022-2025');
  hws.addRow(['key', 'market_2025_label', 'lighthouse_2025', 'year', 'measure', 'capability_id', 'value', 'label', 'source']);
  if (p.history) for (const rec of p.history.records.values()) for (const v of rec.values.values()) {
    hws.addRow([rec.key, rec.market_raw, rec.lighthouse ? 1 : 0, v.year, v.measure, v.capability_id, v.value, v.label, `${v.sheet}!${v.cell}`]);
  }
  const ews = wb.addWorksheet('_Engine', { state: 'hidden' });
  const meta = {
    format: STATE_FORMAT,
    exported_at: exportedAt,
    versions: p.cfg.versions,
    active: Object.fromEntries(p.active),
    needs_choice: [...p.needsChoice],
    metrics: p.metrics ? { import_id: p.metrics.import_id, source_file_name: p.metrics.source_file_name, source_file_hash: p.metrics.source_file_hash, imported_at: p.metrics.imported_at, unmatched: p.metrics.unmatched.map((u) => ({ market_raw: u.market_raw, bu_raw: u.bu_raw, issue: u.issue })), issues: p.metrics.issues } : null,
    metrics_imports: p.metricsImports,
    history: p.history ? { source_file_name: p.history.source_file_name, source_file_hash: p.history.source_file_hash, imported_at: p.history.imported_at, reconciliation: p.history.reconciliation, issues: p.history.issues } : null,
    change_log: p.changeLog,
    decisions: [...p.decisions.values()],
  };
  // Split JSON over cells (Excel limits a cell to 32,767 characters)
  const json = JSON.stringify(meta);
  ews.getCell('A1').value = STATE_FORMAT;
  for (let i = 0, r = 2; i < json.length; i += 30000, r++) ews.getCell(`A${r}`).value = json.slice(i, i + 30000);
}

export async function trackerToBuffer(ExcelJS, portfolio, rows, opts) {
  const wb = await buildTrackerWorkbook(ExcelJS, portfolio, rows, opts);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
