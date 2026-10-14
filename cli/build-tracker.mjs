#!/usr/bin/env node
// Command-line version of the browser tool, using the same engine.
//   node cli/build-tracker.mjs --out tracker.xlsx [--state previous_tracker.xlsx]
//        [--history DMMM_Global_Tracker_2025.xlsx] [--metrics global_metrics.xlsx]
//        [--choose DE|Seeds|2026=<submission_id>] country1.xlsm country2.xlsm folder/ ...
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { loadConfig } from '../src/config.js';
import { Portfolio } from '../src/portfolio.js';
import { restoreState } from '../src/stateImport.js';
import { trackerToBuffer } from '../src/trackerExport.js';
import { verifyTracker } from '../src/verify.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = { countries: [], choose: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--out') opt.out = args[++i];
  else if (a === '--state') opt.state = args[++i];
  else if (a === '--history') opt.history = args[++i];
  else if (a === '--metrics') opt.metrics = args[++i];
  else if (a === '--choose') opt.choose.push(args[++i]);
  else opt.countries.push(a);
}
if (!opt.out) { console.error('Usage: node cli/build-tracker.mjs --out tracker.xlsx [options] files...'); process.exit(2); }

const cfg = await loadConfig(async (f) => JSON.parse(fs.readFileSync(path.join(root, 'config', f), 'utf8')));
const p = new Portfolio(cfg);
const read = (f) => new Uint8Array(fs.readFileSync(f));
if (opt.state) console.log('State:', (await restoreState(p, read(opt.state), path.basename(opt.state))).restored, 'submission version(s) restored');
if (opt.history) { const h = await p.setHistory(read(opt.history), path.basename(opt.history)); console.log('History:', h.records.size, 'markets,', h.reconciliation.length, 'cross-tab differences'); }
if (opt.metrics) { const m = await p.setGlobalMetrics(read(opt.metrics), path.basename(opt.metrics)); console.log('Global Metrics:', m.rows.length, 'rows,', m.unmatched.length, 'unmatched'); m.issues.forEach((i) => console.log('  ', i.level, i.message)); }
const files = opt.countries.flatMap((f) => (fs.statSync(f).isDirectory() ? fs.readdirSync(f).filter((x) => /\.xls[xm]$/i.test(x) && !x.startsWith('~$')).map((x) => path.join(f, x)) : [f]));
for (const f of files) { const e = await p.addCountryFile(read(f), path.basename(f)); console.log(`${path.basename(f)}: ${e.outcome}`); }
for (const c of opt.choose) { const [key, id] = c.split('='); p.chooseActive(key, id, 'Selected on the command line'); }
if (p.needsChoice.size) console.log('Needs a version choice (use --choose KEY=submission_id):', [...p.needsChoice].map((k) => `${k}: ${p.versionsOf(k).map((s) => `${s.submission_id} ${s.source_file_name}`).join(' / ')}`).join('; '));
const rows = p.compute();
const buf = await trackerToBuffer(ExcelJS, p, rows);
fs.writeFileSync(opt.out, buf);
const v = verifyTracker(buf, rows);
for (const r of rows) console.log(`${r.key.padEnd(18)} self ${r.self_current?.toFixed(2) ?? '-'}  validated ${r.validated_current?.toFixed(2) ?? '-'}  target ${r.country_target?.toFixed(2) ?? '-'}  | ${r.country_status} | ${r.gdm_status}`);
console.log(`Consistency check: ${v.ok ? 'passed' : 'FAILED'}`);
v.checks.filter((c) => !c.ok).forEach((c) => console.log('  FAIL', c.name, c.detail));
console.log('Written', opt.out);
process.exit(v.ok ? 0 : 1);
