// Small helpers shared by every engine module.

export function stripAccents(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/İ/g, 'I');
}

/** Upper-case, accent-free, single-spaced text used for every comparison. */
export function norm(s) {
  if (s === null || s === undefined) return '';
  return stripAccents(String(s)).toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Letters and digits only, for tolerant header matching ("SFDC/ GC" == "SFDC/GC"). */
export function compact(s) {
  return norm(s).replace(/[^A-Z0-9%]/g, '');
}

export function isBlank(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

export function round(v, dp = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

export function mean(values) {
  const xs = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Parse a country rating. The questionnaire offers 0,1,2,3,4 via a drop-down, but cells can
 * hold numbers, numeric text ("3") or the drop-down label ("(3) Clear vision ...").
 * Returns { value, issue } where issue is null, 'missing' or a description.
 */
export function parseRating(raw, valid = [0, 1, 2, 3, 4]) {
  if (isBlank(raw)) return { value: null, issue: 'missing' };
  if (typeof raw === 'boolean' || (typeof raw === 'object' && raw !== null)) return { value: null, issue: `invalid value ${JSON.stringify(raw)}` };
  let n;
  if (typeof raw === 'number') n = raw;
  else {
    const s = String(raw).trim();
    const m = /^\(?\s*(-?\d+(?:[.,]\d+)?)\s*\)?/.exec(s);
    if (!m) return { value: null, issue: `invalid value "${s}"` };
    n = Number(m[1].replace(',', '.'));
  }
  if (!Number.isInteger(n) || !valid.includes(n)) return { value: null, issue: `out of range (${raw})` };
  return { value: n, issue: null };
}

/** Inclusion flag in column P (header "Weighting"): 1 = include, 0 = exclude. */
export function parseFlag(raw) {
  if (isBlank(raw)) return { value: null, issue: 'missing inclusion flag' };
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (n === 0 || n === 1) return { value: n, issue: null };
  return { value: null, issue: `invalid inclusion flag (${raw})` };
}

/** GDM metric levels may be decimals (e.g. Trinity 2.5 in 2025). */
export function parseLevel(raw, naValues = []) {
  if (isBlank(raw)) return { value: null, status: 'missing' };
  if (typeof raw === 'number') {
    if (raw < 0 || raw > 4) return { value: null, status: 'invalid', note: `level ${raw} outside 0-4` };
    return { value: raw, status: 'ok' };
  }
  const s = String(raw).trim();
  if (naValues.map(norm).includes(norm(s))) return { value: null, status: 'na', note: s };
  const n = Number(s.replace(',', '.'));
  if (Number.isFinite(n) && n >= 0 && n <= 4) return { value: n, status: 'ok' };
  return { value: null, status: 'invalid', note: `"${s}" is not a level 0-4` };
}

export function parseNumber(raw) {
  if (isBlank(raw)) return null;
  if (typeof raw === 'number') return raw;
  const n = Number(String(raw).replace('%', '').replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
}

export async function sha256Hex(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function nowIso() {
  return new Date().toISOString();
}
