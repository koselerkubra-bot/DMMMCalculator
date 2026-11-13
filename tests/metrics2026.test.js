import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTestConfig, makeCountryWorkbook, makeMetrics2026Workbook } from './support/fixtures.js';
import { Portfolio } from '../src/portfolio.js';
import { buildProposal } from '../src/validation.js';
import { identityFromFileName } from '../src/parser.js';
import { IdentityResolver } from '../src/identity.js';

const cfg = loadTestConfig();
const skill = (row) => cfg.metrics.skills.find((s) => s.row === row);

// BU, REGION, COUNTRY, DMS, Canva, Trinity, Emplifi, Technical UX, SEO Health (raw), CWV, Schema, MC, List health, basis
const DE_CP = ['CP', 'EUR', 'Germany', 0, 1, 2, 2, 2, 73, 3, 4, 4, 4, '5 page checks'];
const FR_S = ['Seeds', 'EUR', 'France', 0, 1, 2, 2, 2, 91, 3, 4, 1, 4, 'sample'];

test('2026 GDM layout: identity read by header (BU, REGION, COUNTRY), all markets matched', async () => {
  const p = new Portfolio(cfg);
  const m = await p.setGlobalMetrics(await makeMetrics2026Workbook([DE_CP, FR_S]), '2026 Europe Global Metrics.xlsx');
  assert.equal(m.unmatched.length, 0);
  assert.equal(m.rows.length, 2);
  assert.equal(m.identity_columns.source, 'header');
  assert.deepEqual(m.columns_missing, []);
  const de = m.rows.find((r) => r.identity.country_id === 'DE');
  assert.equal(de.business_unit, 'CP');
  assert.equal(de.informational['Assessment basis'], '5 page checks');
});

test('2026 GDM layout: new headers map to the questionnaire rows', async () => {
  const p = new Portfolio(cfg);
  const m = await p.setGlobalMetrics(await makeMetrics2026Workbook([DE_CP]), 'gm.xlsx');
  const v = m.rows[0].values;
  const lvl = (row) => buildProposal(skill(row), v[row], cfg).proposed_level;
  assert.equal(lvl(60), 2); // Technical UX Health -> Web Performance & Accessibility
  assert.equal(lvl(70), 3); // Web Vitals & Page Experience -> Core Web Vitals & Page Experience
  assert.equal(lvl(71), 4); // Schema Validity Score
  assert.equal(lvl(90), 4); // List Health & Deliverability (trailing space)
});

test('SEO Health Score without a level column: level derived from the SEMrush thresholds', async () => {
  const p = new Portfolio(cfg);
  const m = await p.setGlobalMetrics(await makeMetrics2026Workbook([DE_CP, FR_S]), 'gm.xlsx');
  const de = buildProposal(skill(69), m.rows.find((r) => r.identity.country_id === 'DE').values[69], cfg);
  assert.equal(de.proposed_level, 2); // 73 -> band 60-74
  assert.equal(de.state, 'proposed');
  const fr = buildProposal(skill(69), m.rows.find((r) => r.identity.country_id === 'FR').values[69], cfg);
  assert.equal(fr.proposed_level, 4); // 91 -> Level 4 candidate only
  assert.equal(fr.l4_candidate_only, true);
});

test('Level 4 candidate from a raw score goes to review, lower levels are accepted', async () => {
  const p = new Portfolio(cfg);
  await p.addCountryFile(await makeCountryWorkbook(cfg, { market: 'France', bu: 'Seeds' }), 'fr.xlsm');
  await p.addCountryFile(await makeCountryWorkbook(cfg, { market: 'Germany', bu: 'CP' }), 'de.xlsm');
  await p.setGlobalMetrics(await makeMetrics2026Workbook([DE_CP, FR_S]), 'gm.xlsx');
  const rows = p.compute();
  const fr = rows.find((r) => r.identity.country_id === 'FR');
  const de = rows.find((r) => r.identity.country_id === 'DE');
  assert.equal(fr.gdm.rows.get(69).final_state, 'review');
  assert.match(fr.gdm.rows.get(69).status, /candidate/);
  assert.equal(de.gdm.rows.get(69).final_value, 2);
  assert.equal(de.gdm.rows.get(69).status, 'Accepted from Global Metrics');
});

test('Blank Sign-up identity falls back to the file name, with a warning', async () => {
  const p = new Portfolio(cfg);
  const e = await p.addCountryFile(await makeCountryWorkbook(cfg, { market: null, bu: null }), 'DMMM_2026_GERMANY_CP.xlsm');
  assert.match(e.outcome, /Added/);
  const r = p.compute()[0];
  assert.equal(r.identity.country_id, 'DE');
  assert.equal(r.business_unit, 'CP');
  const resolver = new IdentityResolver(cfg);
  assert.deepEqual(identityFromFileName('DMMM 2026 - Czech Republic Seeds.xlsx', resolver), { market: 'Czech Republic', bu: 'Seeds' });
  assert.equal(identityFromFileName('report.xlsx', resolver).market, null);
});

test('SEO Health Score written as "69 (3)": the GDM level in brackets is used, no conflict', async () => {
  const BG = ['CP', 'EUR', 'Bulgaria', 0, 0, 2, 2, 1, '69 (3)', 2, 4, 2, 2, 'origin CWV'];
  const GR = ['CP', 'EUR', 'Greece', 0, 0, 2, 2, 1, '83 (4)', 2, 4, 2, 2, 'origin CWV'];
  const p = new Portfolio(cfg);
  await p.addCountryFile(await makeCountryWorkbook(cfg, { market: 'Bulgaria', bu: 'CP' }), 'bg.xlsm');
  await p.addCountryFile(await makeCountryWorkbook(cfg, { market: 'Greece', bu: 'CP' }), 'gr.xlsm');
  const m = await p.setGlobalMetrics(await makeMetrics2026Workbook([BG, GR]), 'gm.xlsx');
  const bgProp = buildProposal(skill(69), m.rows.find((r) => r.identity.country_id === 'BG').values[69], cfg);
  assert.equal(bgProp.proposed_level, 3);
  assert.equal(bgProp.raw_value, 69);
  assert.equal(bgProp.derived_from_raw, 2);
  assert.match(bgProp.notes[0], /given by GDM/);
  const rows = p.compute();
  const bg = rows.find((r) => r.identity.country_id === 'BG').gdm.rows.get(69);
  const gr = rows.find((r) => r.identity.country_id === 'GR').gdm.rows.get(69);
  assert.equal(bg.final_value, 3);
  assert.equal(bg.final_state, 'resolved');
  assert.equal(gr.final_value, 4);
  assert.equal(gr.final_state, 'resolved');
});
