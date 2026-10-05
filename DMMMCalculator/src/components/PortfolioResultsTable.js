export function renderPortfolioTable(containerId, assessments = [], benchmarkEngine) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let html = `
    <div class="portfolio-table-wrapper" style="overflow-x: auto; margin-top: 15px;">
      <table class="table" style="width: 100%; border-collapse: collapse; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px;">
        <thead>
          <tr style="background: #1A202C; color: #FFF; text-align: left;">
            <th style="padding: 10px;">Region</th>
            <th style="padding: 10px;">BU</th>
            <th style="padding: 10px;">Market</th>
            <th style="padding: 10px;">Assessment Key</th>
            <th style="padding: 10px;">Status</th>
            <th style="padding: 10px; text-align: right;">Self Current</th>
            <th style="padding: 10px; text-align: right;">Validated</th>
            <th style="padding: 10px; text-align: right;">Target (+1Y)</th>
            <th style="padding: 10px; text-align: right;">Target Gap</th>
            <th style="padding: 10px;">Region BU Benchmark</th>
            <th style="padding: 10px;">Global BU Benchmark</th>
          </tr>
        </thead>
        <tbody>
  `;

  assessments.forEach((row, idx) => {
    const regionBench = benchmarkEngine ? benchmarkEngine.getRegionalBuBenchmark(row.region, row.bu) : { label: '-' };
    const globalBench = benchmarkEngine ? benchmarkEngine.getGlobalBuBenchmark(row.bu) : { label: '-' };
    const bg = idx % 2 === 0 ? "#FFFFFF" : "#F7FAFC";

    const statusBadge = row.validationStatus === "Validated" 
      ? `<span style="background: #C6F6D5; color: #22543D; padding: 2px 8px; border-radius: 12px; font-weight: 600; font-size: 11px;">Validated</span>`
      : `<span style="background: #FEFCBF; color: #744210; padding: 2px 8px; border-radius: 12px; font-weight: 600; font-size: 11px;">Pending</span>`;

    html += `
      <tr style="background: ${bg}; border-bottom: 1px solid #E2E8F0;">
        <td style="padding: 8px 10px; font-weight: bold;">${row.region}</td>
        <td style="padding: 8px 10px;">${row.bu}</td>
        <td style="padding: 8px 10px;">${row.displayCountry || row.market} ${row.isLightHouse ? '⭐' : ''}</td>
        <td style="padding: 8px 10px; font-family: monospace; font-size: 11px; color: #4A5568;">${row.countryId || 'UNKNOWN'}_${row.bu}</td>
        <td style="padding: 8px 10px;">${statusBadge}</td>
        <td style="padding: 8px 10px; text-align: right;">${row.selfOverallCurrent ? row.selfOverallCurrent.toFixed(1) : '0.0'}</td>
        <td style="padding: 8px 10px; text-align: right; font-weight: bold; color: ${row.validatedOverallCurrent !== null ? '#2B6CB0' : '#A0AEC0'};">
          ${row.validatedOverallCurrent !== null ? row.validatedOverallCurrent.toFixed(1) : 'Pending'}
        </td>
        <td style="padding: 8px 10px; text-align: right;">${row.countryTarget ? row.countryTarget.toFixed(1) : '0.0'}</td>
        <td style="padding: 8px 10px; text-align: right; font-weight: 500; color: ${typeof row.validatedTargetGap === 'number' && row.validatedTargetGap > 0 ? '#E53E3E' : '#38A169'};">
          ${row.validatedTargetGap}
        </td>
        <td style="padding: 8px 10px; font-size: 11px; color: #4A5568;">${regionBench.label}</td>
        <td style="padding: 8px 10px; font-size: 11px; color: #4A5568;">${globalBench.label}</td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  container.innerHTML = html;
}
