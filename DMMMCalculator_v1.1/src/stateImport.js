// Restores a Portfolio from a tracker this tool exported earlier. Identity is re-resolved and
// scores are recalculated from the raw cell values, so configuration changes always apply.
import { openWorkbook } from './xlsxReader.js';
import { importGlobalMetrics } from './validation.js';
import { STATE_FORMAT } from './trackerExport.js';
import { parseRating, parseFlag, isBlank } from './util.js';
import { identityKey } from './identity.js';

function readTable(sheet) {
  const header = sheet.row(1, 1, sheet.maxCol).map((h) => (h === null ? '' : String(h)));
  const out = [];
  for (let r = 2; r <= sheet.maxRow; r++) {
    const vals = sheet.row(r, 1, header.length);
    if (vals.every((v) => v === null)) continue;
    out.push(Object.fromEntries(header.map((h, i) => [h, vals[i]])));
  }
  return out;
}

export function isTrackerState(bytes) {
  try {
    const wb = openWorkbook(bytes);
    return wb.hasSheet('_Engine') && wb.sheet('_Engine').value('A1') === STATE_FORMAT;
  } catch { return false; }
}

export async function restoreState(portfolio, bytes, fileName) {
  const cfg = portfolio.cfg;
  const wb = openWorkbook(bytes);
  if (!wb.hasSheet('_Engine')) throw new Error(`"${fileName}" is not a tracker exported by this tool (sheet _Engine missing).`);
  const eng = wb.sheet('_Engine');
  if (eng.value('A1') !== STATE_FORMAT) throw new Error(`"${fileName}" uses an unknown state format (${eng.value('A1')}).`);
  let json = '';
  for (let r = 2; r <= eng.maxRow; r++) json += eng.value(`A${r}`) ?? '';
  const meta = JSON.parse(json);

  const subs = readTable(wb.sheet('Submissions'));
  const skills = readTable(wb.sheet('Skill Data'));
  const skillsBySub = new Map();
  for (const k of skills) {
    if (!skillsBySub.has(k.submission_id)) skillsBySub.set(k.submission_id, []);
    skillsBySub.get(k.submission_id).push(k);
  }
  let restored = 0;
  for (const s of subs) {
    if (portfolio.submissions.some((x) => x.source_file_hash === s.source_file_hash)) continue;
    const c = portfolio.resolver.resolveCountry(s.market_raw);
    const b = portfolio.resolver.normalizeBU(s.bu_raw);
    const sub = {
      submission_id: s.submission_id,
      source_file_name: s.source_file_name,
      source_file_hash: s.source_file_hash,
      source_file_size: s.source_file_size,
      uploaded_at: s.uploaded_at,
      parsed_at: s.parsed_at,
      restored_from: fileName,
      engine_versions: JSON.parse(s.engine_versions_json || '{}'),
      submitter: s.submitter,
      market_raw: s.market_raw,
      bu_raw: s.bu_raw,
      assessment_date_raw: s.assessment_date_raw,
      review_date_raw: s.review_date_raw,
      assessment_year: Number(s.assessment_year) || cfg.model.assessment_year,
      has_macros: s.has_macros === 1,
      template_ok: s.template_ok === 1,
      capability_boundaries_source: s.capability_boundaries_source,
      parse_check: { workbook_cached_overall: s.parse_check_cached, reproduced: s.parse_check_reproduced, match: s.parse_check_cached === null ? null : Math.abs((s.parse_check_cached ?? 0) - (s.parse_check_reproduced ?? 0)) < 1e-6 },
      issues: JSON.parse(s.issues_json || '[]').filter((i) => !['COUNTRY_UNMATCHED', 'BU_INVALID'].includes(i.code)),
      general: JSON.parse(s.general_json || '{}'),
      version: Number(s.version),
      identity: c.country ? { ...c.country } : null,
      business_unit: b.bu,
      skills: [],
    };
    if (c.issue) sub.issues.push({ level: 'error', code: 'COUNTRY_UNMATCHED', message: c.issue });
    if (b.issue) sub.issues.push({ level: 'error', code: 'BU_INVALID', message: b.issue });
    sub.key = c.country && b.bu ? identityKey(c.country.country_id, b.bu, sub.assessment_year) : null;
    const modelRows = new Map(cfg.model.skills.map((m) => [m.row, m]));
    for (const k of (skillsBySub.get(s.submission_id) || []).sort((a, b2) => a.row - b2.row)) {
      const m = modelRows.get(Number(k.row));
      if (!m) continue;
      const p = parseFlag(k.inclusion_raw);
      const kk = parseRating(k.self_raw, cfg.model.valid_scores);
      const ll = parseRating(k.target_raw, cfg.model.valid_scores);
      sub.skills.push({
        row: m.row, capability_id: m.capability_id, skill: m.skill, owner: m.owner, gdm_team: m.gdm_team || null,
        inclusion_raw: k.inclusion_raw, self_raw: k.self_raw, target_raw: k.target_raw, comments: k.comments,
        inclusion: p.issue ? 1 : p.value, self_current: kk.value, country_target: ll.value,
        issues: isBlank(k.issues) ? [] : String(k.issues).split(' | '),
      });
    }
    portfolio.submissions.push(sub);
    restored++;
  }
  // Active versions and open choices
  for (const [key, id] of Object.entries(meta.active || {})) {
    const sub = portfolio.submissions.find((x) => x.submission_id === id);
    if (sub && sub.key && !portfolio.active.has(sub.key)) portfolio.active.set(sub.key, id);
  }
  for (const key of meta.needs_choice || []) portfolio.needsChoice.add(key);
  for (const s of portfolio.submissions) if (s.key && !portfolio.active.has(s.key)) portfolio.active.set(s.key, s.submission_id);
  portfolio._syncActiveFlags();
  portfolio.changeLog = [...(meta.change_log || []), ...portfolio.changeLog];
  portfolio.metricsImports = [...(meta.metrics_imports || []), ...portfolio.metricsImports];

  // Global Metrics as stored in the tracker
  if (meta.metrics && !portfolio.metrics && wb.hasSheet('Global Metrics 2026')) {
    const imp = await importGlobalMetrics(bytes, meta.metrics.source_file_name, cfg, portfolio.resolver, { sheetName: 'Global Metrics 2026', importedAt: meta.metrics.imported_at });
    imp.import_id = meta.metrics.import_id;
    imp.source_file_hash = meta.metrics.source_file_hash;
    imp.issues = meta.metrics.issues || imp.issues;
    imp.unmatched = [...imp.unmatched, ...(meta.metrics.unmatched || [])];
    portfolio.metrics = imp;
  }

  // GDM decisions: preload what was saved, then apply edits made in the Validation Queue sheet
  for (const d of meta.decisions || []) if (!portfolio.decisions.has(`${d.key}|${d.row}`)) portfolio.decisions.set(`${d.key}|${d.row}`, d);
  let decisions = 0;
  if (wb.hasSheet('Validation Queue')) {
    const vq = wb.sheet('Validation Queue');
    const hdr = vq.row(4, 1, vq.maxCol).map((h) => (h === null ? '' : String(h)));
    const col = (name) => hdr.indexOf(name) + 1;
    for (let r = 5; r <= vq.maxRow; r++) {
      const key = vq.at(r, col('Key'));
      const row = vq.at(r, col('Questionnaire Row'));
      if (!key || !row) continue;
      const decision = vq.at(r, col('GDM Decision'));
      if (isBlank(decision)) { portfolio.setDecision(String(key), Number(row), null); continue; }
      let date = vq.at(r, col('Decision Date'));
      if (typeof date === 'number') date = new Date(Date.UTC(1899, 11, 30) + date * 86400000).toISOString().slice(0, 10);
      portfolio.setDecision(String(key), Number(row), {
        decision: String(decision).trim(),
        override_score: vq.at(r, col('Override Score')),
        reviewer: vq.at(r, col('Reviewer')),
        decided_at: date ?? null,
        rationale: vq.at(r, col('Rationale')),
      });
      decisions++;
    }
  }

  // History: rebuild from the normalised sheet
  if (meta.history && !portfolio.history && wb.hasSheet('History 2022-2025')) {
    const records = new Map();
    for (const h of readTable(wb.sheet('History 2022-2025'))) {
      if (!records.has(h.key)) records.set(h.key, { key: h.key, market_raw: h.market_2025_label, lighthouse: h.lighthouse_2025 === 1, values: new Map() });
      const [sheet, cell] = String(h.source || '!').split('!');
      records.get(h.key).values.set(`${h.year}|${h.measure}|${h.capability_id || ''}`, { year: Number(h.year), measure: h.measure, capability_id: h.capability_id || null, value: Number(h.value), label: h.label, sheet, cell });
    }
    portfolio.history = { ...meta.history, records };
  }
  portfolio.log('Tracker restored', '', `"${fileName}" (exported ${meta.exported_at}): ${restored} submission version(s), ${decisions} GDM decision(s)`);
  return { restored, decisions, meta };
}
