import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTestConfig, makeCountryWorkbook } from './support/fixtures.js';
import { parseCountryWorkbook } from '../src/parser.js';
import { IdentityResolver } from '../src/identity.js';
import { scoreSubmission, countryInputStatus, COUNTRY_STATUS } from '../src/scoring.js';
import { parseRating } from '../src/util.js';

const cfg = loadTestConfig();
const resolver = new IdentityResolver(cfg);
const model = cfg.model;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

async function parse(opts) {
  const bytes = await makeCountryWorkbook(cfg, opts);
  return parseCountryWorkbook(bytes, 'synthetic.xlsx', cfg, resolver);
}

test('Germany Seeds identity: DE + Seeds -> EUR / Germany / Seeds / Europe', async () => {
  const s = await parse({ market: 'DE', bu: 'Seeds' });
  assert.equal(s.identity.region, 'EUR');
  assert.equal(s.identity.country_name, 'Germany');
  assert.equal(s.business_unit, 'Seeds');
  assert.equal(s.identity.profile, 'Europe');
  assert.equal(s.key, 'DE|Seeds|2026');
  assert.equal(s.template_ok, true);
});

test('AMEA markets get the AMEA profile; the rest of the world uses Europe', async () => {
  for (const [m, region, profile] of [['Iran', 'AMEA', 'AMEA'], ['Russia', 'AMEA', 'AMEA'], ['KOREA-SOUTH', 'AMEA', 'AMEA'], ['TURKIYE', 'AMEA', 'AMEA'], ['Brazil', 'LATAM', 'Europe'], ['USA', 'NA', 'Europe'], ['Japan', 'JANZ', 'Europe']]) {
    const r = resolver.resolveCountry(m);
    assert.equal(r.country.region, region, m);
    assert.equal(r.country.profile, profile, m);
  }
});

test('capability boundaries are read from Summary outcome formulas', async () => {
  const s = await parse({});
  assert.equal(s.capability_boundaries_source, 'Summary outcome formulas');
  assert.ok(!s.issues.some((i) => i.code === 'BOUNDARY_MISMATCH'));
});

test('missing GDM data never blanks country self current and target', async () => {
  const s = await parse({});
  const sc = scoreSubmission(s, new Map(), model);
  close(sc.self_current, 2);
  close(sc.country_target, 3);
  assert.equal(sc.validated_current, null);
  assert.equal(sc.gdm_rows_pending, 10);
  assert.equal(countryInputStatus(s).status, COUNTRY_STATUS.COMPLETE);
});

test('overall = mean of 9 capability scores, not a flat mean of skills', async () => {
  // Influencer Marketing (5 skills) all 4, everything else 0: equal weighting gives 4/9.
  const s = await parse({ k: (row, sk) => (sk.owner === 'gdm' ? null : sk.capability_id === 'IMP' ? 4 : 0) });
  const sc = scoreSubmission(s, new Map(), model);
  close(sc.self_current, 4 / 9);
  const flat = 5 * 4 / 76;
  assert.notEqual(Math.round(sc.self_current * 1000), Math.round(flat * 1000));
});

test('P=0 removes the skill from numerator and denominator; a rating of 0 is a valid score', async () => {
  // Paid media: PMAX (31) and Demand Gen (32) excluded and rated 0 (would drag the mean if counted)
  const s = await parse({
    p: (row) => (row === 31 || row === 32 ? 0 : 1),
    k: (row, sk) => (sk.owner === 'gdm' ? null : row === 31 || row === 32 ? 0 : row === 25 ? 0 : 3),
  });
  const pdm = scoreSubmission(s, new Map(), model).capabilities.find((c) => c.id === 'PDM');
  assert.equal(pdm.n_excluded_p0, 2);
  // 12 skills, 2 excluded -> 10 counted: one 0 (row 25) and nine 3s
  close(pdm.self_current, 27 / 10);
});

test('missing included country rating -> Incomplete, but other scores still shown', async () => {
  const s = await parse({ k: (row, sk) => (sk.owner === 'gdm' || row === 6 ? null : 2) });
  const st = countryInputStatus(s);
  assert.equal(st.status, COUNTRY_STATUS.INCOMPLETE);
  assert.deepEqual(st.missingSelf.map((x) => x.row), [6]);
  const sc = scoreSubmission(s, new Map(), model);
  close(sc.self_current, 2);
});

test('missing rating on an excluded skill does not make the input incomplete', async () => {
  const s = await parse({ p: (row) => (row === 31 ? 0 : 1), k: (row, sk) => (sk.owner === 'gdm' || row === 31 ? null : 2), l: (row, sk) => (sk.owner === 'gdm' || row === 31 ? null : 3) });
  assert.equal(countryInputStatus(s).status, COUNTRY_STATUS.COMPLETE);
});

test('empty template -> Not started and identity error when Sign-up is blank', async () => {
  const s = await parse({ market: null, bu: null, k: () => null, l: () => null });
  assert.equal(countryInputStatus(s).status, COUNTRY_STATUS.IDENTITY_ERROR);
  const s2 = await parse({ k: () => null, l: () => null });
  assert.equal(countryInputStatus(s2).status, COUNTRY_STATUS.NOT_STARTED);
});

test('ratings accept numbers, numeric text and drop-down labels; reject out of range', () => {
  assert.equal(parseRating(3).value, 3);
  assert.equal(parseRating('3').value, 3);
  assert.equal(parseRating('(2) Vision exists').value, 2);
  assert.equal(parseRating(0).value, 0);
  assert.equal(parseRating(5).issue, 'out of range (5)');
  assert.equal(parseRating(2.5).value, null);
  assert.equal(parseRating(null).issue, 'missing');
});

test('reading check reproduces the workbook own Summary value', async () => {
  const s = await parse({ k: (row, sk) => (sk.owner === 'gdm' ? null : row % 5) });
  assert.equal(s.parse_check.match, true);
});

test('a changed questionnaire layout is reported, not silently scored', async () => {
  const s = await parse({ mutate: (wb) => { wb.getWorksheet('DMMM Questionnaire').getCell('C20').value = 'Some other skill'; } });
  assert.equal(s.template_ok, false);
  assert.ok(s.issues.some((i) => i.code === 'SKILL_MISMATCH' && i.rows.includes(20)));
  assert.equal(s.issues.filter((i) => i.code === 'SKILL_MISMATCH').length, 1, 'one message, not one per row');
});

test('a DMMM 2025 workbook is rejected with one clear message', async () => {
  const s = await parse({ market: 'Argentina', bu: 'Crop Protection', mutate: (wb) => {
    const q = wb.getWorksheet('DMMM Questionnaire');
    q.getCell('K4').value = 'Weighting'; q.getCell('L4').value = 'Weighted Rating'; q.getCell('P4').value = null;
    q.getCell('C10').value = 'MaSE Module';
  } });
  assert.equal(s.template_ok, false);
  const errs = s.issues.filter((i) => i.level === 'error');
  assert.equal(errs.length, 1);
  assert.equal(errs[0].code, 'WRONG_TEMPLATE');
  assert.match(errs[0].message, /DMMM 2025 workbook/);
  assert.equal(s.skills.length, 0, 'nothing is read from a wrong template');
});
