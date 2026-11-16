import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseAmount, parsePct, parseSmallCount, isUnanswered, platformOf, toolName, frequencyOf, standardizeGeneral } from '../src/generalQuestions.js';
import { generalQuestionsToBuffer } from '../src/gqExport.js';
import { loadTestConfig, makeCountryWorkbook } from './support/fixtures.js';
import { Portfolio } from '../src/portfolio.js';

test('amounts written as text are converted, with a note', () => {
  assert.equal(parseAmount('1.150.000', 'money').value, 1150000);
  assert.equal(parseAmount('USD 160.000', 'money').value, 160000);
  assert.equal(parseAmount('~250.000').value, 250000);
  assert.equal(parseAmount('In Total 450 000').value, 450000);
  assert.equal(parseAmount('Around 1 million').value, 1000000);
  assert.equal(parseAmount('Around 400K').value, 400000);
  const r = parseAmount('1.2-1.4 mln');
  assert.equal(r.value, 1300000); assert.match(r.note, /midpoint/);
  assert.equal(parseAmount('<3000').value, 3000);
  assert.equal(parseAmount('LT-132076; LV -49994; EE-10519').value, 192589);
  assert.equal(parseAmount('118746  Accounts / 136501 Contacts', 'count', 'contact').value, 136501);
  assert.equal(parseAmount(33.307).value, 33307);
  assert.match(parseAmount(2.35, 'money').note, /unit/);
  assert.equal(parseAmount('Hard to say for both SE and CP, for SE would be >11000 (total number of registered farmers in RO ~ 800k farmers)').value, null);
});

test('shares, small counts and unanswered prompts', () => {
  assert.equal(parsePct(0.35).value, 0.35);
  assert.equal(parsePct(5).value, 0.05);
  assert.equal(parsePct('5%%').value, 0.05);
  assert.equal(parsePct('35%+').value, 0.35);
  assert.equal(parsePct('90-100%').value, 0.95);
  assert.deepEqual(parseSmallCount('5+'), { value: 5, note: '"5+": 5 or more' });
  for (const p of ['(please select from the drop-down list)', '(Please select Yes / No)', '?', '??', 'TBD', '\u00a0', null]) assert.ok(isUnanswered(p), String(p));
  assert.ok(!isUnanswered('Yes'));
});

test('names, platforms and frequencies use one spelling', () => {
  assert.equal(platformOf('https://www.facebook.com/SyngentaFrance'), 'Facebook');
  assert.equal(platformOf('https://x.com/SyngentaFrance'), 'X (Twitter)');
  assert.equal(platformOf('Istagram Advertisement'), 'Instagram');
  assert.equal(platformOf('Tik Tok'), 'TikTok');
  assert.equal(toolName('GA4'), 'Google Analytics');
  assert.equal(toolName('Salesforce Marketing cloud'), 'Salesforce Marketing Cloud');
  assert.equal(frequencyOf('weeekly'), 'Weekly');
  assert.equal(frequencyOf('Monthy'), 'Monthly');
  assert.equal(frequencyOf('every 2 weeks'), 'Bi-weekly');
  assert.equal(frequencyOf('weekly / monthly'), 'Weekly; Monthly');
  assert.equal(frequencyOf('after each email'), 'Per campaign');
});

test('standardizeGeneral handles a sheet that could not be read', () => {
  assert.ok(standardizeGeneral(null).error);
  assert.ok(standardizeGeneral({ error: 'x' }).error);
});

test('General Questions export: one Summary row per country/BU, plus the list sheets', async () => {
  const cfg = loadTestConfig();
  const p = new Portfolio(cfg);
  await p.addCountryFile(await makeCountryWorkbook(cfg, { market: 'France', bu: 'CP' }), 'fr.xlsm');
  await p.addCountryFile(await makeCountryWorkbook(cfg, { market: 'Germany', bu: 'Seeds' }), 'de.xlsm');
  const rows = p.compute();
  const buf = await generalQuestionsToBuffer(ExcelJS, p, rows);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  for (const n of ['About', 'Summary', 'Grower Channels', 'Internal Team', 'MaSE', 'Delivery Split', 'Tools', 'DM Channels', 'KPIs', 'Adoption', 'Data Quality']) assert.ok(wb.getWorksheet(n), n);
  const sum = wb.getWorksheet('Summary');
  assert.equal(sum.getRow(2).getCell(2).value, 'Country ID');
  const ids = [3, 4].map((r) => sum.getRow(r).getCell(2).value).sort();
  assert.deepEqual(ids, ['DE', 'FR']);
});
