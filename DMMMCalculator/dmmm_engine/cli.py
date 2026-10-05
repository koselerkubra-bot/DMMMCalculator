"""
CLI Tool for DMMM 2026 Engine
Usage: python -m dmmm_engine.cli <path_to_workbook.xlsm>
"""

import sys
import json
from pathlib import Path
from dmmm_engine.core import DMMMEngine

def main():
    if len(sys.argv) < 2:
        print("Usage: python -m dmmm_engine.cli <path_to_workbook.xlsx/.xlsm>")
        sys.exit(1)

    file_path = Path(sys.argv[1])
    if not file_path.exists():
        print(f"Error: File not found at '{file_path}'")
        sys.exit(1)

    with open(file_path, "rb") as f:
        file_bytes = f.read()

    results = DMMMEngine.parse_and_calculate(file_bytes, filename=file_path.name)
    print(json.dumps(results, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
