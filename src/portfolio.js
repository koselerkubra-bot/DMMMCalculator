// Portfolio = every submission ever loaded (all versions), the active version per
// country + BU + year, the current Global Metrics import, GDM decisions and history.
// The tracker workbook exported from here is also the saved state: uploading it again
// restores the portfolio so later batches are appended, never overwritten.
import { parseCountryWorkbook } from './parser.js';
import { importGlobalMetrics, resolveSubmission } from './validation.js';
import { importHistory, historyValue } from './history.js';
import { scoreSubmission, countryInputStatus, COUNTRY_STATUS, GDM_STATUS } from './scoring.js';
import { IdentityResolver } from './identity.js';
import { mean, round, nowIso } from './util.js';

export class Portfolio {
  constructor(cfg) {
    this.cfg = cfg;
    this.resolver = new IdentityResolver(cfg);
    this.submissions = [];          // all versions, never removed
    this.active = new Map();        // key -> submission_id
    this.needsChoice = new Set();   // keys with competing versions awaiting a user choice
    this.metrics = null;            // current Global Metrics import
    this.metricsImports = [];       // every import (metadata only)
    this.decisions = new Map();     // `${key}|${row}` -> decision
    this.history = null;
    this.changeLog = [];
    this.intakeLog = [];
  }

  log(type, key, detail) {
    this.changeLog.push({ at: nowIso(), type, key: key || '', detail });
  }

  versionsOf(key) {
    return this.submissions.filter((s) => s.key === key && s.template_ok).sort((a, b) => a.version - b.version);
  }

  /** Add one country workbook. Returns the intake entry. */
  async addCountryFile(bytes, fileName, opts = {}) {
    const dup = this.submissions.find((s) => s.source_file_hash && opts.hash && s.source_file_hash === opts.hash);
    const sub = await parseCountryWorkbook(bytes, fileName, this.cfg, this.resolver, opts);
    const same = dup || this.submissions.find((s) => s.source_file_hash === sub.source_file_hash);
    const entry = { at: nowIso(), file: fileName, submission_id: sub.submission_id, key: sub.key, outcome: '', sub };
    if (same) {
      entry.outcome = `Identical to "${same.source_file_name}" (same file content) - not added again`;
      entry.duplicate_of = same.submission_id;
      this.intakeLog.push(entry);
      return entry;
    }
    if (!sub.key || !sub.template_ok) {
      sub.version = 1;
      sub.active_flag = false;
      this.submissions.push(sub);
      entry.outcome = !sub.template_ok ? 'Not added to results - not a valid DMMM 2026 template' : 'Not added to results - identity could not be resolved';
      this.log('Rejected file', sub.key || '', `"${fileName}": ${sub.issues.filter((i) => i.level === 'error').map((i) => i.message).join(' | ')}`);
      this.intakeLog.push(entry);
      return entry;
    }
    const prior = this.versionsOf(sub.key);
    sub.version = prior.length ? Math.max(...prior.map((p) => p.version)) + 1 : 1;
    this.submissions.push(sub);
    if (!prior.length) {
      this.active.set(sub.key, sub.submission_id);
      entry.outcome = 'Added';
    } else {
      this.needsChoice.add(sub.key);
      entry.outcome = `Another version of ${sub.key} already exists (${prior.map((p) => `v${p.version} ${p.source_file_name}`).join(', ')}). Choose which one is the latest.`;
      entry.needs_choice = true;
    }
    this._syncActiveFlags();
    this.intakeLog.push(entry);
    return entry;
  }

  chooseActive(key, submissionId, reason = 'Selected by user') {
    const sub = this.submissions.find((s) => s.submission_id === submissionId && s.key === key);
    if (!sub) throw new Error(`Submission ${submissionId} is not a version of ${key}`);
    const previous = this.active.get(key);
    this.active.set(key, submissionId);
    this.needsChoice.delete(key);
    this._syncActiveFlags();
    const prevSub = this.submissions.find((s) => s.submission_id === previous);
    const changes = prevSub && prevSub !== sub ? diffSubmissions(prevSub, sub) : [];
    this.log('Active version', key, `v${sub.version} "${sub.source_file_name}" is active (${reason})${prevSub && prevSub !== sub ? `; replaces v${prevSub.version}. ${changes.length} rating(s) changed${changes.length ? ': ' + changes.slice(0, 15).join('; ') : ''}` : ''}`);
  }

  _syncActiveFlags() {
    for (const s of this.submissions) s.active_flag = !!s.key && s.template_ok && this.active.get(s.key) === s.submission_id && !this.needsChoice.has(s.key);
  }

  async setGlobalMetrics(bytes, fileName, opts = {}) {
    const imp = await importGlobalMetrics(bytes, fileName, this.cfg, this.resolver, opts);
    if (imp.issues.some((i) => i.level === 'error')) return imp;
    if (this.metrics && this.metrics.source_file_hash !== imp.source_file_hash) {
      const changed = diffMetrics(this.metrics, imp);
      this.log('Global Metrics', '', `"${imp.source_file_name}" replaces "${this.metrics.source_file_name}". ${changed.length} value(s) changed${changed.length ? ': ' + changed.slice(0, 20).join('; ') : ''}`);
    } else if (!this.metrics) {
      this.log('Global Metrics', '', `"${imp.source_file_name}" loaded: ${imp.rows.length} market rows, ${imp.unmatched.length} unmatched`);
    }
    this.metrics = imp;
    this.metricsImports.push({ import_id: imp.import_id, source_file_name: imp.source_file_name, imported_at: imp.imported_at, rows: imp.rows.length });
    return imp;
  }

  async setHistory(bytes, fileName) {
    this.history = await importHistory(bytes, fileName, this.cfg, this.resolver);
    this.log('History', '', `"${fileName}" loaded: ${this.history.records.size} markets, ${this.history.reconciliation.length} cross-tab differences`);
    return this.history;
  }

  setDecision(key, row, d) {
    const id = `${key}|${row}`;
    const prev = this.decisions.get(id);
    if (!d || !d.decision) { if (prev) { this.decisions.delete(id); this.log('GDM decision', key, `Row ${row}: decision cleared`); } return; }
    const same = prev && prev.decision === d.decision && String(prev.override_score ?? '') === String(d.override_score ?? '');
    this.decisions.set(id, { ...d, key, row });
    if (!same) this.log('GDM decision', key, `Row ${row}: ${d.decision}${d.override_score !== undefined && d.override_score !== null && d.override_score !== '' ? ' ' + d.override_score : ''} by ${d.reviewer || 'unknown reviewer'}${d.rationale ? ' - ' + d.rationale : ''}`);
  }

  activeSubmissions() {
    const keys = new Set(this.submissions.filter((s) => s.key && s.template_ok).map((s) => s.key));
    return [...keys].map((key) => ({ key, sub: this.submissions.find((s) => s.submission_id === this.active.get(key)) || null, versions: this.versionsOf(key) }));
  }

  /** Build every result row. Pure read of the current state. */
  compute() {
    const model = this.cfg.model;
    const rows = [];
    for (const { key, sub, versions } of this.activeSubmissions()) {
      const choice = this.needsChoice.has(key);
      const base = choice ? versions[versions.length - 1] : sub;
      const metricsRec = this.metrics?.rows.find((r) => r.key === key) || null;
      const ci = countryInputStatus(base);
      const gdm = resolveSubmission(base, metricsRec, this.decisions, this.cfg);
      const scores = scoreSubmission(base, gdm.rows, model);
      const key2 = `${base.identity.country_id}|${base.business_unit}`;
      const h = (year, measure, cap) => historyValue(this.history, key2, year, measure, cap);
      const validated = ci.status === COUNTRY_STATUS.COMPLETE && gdm.status === GDM_STATUS.VALIDATED ? scores.validated_current : null;
      rows.push({
        key,
        key2,
        sub: base,
        versions,
        needs_choice: choice,
        identity: base.identity,
        business_unit: base.business_unit,
        country_status: choice ? COUNTRY_STATUS.DUPLICATE : ci.status,
        missing_self: ci.missingSelf,
        missing_target: ci.missingTarget,
        gdm,
        gdm_status: choice ? '-' : gdm.status,
        scores,
        self_current: choice ? null : scores.self_current,
        country_target: choice ? null : scores.country_target,
        validated_current: choice ? null : validated,
        metricsRec,
        history: {
          overall: Object.fromEntries(model.history.results_columns_overall.map((label) => {
            const p = /^(20\d\d)\s+(.*)$/.exec(label);
            const year = Number(p[1]);
            const measure = /target/i.test(p[2]) ? 'overall_target' : 'overall_current';
            return [label, h(year, measure)];
          })),
          cap: Object.fromEntries(model.capabilities.map((c) => [c.id, {
            current: Object.fromEntries(model.history.results_capability_years.current.map((y) => [y, h(y, 'cap_current', c.id)])),
            goal: Object.fromEntries(model.history.results_capability_years.goal.map((y) => [y, h(y, 'cap_goal', c.id)])),
          }])),
          lighthouse_2025: this.history?.records.get(key2)?.lighthouse || false,
        },
      });
    }
    // Benchmarks on validated scores only, once enough validated records exist
    const minN = model.benchmarks.min_records_for_average;
    const val = rows.filter((r) => r.validated_current !== null);
    const avg = (xs) => (xs.length >= minN ? mean(xs.map((r) => r.validated_current)) : null);
    const globalAvg = avg(val);
    for (const r of rows) {
      const regionVals = val.filter((x) => x.identity.region === r.identity.region);
      const buVals = val.filter((x) => x.business_unit === r.business_unit);
      const regionAvg = avg(regionVals);
      const prev = r.history.overall['2025 Current Maturity'];
      const tgt2026 = r.history.overall['2026 Target Maturity'];
      const has = (v) => v !== null && v !== undefined;
      const met = (v) => (has(v) && has(tgt2026) ? (round(v, 1) >= tgt2026 ? 'Yes' : 'No') : null);
      r.bench = {
        region_avg: regionAvg, region_n: regionVals.length,
        bu_avg: avg(buVals), bu_n: buVals.length,
        global_avg: globalAvg, global_n: val.length,
        vs_region: has(r.validated_current) && has(regionAvg) ? r.validated_current - regionAvg : null,
        // Official YoY: validated 2026 vs 2025 current (2025 also included GDM data -> same basis)
        yoy: has(r.validated_current) && has(prev) ? r.validated_current - prev : null,
        // Provisional YoY: country self-assessment vs 2025 current, available before GDM data
        yoy_self: has(r.self_current) && has(prev) ? r.self_current - prev : null,
        target_2026_met: met(r.validated_current),
        target_2026_met_self: met(r.self_current),
      };
      r.yoy_status = r.needs_choice ? null : !this.history ? 'No 2025 tracker loaded' : has(prev) ? 'Compared with 2025' : 'New in 2026 (no 2025 result)';
      r.yoy_cap = Object.fromEntries(r.scores.capabilities.map((c) => {
        const p25 = r.history.cap[c.id].current[2025];
        const v = r.validated_current === null ? null : c.validated_current;
        return [c.id, { prev: has(p25) ? p25 : null, self: r.needs_choice ? null : c.self_current, validated: v,
          d_self: !r.needs_choice && has(p25) && has(c.self_current) ? c.self_current - p25 : null,
          d_validated: has(p25) && has(v) ? v - p25 : null }];
      }));
      r.lighthouse = (r.identity.lighthouse_bu || []).includes(r.business_unit);
    }
    rows.sort((a, b) => regionOrder(a.identity.region) - regionOrder(b.identity.region) || a.business_unit.localeCompare(b.business_unit) || a.identity.country_name.localeCompare(b.identity.country_name));
    return rows;
  }
}

/** Markets present in the 2025 tracker that have no 2026 file yet. */
export function missingFrom2026(portfolio, rows) {
  if (!portfolio.history) return [];
  const have = new Set(rows.map((r) => r.key2));
  const out = [];
  for (const rec of portfolio.history.records.values()) {
    if (have.has(rec.key)) continue;
    const [id, bu] = rec.key.split('|');
    const c = portfolio.resolver.byId.get(id);
    const v = rec.values.get('2025|overall_current|');
    out.push({ key: rec.key, country_id: id, country_name: c?.name || id, region: c?.region || '', business_unit: bu, current_2025: v ? v.value : null });
  }
  const ro = (r) => { const i = ['EUR', 'AMEA', 'LATAM', 'NA', 'JANZ'].indexOf(r); return i < 0 ? 99 : i; };
  return out.sort((a, b) => ro(a.region) - ro(b.region) || a.country_name.localeCompare(b.country_name));
}

const REGION_ORDER = ['EUR', 'AMEA', 'LATAM', 'NA', 'JANZ'];
export function regionOrder(r) { const i = REGION_ORDER.indexOf(r); return i < 0 ? 99 : i; }

export function diffSubmissions(a, b) {
  const out = [];
  const byRow = new Map(a.skills.map((s) => [s.row, s]));
  for (const s of b.skills) {
    const p = byRow.get(s.row);
    if (!p) continue;
    for (const [f, label] of [['self_current', 'K'], ['country_target', 'L'], ['inclusion', 'P']]) {
      if ((p[f] ?? null) !== (s[f] ?? null)) out.push(`row ${s.row} ${label} ${p[f] ?? 'blank'} -> ${s[f] ?? 'blank'}`);
    }
  }
  return out;
}

export function diffMetrics(a, b) {
  const out = [];
  const old = new Map(a.rows.map((r) => [r.key, r]));
  for (const r of b.rows) {
    const p = old.get(r.key);
    for (const [row, v] of Object.entries(r.values)) {
      const pv = p?.values?.[row];
      if (String(pv?.level_raw ?? '') !== String(v.level_raw ?? '')) out.push(`${r.key} row ${row}: ${pv?.level_raw ?? 'blank'} -> ${v.level_raw ?? 'blank'}`);
    }
  }
  return out;
}
