// Builds synthetic DMMM 2026 workbooks in memory. No real country data is stored in the repo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { validateConfig, CONFIG_FILES } from '../../src/config.js';
import { mean } from '../../src/util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../..');

export function loadTestConfig() {
  const rd = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'config', f), 'utf8'));
  return validateConfig(Object.fromEntries(Object.entries(CONFIG_FILES).map(([k, f]) => [k, rd(f)])));
}

/**
 * opts.market, opts.bu, opts.date
 * opts.k(row, skill) / opts.l(row, skill) / opts.p(row, skill) return the cell values
 * Defaults: country rows K=2 L=3, GDM rows blank, P=1.
 */
export async function makeCountryWorkbook(cfg, opts = {}) {
  const model = cfg.model;
  const wb = new ExcelJS.Workbook();
  for (const name of model.required_sheets) wb.addWorksheet(name);
  const su = wb.getWorksheet('Sign-up');
  su.getCell('C5').value = 'Submitter Name'; su.getCell('D5').value = opts.submitter ?? 'Test Submitter';
  su.getCell('C7').value = 'Market/Country'; su.getCell('D7').value = 'market' in opts ? opts.market : 'DE';
  su.getCell('C9').value = 'Business Unit'; su.getCell('D9').value = 'bu' in opts ? opts.bu : 'Seeds';
  su.getCell('C11').value = 'Assessment Date '; su.getCell('D11').value = opts.date ?? 'October 2026';
  const q = wb.getWorksheet('DMMM Questionnaire');
  q.getCell('B4').value = 'Capability'; q.getCell('C4').value = 'Skill';
  q.getCell('K4').value = 'Self-rating'; q.getCell('L4').value = 'Target Rating +1 years'; q.getCell('M4').value = 'Comments';
  q.getCell('P4').value = 'Weighting';
  const k = opts.k ?? ((row, s) => (s.owner === 'gdm' ? null : 2));
  const l = opts.l ?? ((row, s) => (s.owner === 'gdm' ? null : 3));
  const p = opts.p ?? (() => 1);
  for (const s of model.skills) {
    q.getCell(`C${s.row}`).value = s.skill;
    const kv = k(s.row, s); const lv = l(s.row, s);
    if (kv !== null && kv !== undefined) q.getCell(`K${s.row}`).value = kv;
    if (lv !== null && lv !== undefined) q.getCell(`L${s.row}`).value = lv;
    q.getCell(`P${s.row}`).value = p(s.row, s);
  }
  for (const c of model.capabilities) q.getCell(`B${c.first_row}`).value = c.name;
  // Summary outcome: same formulas as the real template, with cached results
  const so = wb.getWorksheet('Summary outcome');
  const off = model.summary.row_offset_to_questionnaire;
  const capVals = [];
  for (const c of model.capabilities) {
    const vals = [];
    for (let r = c.first_row; r <= c.last_row; r++) {
      const raw = q.getCell(`K${r}`).value;
      const num = raw === null || raw === undefined ? 0 : Number(raw);
      so.getCell(`G${r + off}`).value = { formula: `'DMMM Questionnaire'!K${r}`, result: num };
      vals.push(num);
    }
    const avg = mean(vals);
    capVals.push(avg);
    so.getCell(`B${c.summary_row}`).value = c.name;
    so.getCell(`D${c.summary_row}`).value = { formula: `AVERAGE(G${c.first_row + off}:G${c.last_row + off})`, result: avg };
  }
  so.getCell('D8').value = { formula: 'AVERAGE(D9:D94)', result: mean(capVals) };
  const gq = wb.getWorksheet('General Questions');
  gq.getCell('C11').value = opts.growers ?? '~1.000';
  if (opts.mutate) opts.mutate(wb);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

/** Global Metrics file in the 2025 "All Global Metrics" layout (optionally with 2026 columns). */
export async function makeMetricsWorkbook(rows, opts = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  const headers = ['AMEA', null, null, 'DMS Score Yes = 4, No =0', 'Canva', 'Trinity ', 'Emplifi', 'SEMrush score', 'SEO', 'SFDC/ GC', 'Global Campaign Dashboard', '% Grower data', 'Cropwise active users  AMEA Only', 'GA4 Property audit', 'Marketing Cloud/Message Bird'];
  if (opts.with2026) headers.push('Web Performance & Accessibility', 'Core Web Vitals & Page Experience', 'Schema Validity Score', 'List Health & Deliverability', ...(opts.extraHeaders || []));
  ws.addRow(headers);
  for (const r of rows) ws.addRow(r);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

export const PRIVATE_DIR = process.env.DMMM_PRIVATE_DIR || path.join(ROOT, 'private-fixtures');
