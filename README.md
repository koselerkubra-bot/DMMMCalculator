# DMMM 2026 Results Engine - Sprint 2 Foundation

Batch ingestion and tracker generation for DMMM 2026 country workbooks.

## Principles
- Country source workbooks are read-only inputs. This tool never overwrites them.
- Current self-ratings and +1Y targets are stored separately. Global validation may only affect current-rating proposals.
- Overall score is the unweighted mean of the nine capability scores. A capability is the mean of included (`P=1`) valid skill scores.
- A missing included current score blocks finalisation; `P=0` skills are excluded from both numerator and denominator.

## Run
```powershell
python -m pip install -r requirements.txt
python -m pytest -v
python -m dmmm_engine.cli --input-folder .\sample_submissions --output .\output\DMMM_2026_Global_Results_Tracker.xlsx
```

## Sprint 2 scope
- Detect Europe, AMEA, South Korea, Russia and Iran profiles from workbook characteristics.
- Batch parse country workbooks, retain country/BU/year identity, and report validation issues.
- Generate a 2026 tracker with Results, regional views, Intake Log and Validation Queue.
- Global Metrics mapping and final GDM approval are deliberately configuration-driven placeholders until 2026 thresholds are approved.
