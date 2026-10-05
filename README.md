cat << 'EOF' > README.md
# DMMM 2026 Results Engine

Production-grade calculation & validation engine for Syngenta Crop Protection Digital Marketing Maturity Model (DMMM) 2026.

## Features
- Safe `.xlsm`/`.xlsx` parsing with no VBA macro execution.
- Deterministic 9-capability arithmetic mean calculation (0-4 scale).
- Profile detection: Global V1 vs. AMEA.
- CLI, FastAPI Microservice, and full Pytest suite.
EOF
