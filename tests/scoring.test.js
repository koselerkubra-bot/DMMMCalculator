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

test('column P is not used, like the Summary outcome sheet; a rating of 0 is a valid score', async () => {
  // Paid media: rows 31 and 32 have P=0 and K=0; the Summary still averages them.
  const s = await parse({
    p: (row) => (row === 31 || row === 32 ? 0 : 1),
    k: (row, sk) => (sk.owner === 'gdm' ? null : row === 31 || row === 32 ? 0 : row === 25 ? 0 : 3),
  });
  const pdm = scoreSubmission(s, new Map(), model).capabilities.find((c) => c.id === 'PDM');
  assert.equal(pdm.n_excluded_p0, 2); // reported only
  // 12 skills, all counted: three 0s (rows 25, 31, 32) and nine 3s
  close(pdm.self_current, 27 / 12);
});

test('blank self-rating counts as 0 and text is ignored, exactly like the Summary outcome', async () => {
  // Row 6 blank (-> 0), row 7 holds a non-breaking space (-> ignored), the rest 3.
  const s = await parse({ k: (row, sk) => (sk.owner === 'gdm' ? null : row === 6 ? null : row === 7 ? '\u00a0' : 3) });
  const st = countryInputStatus(s);
  assert.equal(st.status, COUNTRY_STATUS.COMPLETE);
  assert.deepEqual(st.missingSelf.map((x) => x.row).sort((a, b) => a - b), [6, 7]);
  const sc = scoreSubmission(s, new Map(), model);
  const cap = sc.capabilities.find((c) => c.n_self_blank === 1);
  const n = cap.n_country_included; // includes rows 6 and 7
  close(cap.self_current, ((n - 2) * 3 + 0) / (n - 1)); // row 6 = 0 counted, row 7 ignored
  assert.equal(sc.self_blank, 1);
  assert.equal(sc.self_text, 1);
});

test('blank target counts as 0 over all rows, GDM rows included', async () => {
  const s = await parse({ k: (row, sk) => (sk.owner === 'gdm' ? null : 2), l: (row) => (row === 6 ? null : 4) });
  const sc = scoreSubmission(s, new Map(), model);
  const cap = sc.capabilities.find((c) => c.n_target_blank === 1);
  close(cap.country_target, ((cap.n_skills - 1) * 4) / cap.n_skills);
  for (const c of sc.capabilities.filter((x) => x !== cap)) close(c.country_target, 4);
});

test('a workbook with no self-ratings at all is Not started', async () => {
  const s = await parse({ k: () => null, l: () => null });
  assert.equal(countryInputStatus(s).status, COUNTRY_STATUS.NOT_STARTED);
});

test('blank-cells note and Excel parity explanation', async () => {
  const { blanksNote } = await import('../src/portfolio.js');
  const none = await parse({});
  assert.equal(blanksNote(scoreSubmission(none, new Map(), model)), null);
  const some = await parse({ k: (row, sk) => (sk.owner === 'gdm' || row === 6 ? null : 2) });
  assert.match(blanksNote(scoreSubmission(some, new Map(), model)), /1 blank self-rating counted as 0/);
});
