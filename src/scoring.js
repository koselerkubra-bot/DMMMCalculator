// DMMM 2026 scoring rules. Pure functions, no I/O.
//
// The scores reproduce the workbook's own "Summary outcome" sheet exactly:
//  * Capability score = AVERAGE of column K over all rows of that capability (fixed ranges),
//    the way Summary column G references them: an empty K counts as 0, a cell holding text
//    (e.g. a non-breaking space or "3" typed as text) is ignored, numbers count as they are.
//  * Column P (inclusion) is not used by the Summary, so it is not used here either.
//  * Overall score = AVERAGE of the 9 capability scores.
//  * Country Target = the same over column L (all rows, empty = 0), like Summary column H.
//  * Self Current      = country-owned rows only (GDM rows left out), same cell rules.
//  * Validated Current = country-owned K + Global Metrics values on the GDM rows. When the
//    Global Metrics values equal the GDM values in the workbook, this equals Summary!D8.
//    It exists only when every GDM row is resolved.

import { mean } from './util.js';

/** Value of a questionnaire cell as Excel's AVERAGE sees it through a reference. */
export function excelCellValue(raw) {
  if (raw === null || raw === undefined) return 0;          // empty cell -> reference returns 0
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  return null;                                               // text, booleans, errors: ignored
}
const avg = (vals) => { const v = vals.filter((x) => x !== null); return v.length ? mean(v) : null; };

export const COUNTRY_STATUS = {
  COMPLETE: 'Complete',
  INCOMPLETE: 'Incomplete country-owned inputs',
  NOT_STARTED: 'Not started (no country ratings)',
  TEMPLATE_ERROR: 'Template error',
  IDENTITY_ERROR: 'Identity error',
  DUPLICATE: 'Duplicate - choose active version',
};

export const GDM_STATUS = {
  PENDING: 'Pending Global Data',
  REVIEW: 'Ready for Global review',
  VALIDATED: 'Validated',
  CONFLICT: 'Validation conflict',
  NOT_APPLICABLE: 'Not applicable',
};

export function countryInputStatus(sub) {
  if (!sub.template_ok) return { status: COUNTRY_STATUS.TEMPLATE_ERROR, missingSelf: [], missingTarget: [] };
  if (!sub.key) return { status: COUNTRY_STATUS.IDENTITY_ERROR, missingSelf: [], missingTarget: [] };
  const own = sub.skills.filter((s) => s.owner === 'country');
  // Informational only (counted as 0 or ignored, exactly like the Summary outcome sheet).
  const notNumber = (v) => typeof v !== 'number';
  const missingSelf = own.filter((s) => notNumber(s.self_raw));
  const missingTarget = sub.skills.filter((s) => notNumber(s.target_raw));
  const anyRating = own.some((s) => typeof s.self_raw === 'number');
  const status = own.length && !anyRating ? COUNTRY_STATUS.NOT_STARTED : COUNTRY_STATUS.COMPLETE;
  return { status, missingSelf, missingTarget };
}

/**
 * @param sub        parsed submission
 * @param gdm        Map(row -> resolution) from validation.resolveSubmission(); may be empty
 * @param model      cfg.model
 */
export function scoreSubmission(sub, gdm, model) {
  const caps = model.capabilities.map((cap) => {
    const skills = sub.skills.filter((s) => s.capability_id === cap.id);
    const own = skills.filter((s) => s.owner === 'country');
    const gdmRows = skills.filter((s) => s.owner === 'gdm');
    const K = (s) => excelCellValue(s.self_raw);
    const L = (s) => excelCellValue(s.target_raw);

    const selfVals = own.map(K);
    const targetVals = skills.map(L);

    let validatedComplete = true;
    const validatedVals = [...selfVals];
    let gdmResolved = 0, gdmPending = 0, gdmExcluded = 0;
    for (const s of gdmRows) {
      const r = gdm?.get(s.row);
      if (r && r.final_state === 'resolved') { validatedVals.push(r.final_value); gdmResolved++; }
      else if (r && r.final_state === 'excluded') { validatedVals.push(K(s)); gdmExcluded++; }
      else { gdmPending++; validatedComplete = false; }
    }
    const isEmpty = (v) => v === null || v === undefined;
    const isText = (v) => !isEmpty(v) && typeof v !== 'number';
    return {
      id: cap.id,
      name: cap.name,
      short_name: cap.short_name,
      n_skills: skills.length,
      n_included: skills.length,
      n_excluded_p0: skills.filter((s) => s.inclusion === 0).length, // informational: P is not used
      n_country_included: own.length,
      n_self_blank: own.filter((s) => isEmpty(s.self_raw)).length,   // counted as 0
      n_self_text: own.filter((s) => isText(s.self_raw)).length,     // ignored
      n_target_blank: skills.filter((s) => isEmpty(s.target_raw)).length,
      n_target_text: skills.filter((s) => isText(s.target_raw)).length,
      n_gdm_included: gdmRows.length,
      n_self_valid: selfVals.filter((v) => v !== null).length,
      n_target_valid: targetVals.filter((v) => v !== null).length,
      gdm_resolved: gdmResolved,
      gdm_pending: gdmPending,
      gdm_excluded: gdmExcluded,
      self_current: avg(selfVals),
      country_target: avg(targetVals),
      validated_current: validatedComplete ? avg(validatedVals) : null,
    };
  });

  const all = (k) => avg(caps.map((c) => c[k]));
  const sum = (k) => caps.reduce((a, c) => a + c[k], 0);
  return {
    capabilities: caps,
    self_current: all('self_current'),
    country_target: all('country_target'),
    validated_current: caps.some((c) => c.gdm_pending > 0) ? null : all('validated_current'),
    gdm_rows_pending: sum('gdm_pending'),
    excluded_p0: sum('n_excluded_p0'),
    self_blank: sum('n_self_blank'),
    self_text: sum('n_self_text'),
    target_blank: sum('n_target_blank'),
    target_text: sum('n_target_text'),
    capabilities_without_data: caps.filter((c) => c.self_current === null).map((c) => c.name),
  };
}
