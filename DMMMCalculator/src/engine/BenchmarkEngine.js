export class DynamicBenchmarkEngine {
  constructor(assessmentRecords = []) {
    this.records = assessmentRecords.filter(r => 
      r.market && 
      !["TOTAL", "AVG", "AVERAGE", "OVERALL AVERAGE"].includes(r.market.toUpperCase().trim()) &&
      r.countryId !== null
    );
  }

  calculateBenchmark(filterFn, pillarKey = "validatedOverallCurrent") {
    const eligible = this.records.filter(r => {
      const passesFilter = filterFn(r);
      const val = r[pillarKey];
      const isNumeric = typeof val === "number" && !isNaN(val) && val > 0;
      return passesFilter && isNumeric;
    });

    const count = eligible.length;
    if (count === 0) return { value: null, n: 0, label: "N/A (n=0)" };

    const sum = eligible.reduce((acc, curr) => acc + curr[pillarKey], 0);
    const avg = Number((sum / count).toFixed(2));

    return {
      value: avg,
      n: count,
      label: `Avg: ${avg} (n=${count})`
    };
  }

  getRegionalBuBenchmark(region, bu, pillarKey = "validatedOverallCurrent") {
    return this.calculateBenchmark(
      r => r.region?.toUpperCase() === region?.toUpperCase() && r.bu?.toUpperCase() === bu?.toUpperCase(),
      pillarKey
    );
  }

  getGlobalBuBenchmark(bu, pillarKey = "validatedOverallCurrent") {
    return this.calculateBenchmark(
      r => r.bu?.toUpperCase() === bu?.toUpperCase(),
      pillarKey
    );
  }

  getTierBenchmark(tier, bu, pillarKey = "validatedOverallCurrent") {
    if (!tier) return { value: null, n: 0, label: "Tier Not Assigned" };
    return this.calculateBenchmark(
      r => r.tier === tier && r.bu?.toUpperCase() === bu?.toUpperCase(),
      pillarKey
    );
  }
}
