export const PILLARS = [
  "dmStrategy",
  "contentMarketing",
  "paidMedia",
  "socialMedia",
  "imPartnership",
  "uxMobile",
  "seo",
  "dataAnalytics",
  "marketingAutomation"
];

export class PrepopulationEngine {
  static processAssessment(countryRow, globalMasterRow = null) {
    const processed = { ...countryRow };

    // 1. Immutable Self Current Score & Targets
    processed.selfOverallCurrent = Number(countryRow.selfOverallCurrent || countryRow.currentMaturity || 0);
    processed.countryTarget = Number(countryRow.countryTarget || countryRow.targetMaturity || 0);

    // 2. Official Validated Score Logic
    if (globalMasterRow && globalMasterRow.officialValidatedScore !== undefined) {
      processed.validatedOverallCurrent = Number(globalMasterRow.officialValidatedScore);
      processed.validationStatus = "Validated";
      processed.validatedTargetGap = Number((processed.countryTarget - processed.validatedOverallCurrent).toFixed(2));
      processed.selfToValidatedVariance = Number((processed.validatedOverallCurrent - processed.selfOverallCurrent).toFixed(2));
    } else {
      processed.validatedOverallCurrent = null;
      processed.validationStatus = "Pending Global validation";
      processed.validatedTargetGap = "Self-assessed gap, pending Global validation";
      processed.selfToValidatedVariance = 0;
    }

    // 3. Pillar-level Prepopulation & Gaps
    processed.pillarData = {};
    PILLARS.forEach(pillar => {
      const selfScore = Number(countryRow[pillar]?.self || countryRow[pillar] || 0);
      const targetScore = Number(countryRow[pillar]?.target || countryRow[`${pillar}Goal`] || 0);
      const validatedScore = globalMasterRow?.pillars?.[pillar] !== undefined 
        ? Number(globalMasterRow.pillars[pillar]) 
        : null;

      processed.pillarData[pillar] = {
        selfCurrent: selfScore,
        target: targetScore,
        validatedCurrent: validatedScore,
        targetGap: validatedScore !== null 
          ? Number((targetScore - validatedScore).toFixed(2))
          : "Pending validation"
      };
    });

    // 4. Prepopulation Audit Metrics
    let requiredCount = 0;
    let completedCount = 0;
    let pendingCount = 0;

    PILLARS.forEach(p => {
      requiredCount++;
      if (processed.pillarData[p].validatedCurrent !== null) {
        completedCount++;
      } else {
        pendingCount++;
      }
    });

    processed.coverage = {
      requiredSkills: requiredCount,
      completedSkills: completedCount,
      pendingCount: pendingCount,
      completenessPct: Math.round((completedCount / requiredCount) * 100)
    };

    return processed;
  }
}
