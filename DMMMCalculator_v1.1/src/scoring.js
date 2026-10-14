// DMMM 2026 scoring rules. Pure functions, no I/O.
//
//  * A skill counts only when its inclusion flag (column P) is 1. P = 0 removes it from both
//    numerator and denominator. A rating of 0 in K or L is a valid score ("Missing" level) and
//    is averaged like any other score.
//  * Capability score = unweighted mean of the valid, included skill scores of that capability.
//  * Overall score = unweighted mean of the 9 capability scores (never a flat mean of skills).
//  * Self Current     = country-owned rows, column K.
//  * Country Target   = column L of included rows the country filled (GDM rows only if the
//                       country entered a target there). Global never writes targets.
//  * Validated Current = country-owned K + GDM-resolved values for GDM-managed rows. It exists
//                       only when every included GDM row is resolved and country input is complete.

import { mean } from './util.js';

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
  const own = sub.skills.filter((s) => s.owner === 'country' && s.inclusion === 1);
  const missingSelf = own.filter((s) => s.self_current === null);
  const missingTarget = own.filter((s) => s.country_target === null);
  let status = COUNTRY_STATUS.COMPLETE;
  if (missingSelf.length === own.length && missingTarget.length === own.length) status = COUNTRY_STATUS.NOT_STARTED;
  else if (missingSelf.length || missingTarget.length) status = COUNTRY_STATUS.INCOMPLETE;
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
    const included = skills.filter((s) => s.inclusion === 1);
    const ownIncl = included.filter((s) => s.owner === 'country');
    const gdmIncl = included.filter((s) => s.owner === 'gdm');

    const selfVals = ownIncl.map((s) => s.self_current).filter((v) => v !== null);
    const targetVals = included.map((s) => s.country_target).filter((v) => v !== null);

    let validatedComplete = ownIncl.every((s) => s.self_current !== null);
    const validatedVals = [...selfVals];
    let gdmResolved = 0, gdmPending = 0, gdmExcluded = 0;
    for (const s of gdmIncl) {
      const r = gdm?.get(s.row);
      if (r && r.final_state === 'resolved') { validatedVals.push(r.final_value); gdmResolved++; }
      else if (r && r.final_state === 'excluded') gdmExcluded++;
      else { gdmPending++; validatedComplete = false; }
    }
    return {
      id: cap.id,
      name: cap.name,
      short_name: cap.short_name,
      n_skills: skills.length,
      n_included: included.length,
      n_excluded_p0: skills.length - included.length,
      n_country_included: ownIncl.length,
      n_gdm_included: gdmIncl.length,
      n_self_valid: selfVals.length,
      n_target_valid: targetVals.length,
      gdm_resolved: gdmResolved,
      gdm_pending: gdmPending,
      gdm_excluded: gdmExcluded,
      self_current: mean(selfVals),
      country_target: mean(targetVals),
      validated_current: validatedComplete && validatedVals.length ? mean(validatedVals) : null,
    };
  });

  const all = (k) => (caps.every((c) => c[k] !== null) ? mean(caps.map((c) => c[k])) : null);
  return {
    capabilities: caps,
    self_current: all('self_current'),
    country_target: all('country_target'),
    validated_current: all('validated_current'),
    gdm_rows_pending: caps.reduce((a, c) => a + c.gdm_pending, 0),
    excluded_p0: caps.reduce((a, c) => a + c.n_excluded_p0, 0),
  };
}
