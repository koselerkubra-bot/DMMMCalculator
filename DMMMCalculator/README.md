# DMMM 2026 Results Engine (DMMMCalculator)

Production-grade calculation & validation engine for Syngenta Crop Protection Digital Marketing Maturity Model (DMMM) 2026.

## 🚀 Features
- **Safe Parser**: Reads \.xlsm\ / \.xlsx\ without executing VBA macros.
- **Deterministic 9-Capability Scoring**: Independent arithmetic mean (0 to 4 scale).
- **Profile Detection**: Global V1 vs. AMEA detection.
- **Microservice & CLI**: FastAPI REST endpoints and CLI analysis tool.

## 🛠️ Usage
\\\ash
# Run CLI
python -m dmmm_engine.cli <path_to_workbook.xlsm>

# Run API
uvicorn dmmm_engine.api:app --reload --port 8000
\\\
"@

# 5. dmmm_engine/__init__.py
Set-Content -Path dmmm_engine\__init__.py -Encoding UTF8 -Value @"
from .core import DMMMEngine

__all__ = ["DMMMEngine"]
