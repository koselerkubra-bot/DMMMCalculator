import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { loadTestConfig, makeCountryWorkbook, makeHistoryWorkbook } from './support/fixtures.js';
import { Portfolio, missingFrom2026 } from '../src/portfolio.js';
import { trackerToBuffer } from '../src/trackerExport.js';
import { verifyTracker } from '../src/verify.js';
import { restoreState } from '../src/stateImport.js';
import { openWorkbook } from '../src/xlsxReader.js';

const cfg = loadTestConfig();
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

async function setup() {
  const p = new Portfolio(cfg);
  await p.setHistory(await makeHistoryWorkbook([
    ['EUR', 'Seeds', 'Germany Seed', 1.5, 2.1, 1.0, 2.5],
    ['EUR', 'CP', 'France', 2.0, 2.4, 2.0, 2.0],
  ]), 'DMMM_Global_Tracker_2025.xlsx');
  await p.addCountryFile(await makeCountryWorkbook(cfg, {}), 'de.xlsm');                       // all country ratings 2
  await p.addCountryFile(await makeCountryWorkbook(cfg, { market: 'Romania' }), 'ro.xlsm');     // not in 2025
  return p;
}

test('provisional YoY uses the self-assessment; official YoY waits for validation', async () => {
  const p = await setup();
  const de = p.compute().find((r) => r.key === 'DE|Seeds|2026');
  assert.equal(de.yoy_status, 'Compared with 2025');
  close(de.bench.yoy_self, 0.5);
  assert.equal(de.bench.yoy, null);
  assert.equal(de.bench.target_2026_met_self, 'No'); // 2.0 < 2.1
  assert.equal(de.bench.target_2026_met, null);
});

test('capability YoY against 2025 capability scores', async () => {
  const p = await setup();
  const de = p.compute().find((r) => r.key === 'DE|Seeds|2026');
  close(de.yoy_cap.SEO.d_self, 1.0);
  close(de.yoy_cap.DMS.d_self, -0.5);
  assert.equal(de.yoy_cap.SEO.d_validated, null);
  assert.equal(de.yoy_cap.CM.prev, null, 'no 2025 value -> no YoY');
});

test('new markets and markets without a 2026 file are listed', async () => {
  const p = await setup();
  const rows = p.compute();
  assert.equal(rows.find((r) => r.key === 'RO|Seeds|2026').yoy_status, 'New in 2026 (no 2025 result)');
  assert.deepEqual(missingFrom2026(p, rows).map((m) => m.key), ['FR|CP']);
});

test('YoY Comparison sheet is written, consistent, and survives a save / reload', async () => {
  const p = await setup();
  const rows = p.compute();
  const buf = await trackerToBuffer(ExcelJS, p, rows);
  const wb = openWorkbook(buf);
  assert.ok(wb.hasSheet('YoY Comparison'));
  assert.ok(verifyTracker(buf, rows).ok);
  const p2 = new Portfolio(cfg);
  await restoreState(p2, buf, 'tracker.xlsx');
  const de2 = p2.compute().find((r) => r.key === 'DE|Seeds|2026');
  close(de2.bench.yoy_self, 0.5);
  close(de2.yoy_cap.SEO.d_self, 1.0);
});
