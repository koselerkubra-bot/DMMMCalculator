// Browser front end. All scoring is done by the shared engine in /src - the same code the
// automated tests run. Files are read locally; nothing leaves the browser.
import { loadConfigBrowser } from '../src/config.js';
import { Portfolio } from '../src/portfolio.js';
import { openWorkbook } from '../src/xlsxReader.js';
import { detectMetricsLayout } from '../src/validation.js';
import { restoreState } from '../src/stateImport.js';
import { trackerToBuffer } from '../src/trackerExport.js';
import { buildCountryWorkbook, countryFileName } from '../src/countryExport.js';
import { verifyTracker } from '../src/verify.js';
import { GDM_STATUS, COUNTRY_STATUS } from '../src/scoring.js';

const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (v) => (v === null || v === undefined ? '–' : v.toFixed(2));

let cfg, portfolio, rows = [];
const sources = { state: null, history: null, metrics: null };

async function init() {
  try {
    cfg = await loadConfigBrowser('config/');
  } catch (e) {
    showAlerts([{ bad: true, title: 'Configuration could not be loaded', body: `<p>${esc(e.message)}. Open this page from its web address (GitHub Pages) or a local web server rather than as a file.</p>` }]);
    return;
  }
  portfolio = new Portfolio(cfg);
  $('#versions').textContent = `Model ${cfg.versions.model} · thresholds ${cfg.versions.thresholds} · metrics mapping ${cfg.versions.metrics} · country master ${cfg.versions.aliases}`;
  wire();
}

function wire() {
  const logo = $('#brand-logo');
  logo.addEventListener('load', () => { logo.hidden = false; $('#brand-divider').hidden = false; });
  logo.addEventListener('error', () => logo.remove());
  if (logo.complete && logo.naturalWidth) { logo.hidden = false; $('#brand-divider').hidden = false; }
  const dz = $('#dropzone');
  $('#file-input').addEventListener('change', (e) => { handleFiles([...e.target.files]); e.target.value = ''; });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); handleFiles([...e.dataTransfer.files]); });
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
  ['#f-region', '#f-bu', '#f-search'].forEach((s) => $(s).addEventListener('input', renderResults));
  $('#download-tracker').addEventListener('click', downloadTracker);
  $('#clear').addEventListener('click', () => { if (confirm('Remove all loaded files from this session?')) location.reload(); });
  $('#detail-close').addEventListener('click', () => $('#detail').close());
  $('#results-table').addEventListener('click', onResultsClick);
}

function selectTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
}

function classify(bytes) {
  const wb = openWorkbook(bytes);
  if (wb.hasSheet('_Engine')) return 'state';
  if (wb.hasSheet(cfg.model.sheets.questionnaire)) return 'country';
  if (wb.hasSheet('Results') && (wb.hasSheet('EUROPE ALL') || wb.hasSheet('AMEA REGION') || wb.hasSheet('Lighthouses'))) return 'history';
  for (const n of wb.sheetNames) { const sh = wb.sheet(n); if (sh && detectMetricsLayout(sh, cfg.metrics)) return 'metrics'; }
  return 'unknown';
}

async function handleFiles(files) {
  files = files.filter((f) => /\.xls[xm]$/i.test(f.name) && !f.name.startsWith('~$'));
  if (!files.length) return;
  $('#busy').hidden = false;
  const alerts = [];
  const rejected = [];
  const loaded = [];
  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      loaded.push({ f, bytes, kind: classify(bytes) });
    } catch (e) {
      alerts.push({ bad: true, title: `${f.name} could not be read`, body: `<p>${esc(e.message)}</p>` });
    }
  }
  const order = { state: 0, history: 1, metrics: 2, country: 3, unknown: 4 };
  loaded.sort((a, b) => order[a.kind] - order[b.kind]);
  for (const { f, bytes, kind } of loaded) {
    try {
      if (kind === 'state') { const r = await restoreState(portfolio, bytes, f.name); sources.state = `${f.name} (${r.restored} versions, ${r.decisions} decisions)`; }
      else if (kind === 'history') { const h = await portfolio.setHistory(bytes, f.name); sources.history = `${f.name} (${h.records.size} markets)`; }
      else if (kind === 'metrics') {
        const m = await portfolio.setGlobalMetrics(bytes, f.name);
        sources.metrics = `${f.name} (${m.rows.length} markets)`;
        const notes = [...m.issues.map((i) => i.message), ...m.unmatched.map((u) => `Row ${u.sheet_row} "${u.market_raw}": ${u.issue}`)];
        if (notes.length) alerts.push({ title: `Global Metrics: ${f.name}`, body: `<ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` });
      } else if (kind === 'country') {
        const e = await portfolio.addCountryFile(bytes, f.name, { uploadedAt: new Date().toISOString() });
        if (!e.sub.key || !e.sub.template_ok) {
          rejected.push(`<li><b>${esc(f.name)}</b>: ${e.sub.issues.filter((i) => i.level === 'error').map((i) => esc(i.message)).join('; ')}</li>`);
        } else if (e.duplicate_of) {
          alerts.push({ title: `${f.name}: already loaded`, body: `<p>${esc(e.outcome)}</p>` });
        }
      } else {
        alerts.push({ bad: true, title: `${f.name}: not recognised`, body: '<p>This is not a DMMM 2026 country workbook, a Global Metrics file, a saved 2026 tracker or the 2025 Global Tracker.</p>' });
      }
    } catch (e) {
      console.error(e);
      alerts.push({ bad: true, title: `${f.name} could not be processed`, body: `<p>${esc(e.message)}</p>` });
    }
  }
  if (rejected.length) alerts.unshift({ bad: true, title: `${rejected.length} file${rejected.length === 1 ? ' was' : 's were'} not added to the results`, body: `<ul>${rejected.join('')}</ul><p>They are listed in the Intake log. Once corrected, load them again.</p>` });
  $('#busy').hidden = true;
  refresh(alerts);
}

function refresh(extraAlerts = []) {
  rows = portfolio.compute();
  renderSources();
  renderChoices(extraAlerts);
  renderStats();
  renderFilters();
  renderResults();
  renderQueue();
  renderIntake();
  renderChanges();
  const any = portfolio.submissions.length > 0;
  $('#overview').hidden = !any && !portfolio.metrics;
  $('#workspace').hidden = !any;
  $('#empty').hidden = any;
  $('#verify').textContent = '';
  $('#verify').className = 'verify';
}

function renderSources() {
  const n = portfolio.submissions.length;
  const items = [
    ['Country workbooks', n ? `${n} file version${n === 1 ? '' : 's'}` : null],
    ['Global Metrics', sources.metrics || (portfolio.metrics ? portfolio.metrics.source_file_name : null)],
    ['Saved tracker', sources.state],
    ['History', sources.history || (portfolio.history ? portfolio.history.source_file_name : null)],
  ].filter(([, v]) => v);
  $('#sources').innerHTML = items.map(([k, v]) => `<span class="source"><b>${esc(k)}:</b> ${esc(v)}</span>`).join('');
}

function showAlerts(list) {
  $('#alerts').innerHTML = list.map((a, i) => `<div class="alert ${a.bad ? 'bad' : ''}" data-i="${i}"><h3>${esc(a.title)}</h3>${a.body}</div>`).join('');
}

function renderChoices(extra) {
  const list = [...extra];
  for (const key of portfolio.needsChoice) {
    const vs = portfolio.versionsOf(key);
    const name = vs[0].identity.country_name + ' ' + vs[0].business_unit;
    const opts = vs.map((s) => {
      const st = portfolio.cfg && s.skills.filter((x) => x.owner === 'country' && x.self_current !== null).length;
      return `<label><input type="radio" name="c-${esc(key)}" value="${esc(s.submission_id)}"> v${s.version}: <b>${esc(s.source_file_name)}</b> <span class="sub">loaded ${esc((s.uploaded_at || '').slice(0, 16).replace('T', ' '))}, submitter ${esc(s.submitter || '–')}, ${st} country ratings</span></label>`;
    }).join('');
    list.push({ bad: true, title: `Two different files for ${name} 2026`, body: `<p>Which one is the latest? The other is kept as an inactive version.</p><div class="choice" data-key="${esc(key)}">${opts}<button class="quiet" type="button" data-choose="${esc(key)}">Use selected version</button></div>` });
  }
  showAlerts(list);
  document.querySelectorAll('[data-choose]').forEach((b) => b.addEventListener('click', () => {
    const key = b.dataset.choose;
    const sel = document.querySelector(`input[name="c-${CSS.escape(key)}"]:checked`);
    if (!sel) return;
    portfolio.chooseActive(key, sel.value);
    refresh();
  }));
}

function renderStats() {
  const active = rows.filter((r) => !r.needs_choice);
  const stats = [
    [rows.length, 'markets'],
    [active.filter((r) => r.country_status === COUNTRY_STATUS.COMPLETE).length, 'country input complete'],
    [active.filter((r) => r.validated_current !== null).length, 'GDM validated'],
    [active.reduce((a, r) => a + r.gdm.pending, 0), 'Global rows open'],
  ];
  $('#stats').innerHTML = stats.map(([n, l]) => `<div class="stat"><span class="n">${n}</span><span class="l">${esc(l)}</span></div>`).join('');
}

function renderFilters() {
  const fill = (sel, values) => {
    const el = $(sel); const cur = el.value;
    el.innerHTML = '<option value="">All</option>' + values.map((v) => `<option${v === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
  };
  fill('#f-region', [...new Set(rows.map((r) => r.identity.region))]);
  fill('#f-bu', [...new Set(rows.map((r) => r.business_unit))]);
}

function pill(status) {
  const cls = { 'Complete': 'ok', 'Validated': 'val', 'Pending Global Data': 'warn', 'Ready for Global review': 'warn', 'Validation conflict': 'bad', 'Incomplete country-owned inputs': 'bad', 'Duplicate - choose active version': 'bad', 'Template error': 'bad', 'Identity error': 'bad' }[status] || '';
  return `<span class="pill ${cls}">${esc(status)}</span>`;
}

/**
 * Bullet chart on the 0-4 maturity scale.
 * Green bar = country self current, blue bar = GDM validated (shown once available),
 * gold vertical line = country target. The gap to target is written next to it.
 */
function gauge(self, target, validated, opts = {}) {
  const W = opts.width || 150, pad = 2, H = 30;
  const x = (v) => pad + (Math.max(0, Math.min(4, v)) / 4) * (W - 2 * pad);
  const two = validated !== null && validated !== undefined;
  const barH = two ? 7 : 10;
  const ySelf = two ? 3 : 5, yVal = 12;
  const p = [];
  for (const t of [0, 1, 2, 3, 4]) {
    p.push(`<line x1="${x(t)}" x2="${x(t)}" y1="1" y2="${two ? 21 : 17}" class="g-grid"/>`);
    p.push(`<text x="${x(t)}" y="${H - 1}" text-anchor="middle" class="g-tick">${t}</text>`);
  }
  p.push(`<rect x="${pad}" y="${ySelf}" width="${W - 2 * pad}" height="${two ? 16 : barH}" rx="2" class="g-track"/>`);
  if (self !== null && self !== undefined) p.push(`<rect x="${pad}" y="${ySelf}" width="${Math.max(1, x(self) - pad)}" height="${barH}" rx="2" class="g-self"/>`);
  if (two) p.push(`<rect x="${pad}" y="${yVal}" width="${Math.max(1, x(validated) - pad)}" height="${barH}" rx="2" class="g-val"/>`);
  if (target !== null && target !== undefined) p.push(`<rect x="${x(target) - 1.5}" y="0" width="3" height="${two ? 22 : 20}" rx="1.5" class="g-target"/>`);
  const label = `Self current ${fmt(self)}${two ? `, validated ${fmt(validated)}` : ''}, country target ${fmt(target)}`;
  const svg = `<svg class="gauge" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${p.join('')}</svg>`;
  const base = two ? validated : self;
  let gap = '';
  if (base !== null && base !== undefined && target !== null && target !== undefined) {
    const d = target - base;
    gap = Math.abs(d) < 0.005 ? '<span class="gap met">at target</span>'
      : d > 0 ? `<span class="gap">+${d.toFixed(2)} to target</span>`
      : `<span class="gap met">${Math.abs(d).toFixed(2)} above target</span>`;
  }
  return `<div class="gauge-wrap">${svg}${opts.noGap ? '' : gap}</div>`;
}

/** YoY cell: validated change when available (official), otherwise provisional change on self-assessment. */
function yoy(prev, dValidated, dSelf, opts = {}) {
  if (prev === null || prev === undefined) return opts.newLabel === false ? '<span class="sub">–</span>' : '<span class="sub">New in 2026</span>';
  const official = dValidated !== null && dValidated !== undefined;
  const d = official ? dValidated : dSelf;
  if (d === null || d === undefined) return `<span class="sub">2025: ${prev.toFixed(1)}</span>`;
  const dir = d > 0.005 ? 'up' : d < -0.005 ? 'down' : 'flat';
  const arrow = { up: '▲', down: '▼', flat: '■' }[dir];
  const tag = official ? '<span class="yoy-tag val">validated</span>' : '<span class="yoy-tag">provisional</span>';
  return `<span class="yoy ${dir}" title="2025 ${prev.toFixed(2)} → 2026 ${official ? 'validated' : 'self'} ${(prev + d).toFixed(2)}">${arrow} ${d > 0 ? '+' : ''}${d.toFixed(2)}</span>${opts.compact ? '' : `<br><span class="sub">from ${prev.toFixed(1)}</span> ${tag}`}`;
}

function filtered() {
  const reg = $('#f-region').value, bu = $('#f-bu').value, q = $('#f-search').value.trim().toLowerCase();
  return rows.filter((r) => (!reg || r.identity.region === reg) && (!bu || r.business_unit === bu) && (!q || r.identity.country_name.toLowerCase().includes(q) || r.identity.country_id.toLowerCase() === q));
}

function renderResults() {
  const rs = filtered();
  $('#results-table').innerHTML = `<thead><tr>
    <th>Market</th><th>Region</th><th>Current vs target (0 – 4)</th>
    <th class="num group-own">Self current</th><th class="num group-gdm">Validated</th><th class="num group-own">Target +1Y</th>
    <th>YoY vs 2025</th><th>Country input</th><th>GDM validation</th><th></th></tr></thead>
    <tbody>${rs.map((r) => `<tr>
      <td><span class="market">${esc(r.identity.country_name)}${r.lighthouse ? '*' : ''}</span> <span class="sub">${esc(r.business_unit)}</span><br><span class="sub">${esc(r.sub.source_file_name)} · v${r.sub.version}</span></td>
      <td>${esc(r.identity.region)}${r.identity.subregion ? ` <span class="sub">${esc(r.identity.subregion)}</span>` : ''}<br><span class="sub">${esc(r.identity.profile)} profile</span></td>
      <td>${gauge(r.self_current, r.country_target, r.validated_current)}</td>
      <td class="num">${fmt(r.self_current)}</td><td class="num">${fmt(r.validated_current)}</td><td class="num">${fmt(r.country_target)}</td>
      <td>${r.needs_choice ? '–' : !portfolio.history ? '<span class="sub">Load 2025 tracker</span>' : yoy(r.history.overall['2025 Current Maturity'], r.bench.yoy, r.bench.yoy_self)}</td>
      <td>${pill(r.country_status)}${r.missing_self.length || r.missing_target.length ? `<br><span class="sub">${r.missing_self.length} self, ${r.missing_target.length} target missing</span>` : ''}</td>
      <td>${r.needs_choice ? '–' : `${pill(r.gdm_status)}${r.gdm.pending ? `<br><span class="sub">${r.gdm.pending} Global row${r.gdm.pending === 1 ? '' : 's'} open</span>` : ''}`}</td>
      <td class="actions-cell"><button class="link" type="button" data-detail="${esc(r.key)}">Details</button><br><button class="link" type="button" data-country="${esc(r.key)}">Country file</button></td>
    </tr>`).join('')}</tbody>`;
}

async function onResultsClick(e) {
  const d = e.target.closest('[data-detail]');
  if (d) return openDetail(rows.find((r) => r.key === d.dataset.detail));
  const c = e.target.closest('[data-country]');
  if (c) {
    const r = rows.find((x) => x.key === c.dataset.country);
    if (r.needs_choice) return alert('Choose the active version first.');
    const buf = await buildCountryWorkbook(window.ExcelJS, portfolio, r);
    save(buf, countryFileName(r, cfg.model.assessment_year));
  }
}

function openDetail(r) {
  $('#detail-title').textContent = `${r.identity.country_name} ${r.business_unit}`;
  $('#detail-sub').textContent = `${r.identity.region} · ${r.identity.profile} profile · ${r.sub.source_file_name} (v${r.sub.version}) · submitter ${r.sub.submitter || '–'}`;
  const caps = r.scores.capabilities.map((c) => `<tr><td>${esc(c.name)}</td><td>${gauge(c.self_current, c.country_target, r.validated_current === null ? null : c.validated_current)}</td><td class="num">${fmt(c.self_current)}</td><td class="num">${fmt(r.validated_current === null ? null : c.validated_current)}</td><td class="num">${fmt(c.country_target)}</td><td class="num">${fmt(r.yoy_cap[c.id].prev)}</td><td>${portfolio.history ? yoy(r.yoy_cap[c.id].prev, r.yoy_cap[c.id].d_validated, r.yoy_cap[c.id].d_self, { compact: true, newLabel: false }) : ''}</td><td class="num">${c.n_excluded_p0 || ''}</td></tr>`).join('');
  const skills = r.sub.skills.map((s) => {
    const g = r.gdm.rows.get(s.row);
    return `<tr class="${s.owner === 'gdm' ? 'row-gdm' : ''} ${s.inclusion === 0 ? 'row-p0' : ''}"><td class="num">${s.row}</td><td>${esc(s.skill)}</td><td>${s.owner === 'gdm' ? 'GDM' : 'Country'}</td><td class="num">${s.inclusion ?? ''}</td><td class="num">${s.self_current ?? '–'}</td><td class="num">${s.country_target ?? '–'}</td><td class="num">${g?.proposal.proposed_level ?? ''}</td><td class="num">${g?.final_value ?? ''}</td><td>${g ? esc(g.status) : ''}</td><td class="wrap sub">${esc([...(g?.proposal.notes || []), g?.note, ...s.issues].filter(Boolean).join(' · '))}</td></tr>`;
  }).join('');
  const missing = [...r.missing_self.map((s) => `Row ${s.row} ${s.skill}: no self-rating`), ...r.missing_target.map((s) => `Row ${s.row} ${s.skill}: no target`)];
  $('#detail-body').innerHTML = `
    <div><span>${pill(r.country_status)}</span> <span>${r.needs_choice ? '' : pill(r.gdm_status)}</span></div>
    ${missing.length ? `<div class="alert bad"><h3>Country inputs to complete</h3><ul>${missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
    <div><h3>Capabilities</h3><div class="table-wrap"><table><thead><tr><th>Capability</th><th>Current vs target (0 – 4)</th><th class="num group-own">Self</th><th class="num group-gdm">Validated</th><th class="num group-own">Target</th><th class="num">2025</th><th>YoY</th><th class="num">P=0</th></tr></thead><tbody>
    <tr><td><b>Overall</b></td><td>${gauge(r.self_current, r.country_target, r.validated_current)}</td><td class="num"><b>${fmt(r.self_current)}</b></td><td class="num"><b>${fmt(r.validated_current)}</b></td><td class="num"><b>${fmt(r.country_target)}</b></td><td class="num">${fmt(r.history.overall['2025 Current Maturity'])}</td><td>${portfolio.history ? yoy(r.history.overall['2025 Current Maturity'], r.bench.yoy, r.bench.yoy_self, { compact: true }) : ''}</td><td></td></tr>${caps}</tbody></table></div></div>
    <div><h3>Skills</h3><div class="table-wrap"><table><thead><tr><th class="num">Row</th><th>Skill</th><th>Owner</th><th class="num">P</th><th class="num group-own">Self (K)</th><th class="num group-own">Target (L)</th><th class="num group-gdm">GDM proposal</th><th class="num group-gdm">GDM final</th><th>GDM status</th><th>Notes</th></tr></thead><tbody>${skills}</tbody></table></div></div>`;
  $('#detail').showModal();
}

function renderQueue() {
  const items = [];
  for (const r of rows) if (!r.needs_choice) for (const g of r.gdm.rows.values()) items.push({ r, g });
  const open = items.filter((x) => x.g.final_state !== 'resolved' && x.g.final_state !== 'excluded');
  $('#queue-table').innerHTML = `<thead><tr><th>Market</th><th class="num">Row</th><th>Skill</th><th>Source metric</th><th class="num">Raw</th><th class="num">GDM level</th><th class="num">Proposed</th><th>Status</th><th class="num">Final</th><th>Decision</th></tr></thead><tbody>${
    [...open, ...items.filter((x) => !open.includes(x))].map(({ r, g }) => `<tr><td>${esc(r.identity.country_name)} <span class="sub">${esc(r.business_unit)}</span></td><td class="num">${g.row}</td><td>${esc(g.skill)}</td><td>${esc(g.proposal.source_metric)}</td><td class="num">${esc(g.proposal.raw_value ?? '')}</td><td class="num">${esc(g.proposal.level_raw ?? '')}</td><td class="num">${g.proposal.proposed_level ?? ''}</td><td>${pill(g.status)}</td><td class="num">${g.final_value ?? ''}</td><td class="sub">${g.decision ? esc(`${g.decision.decision} by ${g.decision.reviewer || '?'}`) : ''}</td></tr>`).join('')}</tbody>`;
}

function renderIntake() {
  $('#intake-table').innerHTML = `<thead><tr><th>Loaded</th><th>File</th><th>Market (D7)</th><th>BU (D9)</th><th>Parsed as</th><th class="num">Skills</th><th>Reading check</th><th>Version</th><th>Issues</th></tr></thead><tbody>${
    portfolio.submissions.map((s) => `<tr><td class="sub">${esc((s.uploaded_at || '').slice(0, 16).replace('T', ' '))}</td><td>${esc(s.source_file_name)}</td><td>${esc(s.market_raw)}</td><td>${esc(s.bu_raw)}</td><td>${s.identity ? `${esc(s.identity.country_name)} ${esc(s.business_unit || '')} · ${esc(s.identity.region)} · ${esc(s.identity.profile)}` : '–'}</td><td class="num">${s.skills.length}</td><td>${s.parse_check?.match === true ? pill('Complete').replace('Complete', 'OK') : s.parse_check?.match === false ? '<span class="pill warn">Differs</span>' : '–'}</td><td>v${s.version ?? 1}${s.active_flag ? ' (active)' : ''}</td><td class="wrap sub">${esc(s.issues.map((i) => i.message).join(' · '))}</td></tr>`).join('')}</tbody>`;
}

function renderChanges() {
  $('#changes-table').innerHTML = `<thead><tr><th>At (UTC)</th><th>Type</th><th>Key</th><th>Detail</th></tr></thead><tbody>${
    [...portfolio.changeLog].reverse().map((c) => `<tr><td class="sub">${esc(c.at.slice(0, 19).replace('T', ' '))}</td><td>${esc(c.type)}</td><td>${esc(c.key)}</td><td class="wrap">${esc(c.detail)}</td></tr>`).join('')}</tbody>`;
}

async function downloadTracker() {
  const btn = $('#download-tracker');
  btn.disabled = true; btn.textContent = 'Building tracker...';
  try {
    const buf = await trackerToBuffer(window.ExcelJS, portfolio, rows);
    const v = verifyTracker(buf, rows);
    const el = $('#verify');
    el.className = 'verify ' + (v.ok ? 'ok' : 'fail');
    el.textContent = v.ok
      ? `Consistency check passed: every regional tab and country tab matches Results (${v.checks.length} checks).`
      : `Consistency check failed: ${v.checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.detail})`).join('; ')}`;
    save(buf, `DMMM_${cfg.model.assessment_year}_Global_Results_Tracker_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) {
    console.error(e);
    $('#verify').className = 'verify fail';
    $('#verify').textContent = `The tracker could not be built: ${e.message}`;
  } finally {
    btn.disabled = false; btn.textContent = 'Download tracker';
  }
}

function save(bytes, name) {
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

init();
