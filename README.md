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
   - **Global Metrics** file: the 2026 GDM layout (BU, REGION, COUNTRY, ... Technical UX Health, SEO Health Score,
     Web Vitals & Page Experience, Schema Validity Score ...) or the 2025 "All Global Metrics" layout
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
- **Download General Questions** writes a separate Excel file with every General Questions answer, one Summary row per
  country/BU and a sheet per list (Internal Team, MaSE, Delivery Split, Tools, DM Channels, KPIs, Grower Channels), plus
  an Adoption sheet (which markets use which tool / platform). Numbers written as text, shares, Yes/No, levels,
  frequencies, tool and platform names are standardized; every interpretation is listed on the Data Quality sheet.
  It needs the country workbooks loaded in the same session (a saved tracker alone does not contain these answers).
  CLI: `--gq-out general_questions.xlsx`.
- Scores reproduce each workbook's own **Summary outcome** sheet exactly: every capability is the AVERAGE of its
  questionnaire rows, an empty cell counts as 0, a cell holding text (e.g. a non-breaking space) is ignored and column
  P is not used; the overall is the AVERAGE of the 9 capabilities. Targets follow the same rules over column L.
- Validated Current uses the Global Metrics values on the GDM rows; it equals the Summary outcome whenever those
  values equal the GDM values in the workbook. The tracker shows "Excel Summary Outcome", "Matches Excel" and the
  reason for any difference (e.g. GDM rows left blank in the workbook). Blank cells are shown in blue with a note.
- The "Output & Target Level Defintion" sheet of the template is not used.
- Only a workbook with no self-ratings at all is "Not started".
- Global Metrics identity columns are found by header (BU / REGION / COUNTRY); files without these headers use the
  2025 positions (region, BU, market).
- If the file has only the raw SEMrush score (e.g. "SEO Health Score", 0-100), the SEO level is derived from the
  thresholds. A Level 4 derived this way is a candidate and waits for Global verification in the Validation Queue.
- If the cell holds the score and the GDM level together, e.g. `69 (3)`, the level in brackets is used as given and
  the score is kept as the raw value; Details shows when the thresholds would give a different level.
- If a country workbook has an empty Sign-up market or BU, they are taken from the file name (e.g.
  `DMMM_2026_GERMANY_CP.xlsm`) and a warning is shown.
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
