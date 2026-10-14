// Separate country-level workbook: CountryName_BU_DMMM_2026_GDM_Validated.xlsx (or _GDM_Draft
// while validation is open). The original country submission is never modified.
import { writeCountrySheet } from './trackerExport.js';
import { GDM_STATUS } from './scoring.js';

export function countryFileName(r, year) {
  const safe = (s) => String(s).replace(/[^A-Za-z0-9]+/g, '');
  const state = r.validated_current !== null && r.gdm_status === GDM_STATUS.VALIDATED ? 'GDM_Validated' : 'GDM_Draft';
  return `${safe(r.identity.country_name)}_${safe(r.business_unit)}_DMMM_${year}_${state}.xlsx`;
}

export async function buildCountryWorkbook(ExcelJS, portfolio, r) {
  const model = portfolio.cfg.model;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DMMM 2026 Results Engine';
  writeCountrySheet(wb.addWorksheet('Summary'), r, model);
  const a = wb.addWorksheet('Audit');
  const rows = [
    ['Country', r.identity.country_name], ['Business Unit', r.business_unit], ['Region', r.identity.region], ['Profile', r.identity.profile],
    ['Assessment year', r.sub.assessment_year], ['Country Input Status', r.country_status], ['GDM Validation Status', r.gdm_status],
    ['Source workbook (unchanged)', r.sub.source_file_name], ['Source SHA-256', r.sub.source_file_hash], ['Version', r.sub.version],
    ['Submitter', r.sub.submitter], ['Global Metrics source', portfolio.metrics?.source_file_name ?? 'none'],
    ['Thresholds version', portfolio.cfg.versions.thresholds], ['Generated (UTC)', new Date().toISOString()],
    ['Note', 'Country self current and country targets are the country\'s own ratings. GDM proposals and approvals apply to current scores of GDM-managed rows only.'],
  ];
  rows.forEach(([k, v], i) => { a.getCell(i + 1, 1).value = k; a.getCell(i + 1, 2).value = v; a.getCell(i + 1, 1).font = { name: 'Arial', bold: true, size: 9 }; a.getCell(i + 1, 2).font = { name: 'Arial', size: 9 }; });
  a.getColumn(1).width = 28; a.getColumn(2).width = 90;
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
