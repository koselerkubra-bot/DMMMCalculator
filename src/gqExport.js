// Writes the separate "DMMM General Questions" workbook: one summary row per country/BU plus a
// sheet per list-type section, all standardized by standardizeGeneral(). ExcelJS is injected so
// the same code runs in the browser and in Node.
import { standardizeGeneral } from './generalQuestions.js';
import { BU_SHORT } from './identity.js';
import { regionOrder } from './portfolio.js';

const FONT = 'Arial';
const C = { head: 'FF1F2A44', headText: 'FFFFFFFF', band: 'FFF4F6FA', ink: 'FF1F2328', flag: 'FFB45309', grid: 'FFD9DEE7', na: 'FF8A94A6' };
const PCT = '0%';
const INT = '#,##0';
const DEC = '0.00';

/** Status of the General Questions data for one row. */
function gqStatus(r) {
  if (r.needs_choice) return 'Duplicate: choose the active version first';
  if (!r.sub) return 'No workbook';
  if (r.sub.general_detail === undefined) return 'Not available: load the country workbook again (restored from a saved tracker)';
  if (!r.sub.general_detail || r.sub.general_detail.error) return `Not read: ${r.sub.general_detail?.error || 'General Questions sheet missing'}`;
  return 'Read';
}

function idCols() {
  return [
    { h: 'Region', w: 8, v: (x) => x.r.identity.region },
    { h: 'Country ID', w: 9, v: (x) => x.r.identity.country_id },
    { h: 'Country', w: 16, v: (x) => x.r.identity.country_name },
    { h: 'BU', w: 7, v: (x) => BU_SHORT[x.r.business_unit] || x.r.business_unit },
  ];
}

const SUMMARY_COLS = [
  { group: 'Source', cols: [
    { h: 'Source file', w: 30, v: (x) => x.r.sub?.source_file_name },
    { h: 'Submitter', w: 22, v: (x) => x.r.sub?.submitter },
    { h: 'General Questions status', w: 18, v: (x) => x.status },
  ] },
  { group: 'Growers & CRM', cols: [
    { h: 'Total growers', w: 12, f: INT, k: 'growers_total' },
    { h: 'Target growers', w: 12, f: INT, k: 'growers_target' },
    { h: 'Target share of growers', w: 10, f: PCT, k: 'growers_target_share' },
    { h: 'CRM contacts', w: 12, f: INT, k: 'crm_contacts' },
    { h: 'CRM contacts per target grower', w: 11, f: DEC, k: 'contacts_per_target_grower' },
  ] },
  { group: 'Internal team', cols: [
    { h: 'Distinct roles', w: 9, f: INT, k: 'team_roles' },
    { h: 'Role entries', w: 9, f: INT, k: 'team_entries' },
    { h: 'Team time (sum of % shares)', w: 11, f: DEC, k: 'team_fte' },
    { h: 'Capabilities covered', w: 11, f: INT, k: 'team_capabilities' },
    { h: 'Expert entries', w: 8, f: INT, k: 'team_expert' },
    { h: 'Medium entries', w: 8, f: INT, k: 'team_medium' },
    { h: 'Junior entries', w: 8, f: INT, k: 'team_junior' },
    { h: 'MaSE completed (of listed)', w: 11, v: (x) => (x.s ? `${x.s.mase_completed} / ${x.s.mase_total}` : null) },
    { h: 'MaSE completed', w: 9, f: INT, k: 'mase_completed' },
  ] },
  { group: 'Agencies & delivery', cols: [
    { h: 'Agencies', w: 9, f: INT, k: 'agencies' },
    { h: 'Delivery in-house', w: 9, f: PCT, k: 'delivery_inhouse' },
    { h: 'Delivery agency', w: 9, f: PCT, k: 'delivery_agency' },
    { h: 'Delivery global team', w: 9, f: PCT, k: 'delivery_global' },
    { h: 'Agency spend: working media', w: 10, f: PCT, k: 'agency_working_media' },
    { h: 'Agency spend: fees + production', w: 10, f: PCT, k: 'agency_fees_production' },
    { h: 'Largest agency share of spend', w: 10, f: PCT, k: 'agency_largest_share' },
    { h: 'Agency data in Syngenta systems', w: 10, f: PCT, k: 'agency_data_stored' },
  ] },
  { group: 'Campaign planning', cols: [
    { h: 'Campaign planning', w: 18, k: 'campaign_planning' },
    { h: 'Customer journey maps', w: 9, k: 'journey_maps' },
    { h: '2026 NPIs', w: 8, f: INT, k: 'npis_2026' },
    { h: 'Direct grower contact', w: 20, k: 'direct_grower_contact' },
  ] },
  { group: 'Budget (USD)', cols: [
    { h: '2026 total A&P', w: 13, f: INT, k: 'ap_2026' },
    { h: '2026 digital marketing', w: 13, f: INT, k: 'dm_2026' },
    { h: '2026 digital share of A&P', w: 10, f: PCT, k: 'dm_share_2026' },
    { h: '2026 paid digital media', w: 13, f: INT, k: 'paid_2026' },
    { h: '2026 paid share of digital', w: 10, f: PCT, k: 'paid_share_of_dm_2026' },
    { h: '2027 total A&P (plan)', w: 13, f: INT, k: 'ap_2027' },
    { h: '2027 digital marketing (plan)', w: 13, f: INT, k: 'dm_2027' },
    { h: '2027 digital share of A&P', w: 10, f: PCT, k: 'dm_share_2027' },
    { h: 'Digital budget change 2027 vs 2026', w: 10, f: PCT, k: 'dm_change_2027' },
  ] },
  { group: 'Channels, tools & KPIs', cols: [
    { h: 'Grower channels listed', w: 9, f: INT, k: 'grower_channels' },
    { h: 'Top 3 grower channels', w: 28, k: 'top_grower_channels' },
    { h: 'Tools listed', w: 8, f: INT, k: 'tools_listed' },
    { h: 'Distinct tools', w: 8, f: INT, k: 'distinct_tools' },
    { h: 'Owned DM channels listed', w: 9, f: INT, k: 'dm_channels' },
    { h: 'Avg channel maturity (0-4)', w: 9, f: DEC, k: 'dm_channel_avg_maturity' },
    { h: 'KPIs listed', w: 8, f: INT, k: 'kpis' },
  ] },
  { group: 'Data quality', cols: [
    { h: 'Values interpreted (see Data Quality)', w: 11, f: INT, k: 'data_quality_notes' },
  ] },
];

function styleHeader(row, height = 42) {
  row.height = height;
  row.eachCell((c) => {
    c.font = { name: FONT, size: 9, bold: true, color: { argb: C.headText } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.head } };
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = { bottom: { style: 'thin', color: { argb: C.grid } } };
  });
}

/** Writes a header row and data rows. cols: { h, w, v(x) | k, f }. */
function writeTable(ws, cols, items, startRow = 1) {
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = c.w || 14; });
  const hr = ws.getRow(startRow);
  cols.forEach((c, i) => { hr.getCell(i + 1).value = c.h; });
  styleHeader(hr);
  items.forEach((x, n) => {
    const row = ws.getRow(startRow + 1 + n);
    cols.forEach((c, i) => {
      let v = c.v ? c.v(x) : x.s ? x.s[c.k] : null;
      if (v === undefined) v = null;
      const cell = row.getCell(i + 1);
      cell.value = v;
      cell.font = { name: FONT, size: 9, color: { argb: C.ink } };
      cell.alignment = { vertical: 'top', wrapText: (c.w || 14) >= 20 };
      if (c.f && typeof v === 'number') cell.numFmt = c.f;
      if (n % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.band } };
    });
  });
  ws.views = [{ state: 'frozen', xSplit: 4, ySplit: startRow }];
  ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: startRow + Math.max(items.length, 1), column: cols.length } };
}

/** Build the standardized records for every active country/BU row. */
export function collectGeneral(rows) {
  const sorted = [...rows].sort((a, b) => regionOrder(a.identity.region) - regionOrder(b.identity.region)
    || a.business_unit.localeCompare(b.business_unit) || a.identity.country_name.localeCompare(b.identity.country_name));
  return sorted.map((r) => {
    const status = gqStatus(r);
    const std = status === 'Read' ? standardizeGeneral(r.sub.general_detail) : null;
    return { r, status, std, s: std && !std.error ? std.summary : null };
  });
}

export async function generalQuestionsToBuffer(ExcelJS, portfolio, rows) {
  const year = portfolio.cfg.model.assessment_year;
  const recs = collectGeneral(rows);
  const read = recs.filter((x) => x.s);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DMMM Results Engine';
  wb.created = new Date();

  // ---- About
  const about = wb.addWorksheet('About');
  about.getColumn(1).width = 30; about.getColumn(2).width = 110;
  const lines = [
    [`DMMM ${year} General Questions`, ''],
    ['Built', new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'],
    ['Markets', `${recs.length} country/BU rows, ${read.length} with General Questions read`],
    ['', ''],
    ['What this file is', 'Every answer from the General Questions sheet of the country workbooks, one row per country and BU (Summary) and one sheet per list (team, tools, channels, KPIs ...).'],
    ['Standardized values', 'Numbers written as text are converted ("1.150.000", "USD 160.000", "Around 1 million", "55K"); ranges become their midpoint; "<3000" and "5+" use the stated bound; shares are fractions shown as %; Yes/No, experience, usage, owner, maturity and frequency use one spelling; tool and platform names are unified (e.g. GA4 -> Google Analytics, x.com -> X (Twitter)).'],
    ['Not answered', 'Blank cells, template prompts such as "(please select from the drop-down list)", "?" and "TBD" are left empty.'],
    ['Data Quality sheet', 'Every value that was interpreted is listed there with the original answer, so nothing is changed silently. Long free-text answers are not turned into numbers.'],
    ['Budget units', 'Amounts are in USD as written. Very small amounts (e.g. 2.35 or 250) are flagged because they were probably entered in millions or thousands; they are not rescaled.'],
    ['Team time', 'Sum of the "% of time spent" column. A person listed under several capabilities is counted once per capability, so this is time across capabilities, not headcount.'],
    ['CP and Seeds', 'Some markets answer the General Questions once for both BUs, so CP and Seeds rows can be identical.'],
  ];
  lines.forEach((l, i) => {
    const row = about.getRow(i + 1);
    row.getCell(1).value = l[0]; row.getCell(2).value = l[1];
    row.getCell(1).font = { name: FONT, size: i === 0 ? 14 : 10, bold: true, color: { argb: C.ink } };
    row.getCell(2).font = { name: FONT, size: 10, color: { argb: C.ink } };
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  });

  // ---- Summary (with a group header row)
  const sum = wb.addWorksheet('Summary');
  const cols = [...idCols(), ...SUMMARY_COLS.flatMap((g) => g.cols)];
  const groupRow = sum.getRow(1);
  let c0 = idCols().length + 1;
  for (const g of SUMMARY_COLS) {
    groupRow.getCell(c0).value = g.group;
    if (g.cols.length > 1) sum.mergeCells(1, c0, 1, c0 + g.cols.length - 1);
    c0 += g.cols.length;
  }
  styleHeader(groupRow, 18);
  writeTable(sum, cols, recs, 2);
  recs.forEach((x, n) => {
    if (!x.s) sum.getRow(3 + n).eachCell((c) => { c.font = { name: FONT, size: 9, italic: true, color: { argb: C.na } }; });
  });

  // ---- List sheets
  const list = (name, colsDef, pick) => {
    const ws = wb.addWorksheet(name);
    const items = read.flatMap((x) => (pick(x.std) || []).map((it) => ({ ...x, it })));
    writeTable(ws, [...idCols(), ...colsDef.map((c) => ({ ...c, v: c.v || ((x) => x.it[c.k]) }))], items);
    return ws;
  };
  list('Grower Channels', [
    { h: 'Priority', w: 8, k: 'priority' }, { h: 'Channel', w: 18, k: 'channel' }, { h: 'Answer as written', w: 30, k: 'answer' }, { h: 'Comment', w: 60, k: 'comment' },
  ], (s) => s.channels);
  list('Internal Team', [
    { h: 'Capability', w: 30, k: 'capability' }, { h: 'Role', w: 30, k: 'role' }, { h: '% of time', w: 9, f: PCT, k: 'time_share' },
    { h: 'Experience', w: 18, k: 'experience' }, { h: 'Comment', w: 40, k: 'comment' },
  ], (s) => s.team);
  list('MaSE', [
    { h: 'Capability', w: 26, k: 'capability' }, { h: 'Completed', w: 10, k: 'completed' }, { h: 'Who (comment)', w: 70, k: 'comment' },
  ], (s) => s.mase);
  list('Delivery Split', [
    { h: 'Activity', w: 40, k: 'activity' }, { h: 'In-house', w: 9, f: PCT, k: 'inhouse' }, { h: 'Agency', w: 9, f: PCT, k: 'agency' },
    { h: 'Global team', w: 9, f: PCT, k: 'global' }, { h: 'Total', w: 9, f: PCT, k: 'total' },
  ], (s) => [{ activity: 'Overall (all digital marketing work)', inhouse: s.summary.delivery_inhouse, agency: s.summary.delivery_agency, global: s.summary.delivery_global, total: s.summary.delivery_total }, ...s.activities]);
  list('Tools', [
    { h: 'Capability', w: 30, k: 'capability' }, { h: 'Tool (standardized)', w: 26, k: 'tool' }, { h: 'Tool as written', w: 30, k: 'tool_as_written' },
    { h: 'Usage / knowledge', w: 14, k: 'usage' }, { h: 'Comment', w: 50, k: 'comment' },
  ], (s) => s.tools);
  list('DM Channels', [
    { h: 'Channel type', w: 22, k: 'type' }, { h: 'Platform', w: 16, k: 'platform' }, { h: 'Channel / URL', w: 42, k: 'channel' },
    { h: 'Owner', w: 16, k: 'owner' }, { h: 'Maturity', w: 13, k: 'maturity' }, { h: 'Maturity (0-4)', w: 9, k: 'maturity_level' }, { h: 'Comment', w: 40, k: 'comment' },
  ], (s) => s.dmChannels);
  list('KPIs', [
    { h: 'Capability', w: 30, k: 'capability' }, { h: 'KPI', w: 45, k: 'kpi' }, { h: 'Frequency (standardized)', w: 20, k: 'frequency' },
    { h: 'Frequency as written', w: 26, k: 'frequency_as_written' }, { h: 'Comment', w: 40, k: 'comment' },
  ], (s) => s.kpis);

  // ---- Adoption: how many markets use each tool / platform
  const adopt = wb.addWorksheet('Adoption');
  const tally = (cat, pick) => {
    const m = new Map();
    for (const x of read) for (const name of new Set(pick(x.std))) {
      if (!name) continue;
      if (!m.has(name)) m.set(name, new Set());
      m.get(name).add(`${x.r.identity.country_id} ${BU_SHORT[x.r.business_unit] || x.r.business_unit}`);
    }
    return [...m].map(([name, set]) => ({ cat, name, n: set.size, share: read.length ? set.size / read.length : null, list: [...set].sort().join(', ') })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  };
  const adoptRows = [
    ...tally('Tool', (s) => s.tools.map((t) => t.tool)),
    ...tally('Owned DM channel (platform)', (s) => s.dmChannels.map((c) => c.platform)),
    ...tally('Grower channel (top 5)', (s) => s.channels.map((c) => c.channel)),
  ];
  writeTable(adopt, [
    { h: 'Category', w: 26, v: (x) => x.cat }, { h: 'Name', w: 30, v: (x) => x.name }, { h: 'Markets (country/BU)', w: 11, v: (x) => x.n },
    { h: 'Share of markets', w: 10, f: PCT, v: (x) => x.share }, { h: 'Which markets', w: 90, v: (x) => x.list },
  ], adoptRows);
  adopt.views = [{ state: 'frozen', ySplit: 1 }];

  // ---- Data quality
  const dq = wb.addWorksheet('Data Quality');
  const dqItems = recs.flatMap((x) => (x.std?.flags || []).map((f) => ({ ...x, it: f })))
    .concat(recs.filter((x) => !x.s).map((x) => ({ ...x, it: { section: 'Workbook', field: 'General Questions', raw: '', value: null, note: x.status } })));
  writeTable(dq, [...idCols(),
    { h: 'Section', w: 20, v: (x) => x.it.section }, { h: 'Field', w: 34, v: (x) => x.it.field }, { h: 'Answer as written', w: 50, v: (x) => x.it.raw || null },
    { h: 'Standardized value', w: 14, v: (x) => x.it.value }, { h: 'What was done', w: 70, v: (x) => x.it.note },
  ], dqItems);

  return wb.xlsx.writeBuffer();
}
