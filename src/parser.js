// Parses one DMMM 2026 country workbook into a normalised submission record.
// The original file is never modified: only cached cell values and formula text are read.
import { openWorkbook, colToNum } from './xlsxReader.js';
import { norm, parseRating, parseFlag, isBlank, sha256Hex, mean, nowIso } from './util.js';
import { identityKey } from './identity.js';

function issue(level, code, message, extra = {}) {
  return { level, code, message, ...extra };
}

function yearFrom(raw) {
  if (isBlank(raw)) return null;
  if (typeof raw === 'number') {
    if (raw > 1900 && raw < 2100) return raw;
    // Excel serial date
    const d = new Date(Date.UTC(1899, 11, 30) + raw * 86400000);
    return d.getUTCFullYear();
  }
  const m = /(20\d\d)/.exec(String(raw));
  return m ? Number(m[1]) : null;
}

/** Read capability boundaries from Summary outcome formulas such as =AVERAGE(G9:G17). */
export function capabilityBoundariesFromSummary(summary, model) {
  const col = colToNum(model.summary.capability_score_column);
  const offset = model.summary.row_offset_to_questionnaire;
  const found = [];
  for (let r = model.summary.first_row; r <= model.summary.last_row; r++) {
    const f = summary.formulaAt(r, col);
    if (!f) continue;
    const m = /^=?\s*AVERAGE\(\s*\$?G\$?(\d+)\s*:\s*\$?G\$?(\d+)\s*\)\s*$/i.exec(f);
    if (!m) continue;
    found.push({ summary_row: r, first_row: Number(m[1]) - offset, last_row: Number(m[2]) - offset });
  }
  return found;
}

export async function parseCountryWorkbook(bytes, fileName, cfg, resolver, opts = {}) {
  const model = cfg.model;
  const hash = await sha256Hex(bytes);
  const sub = {
    submission_id: hash.slice(0, 12),
    source_file_name: fileName,
    source_file_hash: hash,
    source_file_size: bytes.byteLength ?? bytes.length,
    uploaded_at: opts.uploadedAt || nowIso(),
    parsed_at: nowIso(),
    engine_versions: { ...cfg.versions },
    issues: [],
    skills: [],
    general: {},
  };
  let wb;
  try {
    wb = openWorkbook(bytes);
  } catch (e) {
    sub.issues.push(issue('error', 'UNREADABLE', `File could not be read as an Excel workbook: ${e.message}`));
    sub.template_ok = false;
    return sub;
  }
  sub.has_macros = wb.hasMacros;

  const missingSheets = model.required_sheets.filter((s) => !wb.hasSheet(s));
  const essential = [model.sheets.signup, model.sheets.questionnaire, model.sheets.summary];
  if (missingSheets.length) {
    const fatal = missingSheets.some((s) => essential.includes(s));
    sub.issues.push(issue(fatal ? 'error' : 'warning', 'SHEETS_MISSING', `Missing sheet(s): ${missingSheets.join(', ')}`));
    if (fatal) { sub.template_ok = false; return sub; }
  }

  // ---- Identity -------------------------------------------------------------------------
  const su = wb.sheet(model.sheets.signup);
  const ic = model.identity_cells;
  sub.submitter = su.value(ic.submitter) ?? null;
  sub.market_raw = su.value(ic.market) ?? null;
  sub.bu_raw = su.value(ic.business_unit) ?? null;
  sub.assessment_date_raw = su.value(ic.assessment_date) ?? null;
  sub.review_date_raw = su.value(ic.review_date) ?? null;

  const c = resolver.resolveCountry(sub.market_raw);
  if (c.issue) sub.issues.push(issue('error', 'COUNTRY_UNMATCHED', c.issue));
  const b = resolver.normalizeBU(sub.bu_raw);
  if (b.issue) sub.issues.push(issue('error', 'BU_INVALID', b.issue));
  if (c.country && b.bu && c.buHint && c.buHint !== b.bu) {
    sub.issues.push(issue('warning', 'BU_HINT_MISMATCH', `Market label "${sub.market_raw}" suggests ${c.buHint} but Business Unit is ${b.bu}`));
  }
  const year = yearFrom(sub.assessment_date_raw);
  sub.assessment_year = model.assessment_year;
  if (year && year !== model.assessment_year) {
    sub.issues.push(issue('warning', 'YEAR_MISMATCH', `Assessment date "${sub.assessment_date_raw}" is not ${model.assessment_year}; the file is filed under ${model.assessment_year} because it uses the ${model.assessment_year} template.`));
  }
  if (!year) sub.issues.push(issue('info', 'YEAR_DEFAULTED', `Assessment date is empty; filed under ${model.assessment_year}.`));
  sub.identity = c.country ? { ...c.country } : null;
  sub.business_unit = b.bu;
  sub.key = c.country && b.bu ? identityKey(c.country.country_id, b.bu, sub.assessment_year) : null;

  // ---- Template structure ---------------------------------------------------------------
  const q = wb.sheet(model.sheets.questionnaire);
  const hr = model.questionnaire_header_row;
  const headerDiffs = [];
  for (const [col, expected] of Object.entries(model.expected_headers)) {
    const got = q.value(`${col}${hr}`);
    if (norm(got) !== norm(expected)) headerDiffs.push(`${col}${hr} is "${got ?? ''}" (expected "${expected}")`);
  }
  const summary = wb.sheet(model.sheets.summary);
  const bounds = capabilityBoundariesFromSummary(summary, model);
  sub.capability_boundaries_source = 'Summary outcome formulas';
  const expected = model.capabilities.map((x) => `${x.first_row}-${x.last_row}`).join(',');
  const got = bounds.map((x) => `${x.first_row}-${x.last_row}`).join(',');
  const boundaryDiff = bounds.length === 9 && got !== expected;
  if (headerDiffs.length || boundaryDiff) {
    const k4 = norm(q.value(`K${hr}`)), l4 = norm(q.value(`L${hr}`));
    const is2025 = k4 === 'WEIGHTING' && l4 === 'WEIGHTED RATING';
    const msg = is2025
      ? `This is a DMMM 2025 workbook. Only the DMMM ${model.assessment_year} template can be scored; the country needs to complete the ${model.assessment_year} file.`
      : `This workbook does not match the DMMM ${model.assessment_year} template (${[...headerDiffs, ...(boundaryDiff ? [`capability rows ${got}`] : [])].join('; ')}). It was not scored.`;
    sub.issues.unshift(issue('error', 'WRONG_TEMPLATE', msg, { detected: is2025 ? 'DMMM 2025' : 'unknown' }));
    sub.template_ok = false;
    return sub;
  }
  if (bounds.length !== 9) {
    sub.capability_boundaries_source = 'model config (Summary formulas not found)';
    sub.issues.push(issue('warning', 'SUMMARY_FORMULAS', `Found ${bounds.length} capability formulas in Summary outcome (expected 9); used the configured rows instead.`));
  }

  const cols = model.questionnaire_columns;
  const nameDiffs = [];
  for (const s of model.skills) {
    const nameInFile = q.value(`${cols.skill}${s.row}`);
    const rec = {
      row: s.row,
      capability_id: s.capability_id,
      skill: s.skill,
      owner: s.owner,
      gdm_team: s.gdm_team || null,
      inclusion_raw: q.value(`${cols.inclusion}${s.row}`),
      self_raw: q.value(`${cols.self_current}${s.row}`),
      target_raw: q.value(`${cols.country_target}${s.row}`),
      comments: q.value(`${cols.comments}${s.row}`) ?? null,
      issues: [],
    };
    if (norm(nameInFile) !== norm(s.skill)) nameDiffs.push({ row: s.row, got: nameInFile ?? '', expected: s.skill });
    const p = parseFlag(rec.inclusion_raw);
    rec.inclusion = p.value;
    if (p.issue) {
      rec.inclusion = 1;
      rec.issues.push(`${p.issue}; treated as included`);
      sub.issues.push(issue('warning', 'FLAG_INVALID', `Row ${s.row} ${s.skill}: ${p.issue}; treated as included (P=1)`, { row: s.row }));
    }
    const k = parseRating(rec.self_raw, model.valid_scores);
    const l = parseRating(rec.target_raw, model.valid_scores);
    rec.self_current = k.value;
    rec.country_target = l.value;
    if (k.issue && k.issue !== 'missing') rec.issues.push(`self-rating ${k.issue}`);
    if (l.issue && l.issue !== 'missing') rec.issues.push(`target ${l.issue}`);
    sub.skills.push(rec);
  }

  if (nameDiffs.length) {
    const shown = nameDiffs.slice(0, 3).map((d) => `row ${d.row} "${d.got}" (expected "${d.expected}")`).join('; ');
    sub.issues.push(issue('error', 'SKILL_MISMATCH', `${nameDiffs.length} skill name(s) differ from the DMMM ${model.assessment_year} template: ${shown}${nameDiffs.length > 3 ? '; ...' : ''}. The file was not scored.`, { rows: nameDiffs.map((d) => d.row) }));
  }

  // ---- General questions (informational) -------------------------------------------------
  const gq = wb.sheet(model.sheets.general);
  if (gq) for (const g of model.general_questions) sub.general[g.key] = gq.value(g.cell) ?? null;

  // ---- Parse check: reproduce the workbook's own Summary formula from the parsed cells ------
  // The workbook averages Summary column G (= K, blank counted as 0, P ignored). If our reading
  // of K reproduces the cached Summary!D8, the parse is proven to match what Excel calculated.
  const cachedOverall = summary.value('D8');
  if (typeof cachedOverall === 'number') {
    const caps = model.capabilities.map((cap) => mean(sub.skills.filter((x) => x.capability_id === cap.id).map((x) => {
      const v = parseRating(x.self_raw, model.valid_scores).value; return v ?? 0;
    })));
    const ours = mean(caps);
    const anyInput = sub.skills.some((x) => !isBlank(x.self_raw));
    sub.parse_check = { workbook_cached_overall: cachedOverall, reproduced: ours, match: Math.abs(ours - cachedOverall) < 1e-6 };
    if (anyInput && !sub.parse_check.match) {
      sub.issues.push(issue('warning', 'PARSE_CHECK', `Reading check: the workbook's own Summary shows ${cachedOverall.toFixed(3)} but the parsed cells give ${ours.toFixed(3)}. The file may not have been recalculated before saving; values were read from the questionnaire cells.`));
    }
  } else {
    sub.parse_check = { workbook_cached_overall: null, reproduced: null, match: null };
  }

  sub.template_ok = !sub.issues.some((i) => ['SKILL_MISMATCH', 'WRONG_TEMPLATE', 'SHEETS_MISSING'].includes(i.code) && i.level === 'error');
  return sub;
}
