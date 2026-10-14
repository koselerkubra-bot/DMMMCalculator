// Regression against real country workbooks. These files are confidential and are NEVER
// committed: put them in ./private-fixtures (git-ignored) or point DMMM_PRIVATE_DIR at them.
// Without the files the tests are skipped, so CI runs only on synthetic data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadTestConfig, PRIVATE_DIR } from './support/fixtures.js';
import { Portfolio } from '../src/portfolio.js';
import { COUNTRY_STATUS, GDM_STATUS } from '../src/scoring.js';

const cfg = loadTestConfig();
const file = (n) => path.join(PRIVATE_DIR, n);
const has = (n) => fs.existsSync(file(n));
const close = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test('Germany Seeds 2026 (real workbook)', { skip: !has('DMMM_2026_GERMANY_SEEDS.xlsm') && 'private fixture not present' }, async () => {
  const p = new Portfolio(cfg);
  await p.addCountryFile(new Uint8Array(fs.readFileSync(file('DMMM_2026_GERMANY_SEEDS.xlsm'))), 'DMMM_2026_GERMANY_SEEDS.xlsm');
  const [r] = p.compute();
  assert.equal(r.identity.region, 'EUR');
  assert.equal(r.identity.country_name, 'Germany');
  assert.equal(r.business_unit, 'Seeds');
  assert.equal(r.identity.profile, 'Europe');
  assert.equal(r.sub.parse_check.match, true, 'parsed cells reproduce the workbook Summary');
  assert.equal(r.country_status, COUNTRY_STATUS.COMPLETE);
  assert.equal(r.gdm_status, GDM_STATUS.PENDING);
  assert.equal(r.gdm.pending, 10);
  close(r.self_current, 2.317);
  close(r.country_target, 2.655);
  assert.equal(r.validated_current, null);
});

test('Romania Seeds 2026 (real workbook)', { skip: !has('DMMM_2026_ROMANIA_SEEDS.xlsm') && 'private fixture not present' }, async () => {
  const p = new Portfolio(cfg);
  await p.addCountryFile(new Uint8Array(fs.readFileSync(file('DMMM_2026_ROMANIA_SEEDS.xlsm'))), 'DMMM_2026_ROMANIA_SEEDS.xlsm');
  const [r] = p.compute();
  assert.equal(r.key, 'RO|Seeds|2026');
  assert.equal(r.sub.parse_check.match, true);
  close(r.self_current, 2.128);
  close(r.country_target, 2.585);
});

test('Empty AMEA templates are recognised as valid 2026 templates', { skip: !has('DMMM_2026_AMEA.xlsm') && 'private fixture not present' }, async () => {
  for (const n of ['DMMM_2026_AMEA.xlsm', 'DMMM_2026_AMEA_Iran.xlsm', 'DMMM_2026_AMEA_Russia.xlsm', 'DMMM_2026_AMEA_South_Korea.xlsm'].filter(has)) {
    const p = new Portfolio(cfg);
    const e = await p.addCountryFile(new Uint8Array(fs.readFileSync(file(n))), n);
    assert.equal(e.sub.template_ok, true, n);
    assert.equal(e.sub.skills.length, 86, n);
  }
});
