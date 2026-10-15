# DMMM 2026 Results Engine

Internal tool for Syngenta Crop Protection Global Digital Marketing. It reads completed DMMM 2026
country workbooks, calculates the scores, applies Global Digital Marketing (GDM) data to the
pre-populated rows and builds the Global DMMM Results Tracker.

**Privacy:** the web page processes files only in the browser. Nothing is uploaded or stored online,
and the repository contains no country data. Never commit real submissions or Global Metrics files
(`*.xlsm` and `private-fixtures/` are git-ignored).

## Using the tool

1. Open the GitHub Pages site.
2. Drop files onto the page. Each file is recognised automatically:
   - **Country workbooks** (DMMM 2026 template, one per country + BU)
   - **Global Metrics** file (2025 "All Global Metrics" layout, plus the 2026 columns)
   - **Saved 2026 tracker** (continue a previous session; applies reviewer decisions)
   - **2025 Global Tracker** (adds 2022-2025 history and the 2026 targets set last year)
3. Download the tracker. Keep it: it is also the saved state. Next time, load it together with the new
   country files to append them.

GDM reviewers record decisions in the *Validation Queue* sheet (Approve / Override / Reject /
Exclude (N/A)), save, and load the tracker again.

## Scoring rules

- Column P (header "Weighting") is the inclusion flag. P = 0 removes the skill from numerator and denominator.
  A rating of 0 is a valid score.
- Capability score = unweighted mean of included, valid skill scores. Overall = mean of the 9 capabilities.
- **Self Current**: country-owned rows, column K. **Target +1Y**: column L. Global never writes targets.
- **Validated Current**: country rows + GDM values for the 10 GDM-managed rows; only when every GDM row is
  resolved and the country input is complete.
- GDM values 0-4 from the Global Metrics file are accepted automatically (policy in `threshold_config_2026.json`);
  reviewers can still Override, Reject or Exclude any row.
- Country Input Status and GDM Validation Status are independent.
- YoY (needs the 2025 Global Tracker): *validated* = official, 2026 validated vs 2025 current (same basis, includes GDM data);
  *self, provisional* = 2026 self-assessment vs 2025 current, available before GDM data. Overall and capability level only,
  because the 2026 questionnaire has new and changed skills. See the YoY Comparison sheet.
- Capability boundaries are read from each workbook's `Summary outcome` formulas and checked against the model.
- Reading check: the engine reproduces the workbook's own Summary value from the parsed cells.

## Configuration (`/config`, versioned in Git)

| File | Contents |
|---|---|
| `model_2026.json` | Template layout: sheets, cells, 86 skills, capabilities, GDM-managed rows |
| `country_alias_master.json` | Countries, aliases, regions, subregions, lighthouse markets |
| `global_metrics_2026.json` | Global Metrics columns mapped to questionnaire rows |
| `threshold_config_2026.json` | 2026 thresholds and Level 4 / auto-accept policy |

## Development

```bash
npm ci
npm test                       # synthetic fixtures; real workbooks in ./private-fixtures are used if present
node cli/build-tracker.mjs --out tracker.xlsx --history DMMM_Global_Tracker_2025.xlsx \
     --metrics global_metrics.xlsx path/to/country/files/
python -m http.server 8000      # then open http://localhost:8000
```

The same engine (`/src`) runs in the browser, the CLI and the tests. GitHub Actions runs the tests on
every push and deploys to GitHub Pages only when they pass (Settings > Pages > Source: GitHub Actions).
