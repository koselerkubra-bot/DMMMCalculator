// Canonical identity: country_id + business_unit + assessment_year.
import { norm, compact } from './util.js';

const BU_SEEDS = /\b(SEEDS?|SEMENTES|SEMILLAS)\b|\(S\)/;
const BU_CP = /\bCROP PROTECTION\b|\bCP\b/;

/** Split a free-text market label ("Germany Seed", "TR-CP", "Spain*", "US NEW 2026") into a country part and a BU hint. */
export function splitMarketLabel(raw) {
  let s = norm(raw).replace(/\*/g, ' ').replace(/\bNEW\s+20\d\d\b/g, ' ');
  let bu = null;
  if (BU_SEEDS.test(s)) bu = 'Seeds';
  else if (BU_CP.test(s)) bu = 'CP';
  else if (/[\s-]+S$/.test(s) && s.replace(/[\s-]+S$/, '').length > 1 && /-\s*S$/.test(s)) bu = 'Seeds';
  s = s.replace(/\bCROP PROTECTION\b/g, ' ')
    .replace(/\b(SEEDS?|SEMENTES|SEMILLAS)\b/g, ' ')
    .replace(/\(S\)/g, ' ')
    .replace(/[\s-]+CP(\s*&\s*S)?$/g, ' ')
    .replace(/\s+-\s*S$/g, ' ')
    .replace(/^-+|[-–,.]+$/g, ' ')
    .replace(/\s+-\s+$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/\s*-$/, '').trim();
  return { country: s, buHint: bu };
}

export class IdentityResolver {
  constructor(cfg) {
    this.cfg = cfg;
    const am = cfg.aliases;
    this.byId = new Map(am.countries.map((c) => [c.id, c]));
    this.index = new Map();
    for (const c of am.countries) {
      for (const a of [c.id, c.name, ...c.aliases]) {
        for (const key of [norm(a), compact(a)]) {
          const prev = this.index.get(key);
          if (prev && prev !== c.id) this.index.set(key, '__AMBIGUOUS__');
          else this.index.set(key, c.id);
        }
      }
    }
    this.nonCountry = new Set((am.non_country_values || []).map(norm));
    this.buMap = new Map();
    for (const [bu, list] of Object.entries(cfg.model.business_units)) for (const a of list) this.buMap.set(compact(a), bu);
    this.regionMap = new Map();
    for (const [r, list] of Object.entries(am.region_aliases || {})) for (const a of list) this.regionMap.set(compact(a), r);
  }

  normalizeBU(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return { bu: null, issue: 'Business Unit (Sign-up!D9) is empty' };
    const bu = this.buMap.get(compact(raw));
    if (!bu) return { bu: null, issue: `Business Unit "${raw}" is not recognised (expected Crop Protection, Seeds or Other)` };
    return { bu, issue: null };
  }

  normalizeRegion(raw) {
    return this.regionMap.get(compact(raw)) || null;
  }

  /** Resolve a market label to the canonical country record. */
  resolveCountry(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return { country: null, issue: 'Market/Country (Sign-up!D7) is empty' };
    if (this.nonCountry.has(norm(raw))) return { country: null, issue: `"${raw}" is a group, not a single market. Select one market.` };
    const { country, buHint } = splitMarketLabel(raw);
    for (const key of [norm(raw), compact(raw), country, compact(country)]) {
      const id = this.index.get(key);
      if (id === '__AMBIGUOUS__') return { country: null, buHint, issue: `"${raw}" matches more than one country in the Country Alias Master` };
      if (id) return { country: this.describe(id), buHint, matchedOn: key, issue: null };
    }
    return { country: null, buHint, issue: `"${raw}" is not in the Country Alias Master. Add it as an alias in config/country_alias_master.json.` };
  }

  describe(id) {
    const c = this.byId.get(id);
    const profileMap = this.cfg.aliases.template_profiles || {};
    return {
      country_id: c.id,
      country_name: c.name,
      region: c.region,
      subregion: c.subregion || null,
      region_source: c.region_source,
      profile: profileMap[c.region] || profileMap.default || 'Europe',
      lighthouse_bu: c.lighthouse_bu || [],
    };
  }
}

export function identityKey(countryId, bu, year) {
  return `${countryId}|${bu}|${year}`;
}

export const BU_SHORT = { CP: 'CP', Seeds: 'S', Other: 'O' };
