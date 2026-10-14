// Global Digital Marketing data: import of the Global Metrics file, proposals for the
// GDM-managed questionnaire rows, reviewer decisions and the resulting validation status.
// Only CURRENT scores are ever proposed. Country targets are never touched.
import { openWorkbook } from './xlsxReader.js';
import { norm, compact, parseLevel, parseNumber, isBlank, sha256Hex, nowIso } from './util.js';
import { identityKey } from './identity.js';
import { GDM_STATUS } from './scoring.js';

function headerMatches(cell, names) {
  const c = compact(cell);
  if (!c) return false;
  return names.some((n) => compact(n) === c);
}

/** Locate the header row and column positions of a Global Metrics sheet. */
export function detectMetricsLayout(sheet, mcfg) {
  const maxScan = Math.min(sheet.maxRow, 15);
  for (let r = 1; r <= maxScan; r++) {
    const row = sheet.row(r, 1, Math.min(sheet.maxCol, 80));
    const hits = row.filter((v) => mcfg.header_detection.must_contain_any.some((h) => compact(v) === compact(h))).length;
    if (hits < 2) continue;
    const columns = {};
    const missing = [];
    const findCol = (names) => {
      for (let i = row.length - 1; i >= 0; i--) if (headerMatches(row[i], names)) return i + 1; // last wins (2025 tracker repeats some headers)
      return null;
    };
    const firstCol = (names) => {
      for (let i = 0; i < row.length; i++) if (headerMatches(row[i], names)) return i + 1;
      return null;
    };
    for (const s of mcfg.skills) {
      const col = firstCol([s.column, ...(s.aliases || [])]);
      const raw = s.raw_column ? firstCol([s.raw_column, ...(s.raw_aliases || [])]) : null;
      const l4 = findCol([s.column + mcfg.level4_verification.column_suffix, ...(s.aliases || []).map((a) => a + mcfg.level4_verification.column_suffix)]);
      columns[s.row] = { level: col, raw, l4, header: col ? row[col - 1] : null, raw_header: raw ? row[raw - 1] : null };
      if (!col) missing.push(s.column);
    }
    const info = {};
    for (const name of mcfg.informational_columns) { const col = firstCol([name]); if (col) info[name] = col; }
    return { headerRow: r, columns, missing, info };
  }
  return null;
}

function rawToLevel(value, scale) {
  if (value === null) return null;
  for (const b of scale.bands) {
    const okMin = b.min === undefined || value >= b.min;
    const okMax = b.max_exclusive === undefined || value < b.max_exclusive;
    if (okMin && okMax) return b.level;
  }
  return null;
}

export async function importGlobalMetrics(bytes, fileName, cfg, resolver, opts = {}) {
  const mcfg = cfg.metrics;
  const hash = await sha256Hex(bytes);
  const wb = openWorkbook(bytes);
  const imp = {
    import_id: 'GM-' + hash.slice(0, 10),
    source_file_name: fileName,
    source_file_hash: hash,
    imported_at: opts.importedAt || nowIso(),
    mapping_version: mcfg.version,
    threshold_version: cfg.thresholds.version,
    rows: [],
    unmatched: [],
    issues: [],
  };
  let sheet = null, layout = null;
  const prefer = opts.sheetName ? [opts.sheetName] : [];
  for (const name of [...prefer, ...wb.sheetNames]) {
    const sh = wb.sheet(name);
    if (!sh) continue;
    const l = detectMetricsLayout(sh, mcfg);
    if (l) { sheet = sh; layout = l; break; }
  }
  if (!sheet) {
    imp.issues.push({ level: 'error', message: 'No sheet with Global Metrics headers (Canva, Trinity, Emplifi ...) was found.' });
    return imp;
  }
  imp.sheet = sheet.name;
  imp.header_row = layout.headerRow;
  imp.columns_missing = layout.missing;
  if (layout.missing.length) imp.issues.push({ level: 'warning', message: `Columns not found (rows stay "Pending Global Data"): ${layout.missing.join(', ')}` });
  const y = /(20\d\d)/.exec(fileName);
  if (y && Number(y[1]) !== cfg.model.assessment_year) {
    imp.issues.push({ level: 'warning', message: `The file name mentions ${y[1]}. Its values are applied to the ${cfg.model.assessment_year} assessments.` });
  }

  const idc = mcfg.identity_columns;
  const seen = new Map();
  for (let r = layout.headerRow + 1; r <= sheet.maxRow; r++) {
    const market = sheet.at(r, idc.market);
    const buRaw = sheet.at(r, idc.business_unit);
    const regionRaw = sheet.at(r, idc.region);
    if (isBlank(market) || typeof market === 'number') continue;
    if (/^#|^TOTAL|^AVG/i.test(String(market).trim()) || /^TOTAL/i.test(String(buRaw ?? '').trim())) continue;
    const res = resolver.resolveCountry(market);
    let bu = resolver.normalizeBU(buRaw).bu || res.buHint || null;
    const rec = { sheet_row: r, market_raw: market, bu_raw: buRaw, region_raw: regionRaw, issues: [], values: {}, informational: {} };
    if (!res.country || !bu) {
      rec.issue = res.issue || `Business unit "${buRaw ?? ''}" not recognised`;
      imp.unmatched.push(rec);
      continue;
    }
    rec.identity = res.country;
    rec.business_unit = bu;
    rec.key = identityKey(res.country.country_id, bu, cfg.model.assessment_year);
    const regionNorm = resolver.normalizeRegion(regionRaw);
    if (regionRaw && regionNorm && regionNorm !== res.country.region) {
      rec.issues.push(`Region in file is ${regionRaw}; Country Alias Master says ${res.country.region}`);
    }
    for (const s of mcfg.skills) {
      const cols = layout.columns[s.row];
      const levelRaw = cols.level ? sheet.at(r, cols.level) : null;
      const rawRaw = cols.raw ? sheet.at(r, cols.raw) : null;
      const l4Raw = cols.l4 ? sheet.at(r, cols.l4) : null;
      rec.values[s.row] = {
        source_metric: cols.header || s.column,
        level_raw: levelRaw,
        raw_metric: cols.raw_header || null,
        raw_value: rawRaw,
        l4_verified_raw: l4Raw,
        column_present: !!cols.level,
      };
    }
    for (const [name, col] of Object.entries(layout.info)) rec.informational[name] = sheet.at(r, col);
    if (seen.has(rec.key)) {
      imp.issues.push({ level: 'warning', message: `${market} (${bu}) appears twice (sheet rows ${seen.get(rec.key)} and ${r}); the later row is used.` });
      imp.rows = imp.rows.filter((x) => x.key !== rec.key);
    }
    seen.set(rec.key, r);
    imp.rows.push(rec);
  }
  return imp;
}

/** Build the proposal for one GDM-managed row from an imported metrics record. */
export function buildProposal(skillCfg, metricVal, cfg) {
  const mcfg = cfg.metrics;
  const p = {
    source_metric: metricVal?.source_metric || skillCfg.column,
    raw_metric: metricVal?.raw_metric || null,
    raw_value: metricVal?.raw_value ?? null,
    level_raw: metricVal?.level_raw ?? null,
    threshold_version: cfg.thresholds.version,
    proposed_level: null,
    derived_from_raw: null,
    l4_verified_in_data: false,
    state: 'no_data',
    notes: [],
  };
  if (!metricVal) { p.notes.push('Market not in the Global Metrics file'); return p; }
  if (!metricVal.column_present) { p.notes.push(`Column "${skillCfg.column}" not in the Global Metrics file`); return p; }
  const lv = parseLevel(metricVal.level_raw, mcfg.not_applicable_values);
  if (lv.status === 'missing') { p.notes.push('No value yet'); return p; }
  if (lv.status === 'na') { p.state = 'na'; p.notes.push(`GDM marked ${lv.note}`); return p; }
  if (lv.status === 'invalid') { p.state = 'invalid'; p.notes.push(lv.note); return p; }
  if (skillCfg.allowed_levels && !skillCfg.allowed_levels.includes(lv.value)) {
    p.state = 'invalid'; p.notes.push(`Allowed values are ${skillCfg.allowed_levels.join(' or ')}`); return p;
  }
  p.proposed_level = lv.value;
  p.state = 'proposed';
  if (skillCfg.raw_column && skillCfg.threshold) {
    const scale = cfg.thresholds.raw_scales[skillCfg.threshold];
    const rawNum = parseNumber(metricVal.raw_value);
    if (!isBlank(metricVal.raw_value) && rawNum === null) {
      p.notes.push(`${p.raw_metric || skillCfg.raw_column} is "${metricVal.raw_value}" (not numeric)`);
    } else if (rawNum !== null) {
      const derived = rawToLevel(rawNum, scale);
      p.derived_from_raw = derived;
      const consistent = derived === lv.value || (derived === 4 && lv.value === 3);
      if (!consistent) {
        p.state = 'conflict';
        p.notes.push(`${p.raw_metric || skillCfg.raw_column} ${rawNum} maps to level ${derived} under thresholds ${cfg.thresholds.version}, but the file gives ${lv.value}`);
      }
    }
  }
  const acc = mcfg.level4_verification.accepted_values.map(norm);
  p.l4_verified_in_data = (!isBlank(metricVal.l4_verified_raw) && acc.includes(norm(metricVal.l4_verified_raw))) || (lv.value === 4 && skillCfg.level4_verified_by_source === true);
  return p;
}

const DECISIONS = ['Approve', 'Override', 'Reject', 'Exclude (N/A)'];
export const DECISION_OPTIONS = DECISIONS;

export function normalizeDecision(raw) {
  const n = norm(raw);
  if (!n) return null;
  if (n.startsWith('APPROV') || n === 'ACCEPT' || n === 'ACCEPTED') return 'Approve';
  if (n.startsWith('OVERRID')) return 'Override';
  if (n.startsWith('REJECT')) return 'Reject';
  if (n.startsWith('EXCLUD') || n === 'N/A' || n === 'NA') return 'Exclude (N/A)';
  return null;
}

/**
 * Resolve every GDM-managed row of a submission.
 * Returns { rows: Map(row -> resolution), status, pending, counts }.
 */
export function resolveSubmission(sub, metricsRec, decisions, cfg) {
  const policy = cfg.thresholds.policy;
  const rows = new Map();
  const counts = { resolved: 0, pending_data: 0, review: 0, conflict: 0, excluded: 0 };
  for (const skill of sub.skills.filter((s) => s.owner === 'gdm')) {
    const scfg = cfg.metrics.skills.find((m) => m.row === skill.row);
    const prop = buildProposal(scfg, metricsRec?.values?.[skill.row], cfg);
    const dec = decisions?.get(`${sub.key}|${skill.row}`) || null;
    const r = { row: skill.row, skill: skill.skill, capability_id: skill.capability_id, proposal: prop, decision: dec, final_value: null, final_state: 'pending', status: '', note: '' };

    if (skill.inclusion === 0) { r.final_state = 'excluded'; r.status = 'Excluded (P=0)'; rows.set(skill.row, r); continue; }

    const decision = dec ? normalizeDecision(dec.decision) : null;
    if (decision === 'Override') {
      const v = Number(dec.override_score);
      if (Number.isFinite(v) && v >= 0 && v <= 4) { r.final_value = v; r.final_state = 'resolved'; r.status = 'Overridden by GDM'; }
      else { r.status = 'Override needs a score 0-4'; r.final_state = 'review'; }
    } else if (decision === 'Exclude (N/A)') {
      r.final_state = 'excluded'; r.status = 'Excluded by GDM (N/A)';
    } else if (decision === 'Approve') {
      if (prop.proposed_level !== null) { r.final_value = prop.proposed_level; r.final_state = 'resolved'; r.status = prop.proposed_level === 4 ? 'Approved by GDM (Level 4 verified)' : 'Approved by GDM'; }
      else { r.status = 'Approved, but there is no proposed value'; r.final_state = prop.state === 'no_data' ? 'pending' : 'review'; }
    } else if (decision === 'Reject') {
      r.status = 'Rejected by GDM - new data needed'; r.final_state = 'pending';
    } else {
      // No reviewer decision yet
      if (prop.state === 'no_data') { r.status = GDM_STATUS.PENDING; r.final_state = 'pending'; }
      else if (prop.state === 'conflict') { r.status = 'Conflict: GDM level vs raw metric'; r.final_state = 'conflict'; }
      else if (prop.state === 'invalid') { r.status = 'Invalid GDM value'; r.final_state = 'conflict'; }
      else if (prop.state === 'na') { r.status = 'GDM marked N/A - decision needed'; r.final_state = 'review'; }
      else if (prop.proposed_level === 4 && policy.level4_requires_explicit_verification && !prop.l4_verified_in_data) {
        r.status = 'Level 4 - awaiting Global verification'; r.final_state = 'review';
      } else if (prop.proposed_level === 4) {
        r.final_value = 4; r.final_state = 'resolved'; r.status = prop.l4_verified_in_data || policy.level4_requires_explicit_verification ? 'Level 4 verified in GDM data' : 'Accepted from Global Metrics (Level 4)';
      } else if (policy.auto_accept_levels_below_4) {
        r.final_value = prop.proposed_level; r.final_state = 'resolved'; r.status = 'Accepted from Global Metrics';
      } else { r.status = 'Awaiting GDM approval'; r.final_state = 'review'; }
    }
    if (r.final_state === 'resolved' && skill.self_current !== null && skill.self_current !== r.final_value) {
      r.note = `Country self-rating ${skill.self_current} kept for audit; validated value is ${r.final_value}`;
    }
    if (r.final_state === 'resolved') counts.resolved++;
    else if (r.final_state === 'excluded') counts.excluded++;
    else if (r.final_state === 'conflict') counts.conflict++;
    else if (r.final_state === 'review') counts.review++;
    else counts.pending_data++;
    rows.set(skill.row, r);
  }
  let status;
  if (counts.conflict) status = GDM_STATUS.CONFLICT;
  else if (counts.pending_data) status = GDM_STATUS.PENDING;
  else if (counts.review) status = GDM_STATUS.REVIEW;
  else status = GDM_STATUS.VALIDATED;
  return { rows, status, pending: counts.pending_data + counts.review + counts.conflict, counts };
}
