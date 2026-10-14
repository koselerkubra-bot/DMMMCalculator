import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { loadTestConfig, makeCountryWorkbook, makeMetricsWorkbook } from './support/fixtures.js';
import { Portfolio } from '../src/portfolio.js';
import { trackerToBuffer } from '../src/trackerExport.js';
import { verifyTracker } from '../src/verify.js';
import { restoreState } from '../src/stateImport.js';
import { openWorkbook } from '../src/xlsxReader.js';
import { COUNTRY_STATUS, GDM_STATUS } from '../src/scoring.js';

const cfg = loadTestConfig();
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

// Region, BU, Market, DMS, Canva, Trinity, Emplifi, SEMrush, SEO, SFDC, Dashboard, %Grower, Cropwise, GA4, MC, [WebPerf, CWV, Schema, ListHealth]
const DE_S = ['EUR', 'Seeds', 'Germany Seed', 4, 2, 2, 2, 65, 2, 3, 1, 3, null, 3, 3];
const RO_S = ['EUR', 'Seeds', 'Romania Seed', 0, 3, 1, 2, 72, 2, 2, 1, 2, null, 1, 2];

async function portfolioWith(files) {
  const p = new Portfolio(cfg);
  for (const [name, opts] of files) await p.addCountryFile(await makeCountryWorkbook(cfg, opts), name);
  return p;
}

test('one Germany Seeds file -> one record, Complete + Pending Global Data, scores present', async () => {
  const p = await portfolioWith([['de.xlsm', { market: 'DE', bu: 'Seeds' }]]);
  const rows = p.compute();
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.identity.region, 'EUR');
  assert.equal(r.identity.profile, 'Europe');
  assert.equal(r.country_status, COUNTRY_STATUS.COMPLETE);
  assert.equal(r.gdm_status, GDM_STATUS.PENDING);
  assert.equal(r.gdm.pending, 10);
  close(r.self_current, 2);
  close(r.country_target, 3);
  assert.equal(r.validated_current, null);
});

test('identical file twice is detected and not added again', async () => {
  const bytes = await makeCountryWorkbook(cfg, {});
  const p = new Portfolio(cfg);
  await p.addCountryFile(bytes, 'a.xlsm');
  const e = await p.addCountryFile(bytes, 'copy of a.xlsm');
  assert.match(e.outcome, /Identical/);
  assert.equal(p.submissions.length, 1);
});

test('different file for the same country + BU + 2026 asks which one is the latest', async () => {
  const p = await portfolioWith([['v1.xlsm', {}], ['v2.xlsm', { k: (row, s) => (s.owner === 'gdm' ? null : 3) }]]);
  let rows = p.compute();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].country_status, COUNTRY_STATUS.DUPLICATE);
  assert.equal(rows[0].self_current, null);
  const v2 = p.submissions.find((s) => s.source_file_name === 'v2.xlsm');
  p.chooseActive(v2.key, v2.submission_id);
  rows = p.compute();
  close(rows[0].self_current, 3);
  assert.equal(p.submissions.length, 2, 'older version is kept');
  assert.ok(p.changeLog.some((c) => c.type === 'Active version' && /76 rating\(s\) changed/.test(c.detail)));
});

test('2025-format Global Metrics: proposals for current only, targets untouched', async () => {
  const p = await portfolioWith([['de.xlsm', {}]]);
  await p.setGlobalMetrics(await makeMetricsWorkbook([DE_S]), 'metrics.xlsx');
  const r = p.compute()[0];
  const g = (row) => r.gdm.rows.get(row);
  assert.equal(g(13).final_value, 4, 'DMS Yes = 4 is verified by source');
  assert.equal(g(23).final_value, 2);
  assert.equal(g(69).final_value, 2);
  assert.equal(g(89).final_value, 3);
  assert.equal(g(60).status, GDM_STATUS.PENDING, 'new 2026 metric not in a 2025 file');
  assert.equal(r.gdm_status, GDM_STATUS.PENDING);
  assert.equal(r.gdm.pending, 4);
  close(r.country_target, 3);
  for (const s of r.sub.skills) if (s.owner === 'gdm') assert.equal(s.country_target, null);
});

test('full 2026 metrics: GDM values incl. Level 4 are accepted automatically -> Validated', async () => {
  const p = await portfolioWith([['de.xlsm', {}]]);
  const row = [...DE_S, 3, 4, 2, 3];
  await p.setGlobalMetrics(await makeMetricsWorkbook([row], { with2026: true }), 'gm2026.xlsx');
  const r = p.compute()[0];
  assert.equal(r.gdm.rows.get(70).final_value, 4);
  assert.equal(r.gdm.rows.get(70).status, 'Accepted from Global Metrics (Level 4)');
  assert.equal(r.gdm_status, GDM_STATUS.VALIDATED);
  // Validated: country rows all 2, GDM rows: 13=4 23=2 24=2 46=2 60=3 69=2 70=4 71=2 89=3 90=3
  const capVals = { DMS: (8 * 2 + 4) / 9, CM: (9 * 2 + 2 + 2) / 11, PDM: 2, SM: (9 * 2 + 2) / 10, IMP: 2, UX: (8 * 2 + 3) / 9, SEO: (8 * 2 + 2 + 4 + 2) / 11, DA: 2, MA: (8 * 2 + 3 + 3) / 10 };
  close(r.validated_current, Object.values(capVals).reduce((a, b) => a + b) / 9);
  close(r.self_current, 2);
  close(r.country_target, 3);
});

test('if the policy is switched back, a GDM 4 waits for explicit approval', async () => {
  const strict = structuredClone(cfg);
  strict.thresholds.policy.level4_requires_explicit_verification = true;
  const p = new Portfolio(strict);
  await p.addCountryFile(await makeCountryWorkbook(strict, {}), 'de.xlsm');
  await p.setGlobalMetrics(await makeMetricsWorkbook([[...DE_S, 3, 4, 2, 3]], { with2026: true }), 'gm2026.xlsx');
  let r = p.compute()[0];
  assert.equal(r.gdm.rows.get(70).status, 'Level 4 - awaiting Global verification');
  assert.equal(r.gdm_status, GDM_STATUS.REVIEW);
  p.setDecision(r.key, 70, { decision: 'Approve', reviewer: 'GDM Reviewer' });
  r = p.compute()[0];
  assert.equal(r.gdm_status, GDM_STATUS.VALIDATED);
});

test('L4 verified column in the metrics file counts as Global verification', async () => {
  const p = await portfolioWith([['de.xlsm', {}]]);
  const row = [...DE_S, 3, 4, 2, 3, 'Yes'];
  await p.setGlobalMetrics(await makeMetricsWorkbook([row], { with2026: true, extraHeaders: ['Core Web Vitals & Page Experience L4 Verified'] }), 'gm.xlsx');
  const r = p.compute()[0];
  assert.equal(r.gdm.rows.get(70).final_value, 4);
  assert.equal(r.gdm_status, GDM_STATUS.VALIDATED);
});

test('GDM level that contradicts the raw SEMrush score is a validation conflict', async () => {
  const p = await portfolioWith([['de.xlsm', {}]]);
  const bad = [...DE_S]; bad[7] = 92; bad[8] = 1; // 92 -> L4 candidate, file says 1
  await p.setGlobalMetrics(await makeMetricsWorkbook([bad]), 'gm.xlsx');
  const r = p.compute()[0];
  assert.equal(r.gdm.rows.get(69).final_state, 'conflict');
  assert.equal(r.gdm_status, GDM_STATUS.CONFLICT);
});

test('override keeps the country self-rating auditable and never touches targets', async () => {
  const p = await portfolioWith([['de.xlsm', { k: (row, s) => (row === 23 ? 4 : s.owner === 'gdm' ? null : 2), l: (row, s) => (row === 23 ? 4 : s.owner === 'gdm' ? null : 3) }]]);
  await p.setGlobalMetrics(await makeMetricsWorkbook([DE_S]), 'gm.xlsx');
  const key = p.compute()[0].key;
  p.setDecision(key, 23, { decision: 'Override', override_score: 1, reviewer: 'R' });
  const r = p.compute()[0];
  const g = r.gdm.rows.get(23);
  assert.equal(g.final_value, 1);
  assert.match(g.note, /self-rating 4 kept for audit/);
  assert.equal(r.sub.skills.find((s) => s.row === 23).self_current, 4);
  assert.equal(r.sub.skills.find((s) => s.row === 23).country_target, 4);
});

test('tracker: required tabs, consistent figures, decisions round-trip through Excel', async () => {
  const p = await portfolioWith([['de.xlsm', {}], ['ro.xlsm', { market: 'Romania', k: (row, s) => (s.owner === 'gdm' ? null : 1) }], ['tr.xlsm', { market: 'TR-CP', bu: 'Crop Protection' }]]);
  await p.setGlobalMetrics(await makeMetricsWorkbook([DE_S, RO_S, ['AMEA', 'CP', 'Turkey*', 4, 4, 1, 2, 84, 3, 2, 1, 2, 0, 3, 1]]), 'gm.xlsx');
  const rows = p.compute();
  const buf = await trackerToBuffer(ExcelJS, p, rows);
  const wb = openWorkbook(buf);
  for (const name of ['Results', 'EUROPE ALL', 'EUROPE SEED', 'AMEA REGION', 'Global Metrics 2026', 'Validation Queue', 'Intake Log', 'Change Log', 'DE - S', 'RO - S', 'TR - CP']) assert.ok(wb.hasSheet(name), name);
  assert.ok(!wb.hasSheet('EUROPE CP'), 'no empty regional views');
  const v = verifyTracker(buf, rows);
  assert.ok(v.ok, JSON.stringify(v.checks.filter((c) => !c.ok)));

  // Reviewer approves Germany CWV in Excel, re-uploads the tracker
  const xl = new ExcelJS.Workbook();
  await xl.xlsx.load(buf);
  const vq = xl.getWorksheet('Validation Queue');
  const hdr = vq.getRow(4).values;
  const col = (h) => hdr.indexOf(h);
  vq.eachRow((row, n) => {
    if (n > 4 && row.getCell(col('Key')).value === 'DE|Seeds|2026' && row.getCell(col('Questionnaire Row')).value === 60) {
      row.getCell(col('GDM Decision')).value = 'Override';
      row.getCell(col('Override Score')).value = 2;
      row.getCell(col('Reviewer')).value = 'Excel Reviewer';
    }
  });
  const edited = new Uint8Array(await xl.xlsx.writeBuffer());
  const p2 = new Portfolio(cfg);
  const st = await restoreState(p2, edited, 'tracker.xlsx');
  assert.equal(st.restored, 3);
  const r2 = p2.compute().find((x) => x.key === 'DE|Seeds|2026');
  assert.equal(r2.gdm.rows.get(60).final_value, 2);
  assert.equal(r2.gdm.rows.get(60).decision.reviewer, 'Excel Reviewer');
  assert.ok(p2.changeLog.some((c) => c.type === 'GDM decision' && /Override 2 by Excel Reviewer/.test(c.detail)));
  // Unchanged figures survive the round trip
  const sig = (rs) => JSON.stringify(rs.map((r) => [r.key, r.self_current, r.country_target, r.country_status]));
  assert.equal(sig(p2.compute()), sig(rows));
});

test('cumulative workflow: Europe batch first, AMEA later, history preserved', async () => {
  const p = await portfolioWith([['de.xlsm', {}]]);
  const buf1 = await trackerToBuffer(ExcelJS, p, p.compute());
  const p2 = new Portfolio(cfg);
  await restoreState(p2, buf1, 'europe-batch.xlsx');
  await p2.addCountryFile(await makeCountryWorkbook(cfg, { market: 'Iran', bu: 'Crop Protection', p: (row) => (row === 31 || row === 32 ? 0 : 1) }), 'iran.xlsm');
  const rows = p2.compute();
  assert.deepEqual(rows.map((r) => r.key), ['DE|Seeds|2026', 'IR|CP|2026']);
  const ir = rows.find((r) => r.key === 'IR|CP|2026');
  assert.equal(ir.identity.profile, 'AMEA');
  assert.equal(ir.scores.excluded_p0, 2);
});

test('unknown market is reported with a fix, not guessed', async () => {
  const p = await portfolioWith([['x.xlsm', { market: 'Atlantis' }]]);
  assert.equal(p.compute().length, 0);
  assert.match(p.intakeLog[0].sub.issues[0].message, /Country Alias Master/);
});

test('wrong-template files never reach Results and never block the valid 2026 file', async () => {
  const old2025 = { market: 'Argentina', bu: 'Crop Protection', mutate: (wb) => { const q = wb.getWorksheet('DMMM Questionnaire'); q.getCell('K4').value = 'Weighting'; q.getCell('L4').value = 'Weighted Rating'; } };
  const p = await portfolioWith([['DMMM_2025_ARGENTINA CP.xlsm', old2025], ['DMMM_2026_ARGENTINA CP.xlsm', { market: 'Argentina', bu: 'Crop Protection' }]]);
  const rows = p.compute();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sub.source_file_name, 'DMMM_2026_ARGENTINA CP.xlsm');
  assert.equal(rows[0].country_status, COUNTRY_STATUS.COMPLETE);
  assert.equal(p.needsChoice.size, 0, 'a rejected file is not a competing version');
  assert.equal(p.submissions.length, 2, 'the rejected file stays in the Intake Log');
  assert.ok(p.changeLog.some((c) => c.type === 'Rejected file' && /DMMM 2025 workbook/.test(c.detail)));
  const buf = await trackerToBuffer(ExcelJS, p, rows);
  assert.ok(verifyTracker(buf, rows).ok);
  const p2 = new Portfolio(cfg);
  await restoreState(p2, buf, 't.xlsx');
  assert.equal(p2.compute().length, 1, 'still excluded after a save / reload');
});
