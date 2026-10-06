# DMMM 2026 Results Engine

## MVP scope

This release supports:

- Country DMMM 2026 `.xlsx` / `.xlsm` workbook parsing.
- Deterministic calculation from `DMMM Questionnaire!K`, `L`, and `P` only.
- P=0 exclusion from both numerator and denominator.
- Separate self current, approved Global current, and country target values.
- Global Tracker 2025 `Global Metrics` preview import for rows 13, 23, 24, 46, 69 and 89.
- SEMrush Health Score mapping for row 69, capped at proposed Level 3 because Level 4 requires separate CWV and critical-issue evidence.
- Browser-session portfolio report with XLSX export.

## Important scoring rules

- The country workbook is immutable input.
- GDM can approve current-score proposals only.
- Targets are country-owned and are never populated, calculated, or overwritten by Global Data Hub.
- The overall score is the equal-weight average of the 9 capability scores.
- Legacy workbook formulas/macros are never executed or used as the authoritative score source.
- The static GitHub Pages UI is a functional MVP, not a secure persistent production service. Its session data is cleared on page refresh.

## Running the API locally

```bash
python -m pip install -r requirements.txt
uvicorn dmmm_engine.api:app --reload --port 8000
pytest -q
```

Endpoints:

- `POST /api/v1/assessments/calculate`
- `POST /api/v1/global-data/global-tracker/preview`
- `GET /health`

## Required production work

1. PostgreSQL persistence, immutable source-file storage, SSO, roles and audit events.
2. Country Alias Master to map source variants, such as `Turkey*`, `TURKIYE`, and `TR - CP`, to a stable country ID.
3. Dedicated ingestion profiles for Lighthouse/CWV, GSC, schema validation and SFMC/Bird deliverability sources.
4. GDM approval workflow with reviewer, rationale and timestamp.
5. Generated GDM Validated workbook, PDF and PowerPoint outputs.
6. Versioned 2026 model configuration, including resolution of the 10-versus-11 SEO-skill discrepancy.

## Next step

Deploy the static MVP to GitHub Pages, then move the API and persistent Global Data Hub to an authenticated internal hosting environment before real country data is processed.
