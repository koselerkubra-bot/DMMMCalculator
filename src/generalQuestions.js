// General Questions sheet: full extraction and standardization.
//
// extractGeneral(sheet)   reads every section of the sheet into plain raw values (no interpretation).
// standardizeGeneral(raw) turns the raw answers into comparable values and records every
//                         interpretation it made in `flags`, so nothing is changed silently.
//
// Sections are found by their title in column B, so small layout shifts do not break the read.

const SECTIONS = {
  insights: 'Customer Insights',
  growers: 'Number of total growers',
  team: 'Internal Team',
  mase: 'MaSE Certification',
  agencies: 'Agencies',
  delivery: 'Overall Delivery Split',
  activity: 'Activity',
  budgetSplit: 'Budget Split',
  campaign: 'Campaign Planning',
  tools: 'Tools',
  dmChannels: 'DM Channels',
  kpis: 'KPIs',
  spending: 'Digital Marketing Spending',
  budget2026: '2026 Budget',
  budget2027: '2027 Budget',
};

// Template order of the Internal Team block (two rows per capability, then Other), used when
// a country cleared the capability names in column B.
const TEAM_DEFAULTS = ['Digital Marketing Strategy (DMS)', 'Content Marketing', 'Paid Digital Media', 'Social Media', 'Influencer Marketing & Partnership',
  'User Experience (UX) Web Design / Mobile', 'Search Engine Optimization (SEO)', 'Data & Analytics', 'Marketing Automation']
  .flatMap((c) => [c, null]).concat(['Other']);

const text = (v) => (v === null || v === undefined ? '' : String(v).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim());

function findRows(sheet) {
  const found = {};
  for (let r = 1; r <= sheet.maxRow; r++) {
    const b = text(sheet.at(r, 2));
    if (!b) continue;
    for (const [k, title] of Object.entries(SECTIONS)) {
      if (found[k] === undefined && b.toLowerCase().startsWith(title.toLowerCase())) found[k] = r;
    }
  }
  return found;
}

/** Raw read of the General Questions sheet. Returns null when the sections cannot be found. */
export function extractGeneral(sheet) {
  if (!sheet) return null;
  const at = findRows(sheet);
  const need = ['insights', 'growers', 'team', 'mase', 'agencies', 'delivery', 'activity', 'budgetSplit', 'campaign', 'tools', 'dmChannels', 'kpis', 'budget2026', 'budget2027'];
  if (need.some((k) => at[k] === undefined)) return { error: `Sections not found: ${need.filter((k) => at[k] === undefined).join(', ')}` };
  const v = (r, c) => sheet.at(r, c);
  const rows = (from, to, cols, opts = {}) => {
    const out = [];
    let label = null;
    for (let r = from; r <= to; r++) {
      const b = text(v(r, 2));
      const isLabel = b && /[a-z]/i.test(b) && !/^e\.?g\.?[,:]?\s/i.test(b) && !/^\(?include/i.test(b);
      if (isLabel) label = b;
      else if (opts.defaults && opts.defaults[r - from]) label = opts.defaults[r - from];
      const rec = { row: r, label: opts.carry === false ? (isLabel ? b : null) : label };
      for (const [k, c] of Object.entries(cols)) rec[k] = v(r, c);
      out.push(rec);
    }
    return out;
  };
  const headerAfter = (start, end, word) => {
    for (let r = start; r <= end; r++) if (text(v(r, 2)).toLowerCase().startsWith(word) || text(v(r, 3)).toLowerCase().startsWith(word)) return r;
    return start;
  };
  const g = at.growers;
  const teamHdr = headerAfter(at.team, at.mase - 1, 'digital marketing capability');
  const maseHdr = headerAfter(at.mase, at.agencies - 1, 'digital marketing capability');
  const toolsHdr = headerAfter(at.tools, at.dmChannels - 1, 'digital marketing capability');
  const chHdr = headerAfter(at.dmChannels, at.kpis - 1, 'channel type');
  const kpiHdr = headerAfter(at.kpis, at.spending - 1, 'digital marketing capability');
  return {
    growerChannels: rows(at.insights + 1, g - 1, { channel: 3, rank: 4, comment: 6 }, { carry: false }),
    growers: { total: v(g, 3), targetC: v(g + 1, 3), targetD: v(g + 1, 4), contacts: v(g + 2, 3), contactsD: v(g + 2, 4) },
    team: rows(teamHdr + 1, at.mase - 1, { role: 3, pct: 4, experience: 5, comment: 6 }, { defaults: TEAM_DEFAULTS }),
    mase: rows(maseHdr + 1, at.agencies - 1, { done: 3, comment: 4 }, { carry: false }),
    agencies: { count: v(at.agencies + 1, 3), comment: [v(at.agencies + 1, 4), v(at.agencies + 1, 6)].map(text).filter(Boolean).join(' | ') },
    delivery: { inhouse: v(at.delivery + 1, 3), agency: v(at.delivery + 1, 4), global: v(at.delivery + 1, 5) },
    activities: rows(at.activity + 1, at.budgetSplit - 1, { inhouse: 3, agency: 4, global: 5 }, { carry: false }),
    budgetSplit: {
      workingMedia: v(at.budgetSplit + 1, 3), feesProduction: v(at.budgetSplit + 1, 4),
      largestAgency: v(at.budgetSplit + 2, 3), dataStored: v(at.budgetSplit + 3, 3),
    },
    campaign: {
      planning: v(at.campaign + 1, 3), journeyMaps: v(at.campaign + 2, 3), journeyComment: v(at.campaign + 2, 4),
      npis: v(at.campaign + 3, 3), npiComment: v(at.campaign + 3, 4), direct: v(at.campaign + 4, 3),
    },
    tools: rows(toolsHdr + 1, at.dmChannels - 1, { tool: 3, usage: 4, comment: 5 }),
    dmChannels: rows(chHdr + 1, at.kpis - 1, { channel: 3, owner: 4, maturity: 5, comment: 6 }),
    kpis: rows(kpiHdr + 1, at.spending - 1, { kpi: 3, frequency: 4, comment: 5 }),
    budget: {
      ap2026: v(at.budget2026 + 1, 3), dm2026: v(at.budget2026 + 2, 3), dmPct2026: v(at.budget2026 + 2, 4), paid2026: v(at.budget2026 + 3, 3), paidPct2026: v(at.budget2026 + 3, 4),
      ap2027: v(at.budget2027 + 1, 3), dm2027: v(at.budget2027 + 2, 3), dmPct2027: v(at.budget2027 + 2, 4),
      comment2026: [v(at.budget2026 + 1, 5), v(at.budget2026 + 2, 5), v(at.budget2026 + 3, 5)].map(text).filter(Boolean).join(' | '),
      comment2027: [v(at.budget2027 + 1, 5), v(at.budget2027 + 2, 5)].map(text).filter(Boolean).join(' | '),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Value standardization
// ---------------------------------------------------------------------------------------------

const PLACEHOLDER = /^(\(?\s*(please\s+)?(select|provide|specify|share|indicate)\b.*|\(.*drop[- ]?down.*\)|\?+|tbd|n\/?a|na|-+|—|none|x)$/i;

/** Blank, template prompts and "?" / "TBD" count as not answered. */
export function isUnanswered(v) {
  const t = text(v);
  return !t || PLACEHOLDER.test(t);
}

const NUM_TOKEN = /\d{1,3}(?:[ .,'’]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

function tokenToNumber(tok) {
  // 1.150.000 / 450 000 / 1,150,000 -> thousands groups; 1,5 or 1.5 -> decimal
  // Counts and amounts are whole numbers in practice, so a 3-digit group after "." or "," is a thousands group.
  if (/^\d{1,3}(?:[ .,'’]\d{3})+$/.test(tok)) return Number(tok.replace(/[ .,'’]/g, ''));
  if (/^\d{1,3}(?:[ .,'’]\d{3})+[.,]\d+$/.test(tok)) {
    const m = tok.match(/^(.*)[.,](\d+)$/);
    return Number(m[1].replace(/[ .,'’]/g, '') + '.' + m[2]);
  }
  return Number(tok.replace(',', '.'));
}

const scaleOf = (s) => {
  if (/\b(mln|million|millions|mio|mn|m)\b/i.test(s)) return 1e6;
  if (/\d\s*k\b|\bthousand/i.test(s)) return 1e3;
  return 1;
};

/**
 * Parse a count or amount written as free text.
 * kind: 'count' (growers, contacts) or 'money'. Returns { value, note } where note explains any interpretation.
 */
export function parseAmount(v, kind = 'count', prefer = null) {
  if (isUnanswered(v)) return { value: null, note: null };
  if (typeof v === 'number') {
    if (kind === 'count' && !Number.isInteger(v) && v < 1000 && /^\d+\.\d{3}$/.test(String(v))) {
      return { value: Math.round(v * 1000), note: `${v} read as ${Math.round(v * 1000)} (dot used as thousands separator)` };
    }
    if (kind === 'money' && v > 0 && v < 1000) return { value: v, note: `Amount ${v} is unusually small: check the unit (thousands or millions?)` };
    return { value: v, note: null };
  }
  const s = text(v);
  // Several labelled parts, e.g. "LT-132076; LV -49994; EE-10519": add them up
  const parts = [...s.matchAll(/\b([A-Z]{2})\s*[-:]\s*([\d .,]+)/g)];
  if (parts.length >= 2) {
    const sum = parts.reduce((a, m) => a + tokenToNumber(m[2].trim()), 0);
    return { value: sum, note: `Sum of ${parts.length} parts (${parts.map((m) => m[1]).join(', ')})` };
  }
  const toks = [...s.matchAll(NUM_TOKEN)].map((m) => ({ str: m[0], idx: m.index }));
  if (!toks.length) return { value: null, note: `"${s}" has no number` };
  if (s.length > 60 && !(prefer && new RegExp(prefer, 'i').test(s))) return { value: null, note: `Long free-text answer, no number taken: "${s.slice(0, 120)}${s.length > 120 ? '...' : ''}"` };
  const scale = scaleOf(s);
  const range = s.match(/(\d[\d .,]*)\s*(?:-|–|to)\s*(\d[\d .,]*)/);
  if (range && toks.length === 2) {
    const a = tokenToNumber(range[1].trim()) * scale; const b = tokenToNumber(range[2].trim()) * scale;
    return { value: Math.round((a + b) / 2), note: `Range ${s} -> midpoint` };
  }
  let pick = toks[0];
  let note = null;
  if (toks.length > 1) {
    if (prefer) {
      const re = new RegExp(prefer, 'i');
      const near = toks.find((t) => re.test(s.slice(t.idx + t.str.length, t.idx + t.str.length + 15)));
      if (near) pick = near;
    }
    note = `"${s}": used ${pick.str}${prefer ? '' : ' (first number)'}`;
  }
  let value = tokenToNumber(pick.str) * scale;
  if (scale !== 1 && !note) note = `"${s}" -> ${Math.round(value)}`;
  if (/^\s*(<|less than|under|below)/i.test(s)) note = `"${s}": upper bound used`;
  else if (/^\s*(>|more than|over|above)|\+\s*$/.test(s)) note = `"${s}": lower bound used`;
  else if (/~|around|approx|about|circa|ca\./i.test(s) && !note) note = `"${s}": approximate`;
  else if (!note && /[a-z]/i.test(s.replace(/usd|eur|in total/gi, ''))) note = `"${s}" -> ${Math.round(value)}`;
  value = Math.round(value * 100) / 100;
  if (kind === 'money' && value > 0 && value < 1000) note = [note, `Amount ${value} is unusually small: check the unit`].filter(Boolean).join('; ');
  return { value, note };
}

/** Parse a share. Accepts 0.35, 35, "35%", "35%+", "5%%". Returns a fraction 0-1. */
export function parsePct(v) {
  if (isUnanswered(v)) return { value: null, note: null };
  if (typeof v === 'number') {
    if (v >= 0 && v <= 1) return { value: v, note: null };
    if (v > 1 && v <= 100) return { value: v / 100, note: `${v} read as ${v}%` };
    return { value: null, note: `${v} is not a valid share` };
  }
  const s = text(v);
  const rg = s.match(/(\d+(?:[.,]\d+)?)\s*%?\s*(?:-|–|to)\s*(\d+(?:[.,]\d+)?)\s*%/);
  if (rg) { const mid = (Number(rg[1].replace(',', '.')) + Number(rg[2].replace(',', '.'))) / 200; return { value: mid, note: `Range "${s}" -> midpoint ${Math.round(mid * 1000) / 10}%` }; }
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*%/) || s.match(/^(\d+(?:[.,]\d+)?)\s*\+?$/);
  if (!m) return { value: null, note: `"${s}" is not a share` };
  let n = Number(m[1].replace(',', '.'));
  if (!/%/.test(s) && n <= 1) return { value: n, note: null };
  n /= 100;
  return { value: n, note: s === `${m[1]}%` ? null : `"${s}" read as ${Math.round(n * 1000) / 10}%` };
}

/** "5+" -> 5, "2" -> 2. */
export function parseSmallCount(v) {
  if (isUnanswered(v)) return { value: null, note: null };
  if (typeof v === 'number') return { value: v, note: null };
  const s = text(v);
  const m = s.match(/\d+/);
  if (!m) return { value: null, note: `"${s}" has no number` };
  return { value: Number(m[0]), note: /\+/.test(s) ? `"${s}": ${m[0]} or more` : null };
}

const canon = (map, v, fallback = 'keep') => {
  if (isUnanswered(v)) return null;
  const s = text(v);
  for (const [re, out] of map) if (re.test(s)) return out;
  return fallback === 'keep' ? s : fallback;
};

const CAMPAIGN = [[/omni/i, 'Omnichannel'], [/separ|tradition/i, 'Traditional and digital separately']];
const YESNO = [[/^y(es)?\b/i, 'Yes'], [/^no?\b/i, 'No']];
const DIRECT = [[/direct contact/i, 'Direct contact with growers'], [/retail|distribut/i, 'Only via retail / distributors'], [/plan|future|next/i, 'Planned']];
const EXPERIENCE = [[/expert|8\+/i, 'Expert (8+ years)'], [/medium|4-7|mid/i, 'Medium (4-7 years)'], [/junior|0-3/i, 'Junior (0-3 years)']];
const USAGE = [[/^prof/i, 'Professional'], [/^med|^interm/i, 'Medium'], [/^basic|^begin/i, 'Basic']];
const OWNER = [[/shared/i, 'CP & Seeds shared'], [/^cp\s*primar/i, 'CP primarily'], [/^cp\s*excl/i, 'CP only'], [/^se(eds)?\s*primar/i, 'Seeds primarily'], [/^se(eds)?\s*excl/i, 'Seeds only'], [/^other/i, 'Other']];
export const MATURITY_LEVELS = { Missing: 0, Developing: 1, Intermediate: 2, Advanced: 3, Benchmark: 4 };
const MATURITY = Object.keys(MATURITY_LEVELS).map((k) => [new RegExp(`^${k}`, 'i'), k]);

const PLATFORMS = [
  [/display|programmatic|\bgdn\b|dv\s*360|demand\s*gen|pmax/i, 'Display / programmatic'],
  [/facebook|fb\.com|\bmeta\b/i, 'Facebook'], [/\bin?stagram|\binsta\b/i, 'Instagram'], [/youtube|youtu\.be|\byt\b/i, 'YouTube'],
  [/whats\s*app/i, 'WhatsApp'], [/tik\s*tok/i, 'TikTok'], [/telegram|t\.me\//i, 'Telegram'], [/viber/i, 'Viber'],
  [/linkedin/i, 'LinkedIn'], [/twitter|\bx\.com|\bx\b(?!\w)/i, 'X (Twitter)'], [/pinterest/i, 'Pinterest'], [/snapchat/i, 'Snapchat'],
  [/wechat/i, 'WeChat'], [/\bline\b/i, 'LINE'], [/google\s*search|\bsearch engine|\bgoogle\b/i, 'Google Search'],
  [/podcast|spotify/i, 'Podcasts'], [/e-?mail|newsletter|marketing cloud|sfmc/i, 'Email'], [/\bsms\b/i, 'SMS'],
  [/forum/i, 'Forums'], [/agro\s*-?\s*platform|marketplace/i, 'Agro platforms'], [/mobile\s*app|\bapp\b|application/i, 'Mobile app'],
  [/virtual\s*world|metaverse/i, 'Virtual worlds'], [/website|web\s*site|\bweb\b|portal|\.com|\.[a-z]{2}\b\/?/i, 'Website'],
];

/** Platform name from a channel answer or URL. */
export function platformOf(v) {
  if (isUnanswered(v)) return null;
  const s = text(v);
  if (/^others?\b.*specify/i.test(s)) return null;
  for (const [re, name] of PLATFORMS) if (re.test(s)) return name;
  return s;
}

const TOOL_ALIASES = [
  [/marketing\s*cloud|\bsfmc\b/i, 'Salesforce Marketing Cloud'], [/sales\s*cloud|salesforce\s*crm|\bsfdc\b/i, 'Salesforce Sales Cloud'],
  [/^salesforce$/i, 'Salesforce'], [/ga\s*4|google\s*analytics/i, 'Google Analytics'], [/tag\s*manager|\bgtm\b/i, 'Google Tag Manager'],
  [/search\s*console/i, 'Google Search Console'], [/looker/i, 'Looker Studio'], [/power\s*bi/i, 'Power BI'], [/qlik/i, 'Qlik Sense'],
  [/sem\s*rush/i, 'SEMrush'], [/screaming\s*frog/i, 'Screaming Frog'], [/ahrefs/i, 'Ahrefs'], [/clarity/i, 'Microsoft Clarity'], [/hotjar/i, 'Hotjar'],
  [/emplifi/i, 'Emplifi'], [/canva/i, 'Canva'], [/trinity/i, 'Trinity'], [/lynx/i, 'Lynx'], [/figma/i, 'Figma'], [/\bvev\b/i, 'VEV'],
  [/brightcove/i, 'Brightcove'], [/drupal/i, 'Drupal'], [/wordpress/i, 'WordPress'], [/hubspot/i, 'HubSpot'], [/messagebird|bird\.com/i, 'MessageBird'],
  [/clevertap/i, 'CleverTap'], [/chat\s*gpt|openai/i, 'ChatGPT'], [/copilot/i, 'Microsoft Copilot'], [/gemini/i, 'Google Gemini'], [/claude/i, 'Claude'],
  [/midjourney/i, 'Midjourney'], [/adobe|photoshop|illustrator|premiere|after effects|lightroom/i, 'Adobe Creative Cloud'], [/capcut/i, 'CapCut'],
  [/meta\s*business|business\s*suite|facebook\s*ads|meta\s*ads|ads\s*manager/i, 'Meta Ads / Business Suite'], [/google\s*ads|adwords|pmax|performance\s*max/i, 'Google Ads'],
  [/dv\s*360|display\s*&?\s*video/i, 'DV360'], [/linkedin/i, 'LinkedIn'], [/tik\s*tok/i, 'TikTok'], [/youtube/i, 'YouTube'], [/instagram/i, 'Instagram'],
  [/facebook/i, 'Facebook'], [/whats\s*app/i, 'WhatsApp'], [/twitter|^x$|\bx\s*\(/i, 'X (Twitter)'], [/grower\s*console/i, 'Grower Console'],
  [/smart\s*agro/i, 'SmartAgro'], [/campaign\s*dashboard/i, 'Global Campaign Dashboard'], [/excel/i, 'Excel'], [/mailchimp/i, 'Mailchimp'],
];

export function toolName(v) {
  if (isUnanswered(v)) return null;
  const s = text(v);
  for (const [re, name] of TOOL_ALIASES) if (re.test(s)) return name;
  return s;
}

const FREQS = [
  ['Real-time', /real\s*-?time|live|continu|always/i], ['Daily', /daily|every\s*day|each\s*day/i],
  ['Weekly', /we+kly|once\s*a\s*week|every\s*week|per\s*week|\bweek\b/i], ['Bi-weekly', /bi-?weekly|every\s*(2|two)\s*weeks|fortnight/i],
  ['Monthly', /mont?h?ly|monthy|once\s*a\s*month|every\s*month|per\s*month|\bmonth\b/i], ['Quarterly', /quarter|\bq\b|every\s*3\s*months/i],
  ['Half-yearly', /half|semi|2\s*\/\s*year|twice\s*a\s*year|6\s*months/i], ['Yearly', /yearly|annual|once\s*a\s*year|per\s*year/i],
  ['Per campaign', /campaign|per\s*activity|ad\s*hoc|on\s*demand|when\s*needed|after\s*each|before\s*(launch|activation)|during\s*(the\s*)?activ|per\s*(send|email|post)/i],
];

/** "weekly / monthly" -> "Weekly; Monthly". Returns null when no known frequency is mentioned. */
export function frequencyOf(v) {
  if (isUnanswered(v)) return null;
  const s = text(v);
  const hits = FREQS.filter(([, re]) => re.test(s)).map(([n]) => n);
  // "bi-weekly" also matches "weekly": keep the more specific one only
  const out = hits.includes('Bi-weekly') && !/\bweekly\b(?!.*bi)/i.test(s.replace(/bi-?weekly/ig, '')) ? hits.filter((h) => h !== 'Weekly') : hits;
  return out.length ? out.join('; ') : null;
}

const round4 = (n) => (n === null || n === undefined ? null : Math.round(n * 10000) / 10000);

/**
 * Standardize the raw General Questions read.
 * Returns { summary, channels, team, mase, activities, tools, dmChannels, kpis, flags }.
 */
export function standardizeGeneral(raw) {
  const flags = [];
  const flag = (section, field, rawValue, value, note) => { if (note) flags.push({ section, field, raw: text(rawValue), value, note }); };
  if (!raw || raw.error) return { error: raw?.error || 'General Questions sheet not found', flags };

  // Grower channels (in priority order)
  const channels = [];
  for (const r of raw.growerChannels) {
    const ans = text(r.channel);
    const other = /^others?\b/i.test(ans);
    const src = other ? r.comment : r.channel;
    if (isUnanswered(src)) continue;
    const name = platformOf(src);
    if (!name) continue;
    channels.push({ priority: channels.length + 1, channel: name, answer: other ? `Other: ${text(r.comment)}` : ans, comment: other ? null : text(r.comment) || null });
  }

  // Growers and contacts
  const gt = parseAmount(raw.growers.total, 'count');
  flag('Growers', 'Total growers', raw.growers.total, gt.value, gt.note);
  const targetRaw = !isUnanswered(raw.growers.targetD) ? raw.growers.targetD : raw.growers.targetC;
  let targetN = null; let targetPct = null;
  if (!isUnanswered(targetRaw) && /%/.test(text(targetRaw))) {
    const p = parsePct(targetRaw); targetPct = p.value;
    flag('Growers', 'Target growers', targetRaw, p.value, `Given as a share${p.note ? ` (${p.note})` : ''}; number = share x total growers`);
    if (p.value !== null && gt.value) targetN = Math.round(p.value * gt.value);
  } else {
    const t = parseAmount(targetRaw, 'count');
    targetN = t.value; flag('Growers', 'Target growers', targetRaw, t.value, t.note);
    if (targetN !== null && gt.value) targetPct = targetN / gt.value;
  }
  const ct = parseAmount(raw.growers.contacts, 'count', 'contact');
  flag('Growers', 'CRM contacts', raw.growers.contacts, ct.value, ct.note);

  // Internal team
  const team = [];
  for (const r of raw.team) {
    if (isUnanswered(r.role) && isUnanswered(r.pct)) continue;
    const p = parsePct(r.pct);
    flag('Internal team', `${r.label || ''} / ${text(r.role)}`, r.pct, p.value, p.note);
    team.push({ capability: r.label, role: isUnanswered(r.role) ? null : text(r.role), time_share: p.value, experience: canon(EXPERIENCE, r.experience), comment: text(r.comment) || null });
  }
  const fte = team.reduce((a, t) => a + (t.time_share || 0), 0);
  const expCount = (e) => team.filter((t) => t.experience === e).length;

  // MaSE
  const mase = raw.mase.filter((r) => r.label && !/^digital marketing capability/i.test(r.label)).map((r) => ({ capability: r.label, completed: canon(YESNO, r.done), comment: text(r.comment) || null }));

  // Agencies and delivery
  const ag = parseSmallCount(raw.agencies.count);
  flag('Agencies', 'Number of agencies', raw.agencies.count, ag.value, ag.note);
  const pctOf = (section, field, v) => { const p = parsePct(v); flag(section, field, v, p.value, p.note); return p.value; };
  const del = { inhouse: pctOf('Delivery', 'In-house %', raw.delivery.inhouse), agency: pctOf('Delivery', 'Agency %', raw.delivery.agency), global: pctOf('Delivery', 'Global team %', raw.delivery.global) };
  const delTotal = [del.inhouse, del.agency, del.global].some((x) => x !== null) ? (del.inhouse || 0) + (del.agency || 0) + (del.global || 0) : null;
  if (delTotal !== null && Math.abs(delTotal - 1) > 0.02) flag('Delivery', 'Total', '', round4(delTotal), `Delivery split adds up to ${Math.round(delTotal * 100)}%, not 100%`);
  const activities = raw.activities.filter((r) => r.label).map((r) => {
    const a = { activity: r.label, inhouse: pctOf('Delivery by activity', `${r.label} in-house`, r.inhouse), agency: pctOf('Delivery by activity', `${r.label} agency`, r.agency), global: pctOf('Delivery by activity', `${r.label} global`, r.global) };
    const any = [a.inhouse, a.agency, a.global].some((x) => x !== null);
    a.total = any ? round4((a.inhouse || 0) + (a.agency || 0) + (a.global || 0)) : null;
    if (any && Math.abs(a.total - 1) > 0.02) flag('Delivery by activity', r.label, '', a.total, `Adds up to ${Math.round(a.total * 100)}%, not 100%`);
    return a;
  });

  const bs = {
    workingMedia: pctOf('Agency spend', 'Working media %', raw.budgetSplit.workingMedia),
    feesProduction: pctOf('Agency spend', 'Agency fees + production %', raw.budgetSplit.feesProduction),
    largestAgency: pctOf('Agency spend', 'Largest agency share', raw.budgetSplit.largestAgency),
    dataStored: pctOf('Agency spend', 'Agency data stored in Syngenta systems', raw.budgetSplit.dataStored),
  };

  // Campaign planning
  const npi = parseSmallCount(raw.campaign.npis);
  flag('Campaign planning', '2026 NPIs', raw.campaign.npis, npi.value, npi.note);
  const campaign = {
    planning: canon(CAMPAIGN, raw.campaign.planning), journeyMaps: canon(YESNO, raw.campaign.journeyMaps),
    journeyComment: isUnanswered(raw.campaign.journeyComment) || /^\(please/i.test(text(raw.campaign.journeyComment)) ? null : text(raw.campaign.journeyComment),
    npis: npi.value, npiComment: isUnanswered(raw.campaign.npiComment) ? null : text(raw.campaign.npiComment), direct: canon(DIRECT, raw.campaign.direct),
  };

  // Tools
  const tools = [];
  for (const r of raw.tools) {
    if (isUnanswered(r.tool)) continue;
    const usageText = text(r.usage);
    const usage = canon(USAGE, r.usage, null);
    if (usageText && !usage && !isUnanswered(r.usage)) flag('Tools', text(r.tool), r.usage, null, 'Usage level is free text; moved to comment');
    tools.push({ capability: r.label, tool: toolName(r.tool), tool_as_written: text(r.tool), usage, comment: [text(r.comment), usage ? '' : (isUnanswered(r.usage) ? '' : usageText)].filter(Boolean).join(' | ') || null });
  }

  // DM channels
  const dmChannels = [];
  for (const r of raw.dmChannels) {
    if (isUnanswered(r.channel)) continue;
    const mat = canon(MATURITY, r.maturity, null);
    dmChannels.push({ type: r.label, channel: text(r.channel), platform: platformOf(r.channel), owner: canon(OWNER, r.owner), maturity: mat, maturity_level: mat ? MATURITY_LEVELS[mat] : null, comment: text(r.comment) || null });
  }

  // KPIs
  const kpis = [];
  for (const r of raw.kpis) {
    if (isUnanswered(r.kpi)) continue;
    const f = frequencyOf(r.frequency);
    if (!isUnanswered(r.frequency) && !f) flag('KPIs', text(r.kpi), r.frequency, null, 'Frequency not recognised; kept as written');
    kpis.push({ capability: r.label, kpi: text(r.kpi), frequency: f, frequency_as_written: isUnanswered(r.frequency) ? null : text(r.frequency), comment: text(r.comment) || null });
  }

  // Budget
  const money = (field, v) => { const m = parseAmount(v, 'money'); flag('Budget', field, v, m.value, m.note); return m.value; };
  const b = raw.budget;
  const budget = { ap2026: money('2026 total A&P (USD)', b.ap2026), dm2026: money('2026 digital marketing (USD)', b.dm2026), paid2026: money('2026 paid digital media (USD)', b.paid2026), ap2027: money('2027 total A&P (USD)', b.ap2027), dm2027: money('2027 digital marketing (USD)', b.dm2027) };
  const share = (a, t) => (a !== null && t ? a / t : null);
  budget.dmShare2026 = share(budget.dm2026, budget.ap2026);
  budget.paidShareOfDm2026 = share(budget.paid2026, budget.dm2026);
  budget.dmShare2027 = share(budget.dm2027, budget.ap2027);
  budget.dmChange = budget.dm2026 && budget.dm2027 !== null ? budget.dm2027 / budget.dm2026 - 1 : null;
  for (const [k, lbl] of [['dmShare2026', '2026 digital share of A&P'], ['dmShare2027', '2027 digital share of A&P'], ['paidShareOfDm2026', '2026 paid media share of digital']]) {
    if (budget[k] !== null && budget[k] > 1) flag('Budget', lbl, '', round4(budget[k]), `Above 100%: the amounts are probably in different units`);
  }

  const summary = {
    growers_total: gt.value, growers_target: targetN, growers_target_share: round4(targetPct), crm_contacts: ct.value,
    contacts_per_target_grower: targetN && ct.value !== null ? round4(ct.value / targetN) : null,
    team_roles: new Set(team.map((t) => (t.role || '').toLowerCase()).filter(Boolean)).size, team_entries: team.length, team_fte: round4(fte), team_capabilities: new Set(team.filter((t) => t.time_share).map((t) => t.capability)).size,
    team_expert: expCount('Expert (8+ years)'), team_medium: expCount('Medium (4-7 years)'), team_junior: expCount('Junior (0-3 years)'),
    mase_completed: mase.filter((m) => m.completed === 'Yes').length, mase_answered: mase.filter((m) => m.completed).length, mase_total: mase.length,
    agencies: ag.value,
    delivery_inhouse: del.inhouse, delivery_agency: del.agency, delivery_global: del.global, delivery_total: round4(delTotal),
    agency_working_media: bs.workingMedia, agency_fees_production: bs.feesProduction, agency_largest_share: bs.largestAgency, agency_data_stored: bs.dataStored,
    campaign_planning: campaign.planning, journey_maps: campaign.journeyMaps, npis_2026: campaign.npis, direct_grower_contact: campaign.direct,
    ap_2026: budget.ap2026, dm_2026: budget.dm2026, dm_share_2026: round4(budget.dmShare2026), paid_2026: budget.paid2026, paid_share_of_dm_2026: round4(budget.paidShareOfDm2026),
    ap_2027: budget.ap2027, dm_2027: budget.dm2027, dm_share_2027: round4(budget.dmShare2027), dm_change_2027: round4(budget.dmChange),
    grower_channels: channels.length, top_grower_channels: channels.slice(0, 3).map((c) => c.channel).join(', ') || null,
    tools_listed: tools.length, distinct_tools: new Set(tools.map((t) => t.tool)).size,
    dm_channels: dmChannels.length, dm_channel_avg_maturity: dmChannels.some((c) => c.maturity_level !== null) ? round4(dmChannels.filter((c) => c.maturity_level !== null).reduce((a, c) => a + c.maturity_level, 0) / dmChannels.filter((c) => c.maturity_level !== null).length) : null,
    kpis: kpis.length, budget_comment: [b.comment2026, b.comment2027].filter(Boolean).join(' | ') || null,
    data_quality_notes: 0,
  };
  summary.data_quality_notes = flags.length;
  return { summary, channels, team, mase, activities, tools, dmChannels, kpis, campaign, flags };
}
