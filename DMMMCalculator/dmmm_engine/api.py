"""
FastAPI Microservice for DMMM Engine
Usage: uvicorn dmmm_engine.api:app --reload --port 8000
"""

from fastapi import FastAPI, UploadFile, File, HTTPException
from dmmm_engine.core import DMMMEngine

app = FastAPI(
    title="DMMM 2026 Results Engine API",
    description="Validation and Calculation Microservice for Syngenta DMMM 2026 Workbooks",
    version="1.0.0"
)

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "dmmm-results-engine"}

@app.post("/api/v1/assessments/calculate")
async def calculate_assessment(file: UploadFile = File(...)):
    if not (file.filename.endswith(".xlsx") or file.filename.endswith(".xlsm")):
        raise HTTPException(status_code=400, detail="Invalid format. Please upload .xlsx or .xlsm.")

    content = await file.read()
    results = DMMMEngine.parse_and_calculate(file_bytes=content, filename=file.filename)
    return results
