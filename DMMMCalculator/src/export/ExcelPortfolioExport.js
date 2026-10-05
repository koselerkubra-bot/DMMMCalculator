export function exportPortfolioWorkbook(assessments = [], benchmarkEngine, activeFilters = {}) {
  const XLSXLib = window.XLSX;
  if (!XLSXLib) {
    alert("SheetJS (xlsx) kütüphanesi bulunamadı!");
    return;
  }

  const wb = XLSXLib.utils.book_new();

  // 1. TAB: Portfolio Results
  const resultsData = assessments.map(a => ({
    "Region": a.region,
    "BU": a.bu,
    "Country": a.displayCountry || a.market,
    "Country Code": a.countryId,
    "Validation Status": a.validationStatus,
    "Completeness %": `${a.coverage?.completenessPct || 0}%`,
    "Self Current": a.selfOverallCurrent,
    "Validated Current": a.validatedOverallCurrent !== null ? a.validatedOverallCurrent : "Pending",
    "Country Target (+1Y)": a.countryTarget,
    "Validated Target Gap": a.validatedTargetGap,
    "Variance (Val - Self)": a.selfToValidatedVariance,
    "Region BU Benchmark": benchmarkEngine?.getRegionalBuBenchmark(a.region, a.bu).label || '-',
    "Global BU Benchmark": benchmarkEngine?.getGlobalBuBenchmark(a.bu).label || '-'
  }));
  const wsResults = XLSXLib.utils.json_to_sheet(resultsData);
  XLSXLib.utils.book_append_sheet(wb, wsResults, "Portfolio Results");

  // 2. TAB: Benchmark Summary
  const benchmarkData = [
    { Scope: "Global CP Validated Average", ...(benchmarkEngine ? benchmarkEngine.getGlobalBuBenchmark("CP") : {}) },
    { Scope: "Global Seeds Validated Average", ...(benchmarkEngine ? benchmarkEngine.getGlobalBuBenchmark("Seeds") : {}) }
  ];
  const wsBench = XLSXLib.utils.json_to_sheet(benchmarkData);
  XLSXLib.utils.book_append_sheet(wb, wsBench, "Benchmark Summary");

  // 3. TAB: Data Quality
  const dataQualityRows = assessments
    .filter(a => !a.isValid || a.validationStatus === "Pending Global validation")
    .map(a => ({
      "Market Raw": a.market,
      "BU": a.bu,
      "Issue": !a.isValid ? "Unrecognized Country Alias" : "Pending Global Validation",
      "Action Required": "Review in Country Alias Master or GDM Hub"
    }));
  const wsQuality = XLSXLib.utils.json_to_sheet(dataQualityRows.length ? dataQualityRows : [{ Status: "All records clean" }]);
  XLSXLib.utils.book_append_sheet(wb, wsQuality, "Data Quality");

  // 4. TAB: Prepopulation Coverage
  const coverageData = assessments.map(a => ({
    "Assessment Key": `${a.countryId}_${a.bu}`,
    "Required Skills": a.coverage?.requiredSkills || 0,
    "Completed Skills": a.coverage?.completedSkills || 0,
    "Pending Skills": a.coverage?.pendingCount || 0,
    "Coverage %": `${a.coverage?.completenessPct || 0}%`
  }));
  const wsCoverage = XLSXLib.utils.json_to_sheet(coverageData);
  XLSXLib.utils.book_append_sheet(wb, wsCoverage, "Prepopulation Coverage");

  // 5. TAB: Historical Reference
  const wsHistorical = XLSXLib.utils.json_to_sheet([{ Notice: "Imported tracker reference data with full provenance." }]);
  XLSXLib.utils.book_append_sheet(wb, wsHistorical, "Historical Reference");

  // 6. TAB: Report Parameters
  const paramData = [
    { Parameter: "Generated At", Value: new Date().toISOString() },
    { Parameter: "Active Filters", Value: JSON.stringify(activeFilters) },
    { Parameter: "Engine Release", Value: "DMMM Calculator v2025.2.0" }
  ];
  const wsParams = XLSXLib.utils.json_to_sheet(paramData);
  XLSXLib.utils.book_append_sheet(wb, wsParams, "Report Parameters");

  // İndir
  XLSXLib.writeFile(wb, `DMMM_Portfolio_Results_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
}
