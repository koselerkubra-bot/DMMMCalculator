"""FastAPI service for country workbook calculation and Global Tracker ingestion."""
from fastapi import FastAPI, File, HTTPException, UploadFile
from dmmm_engine.core import DMMMEngine, GlobalTrackerEngine

app = FastAPI(title="DMMM 2026 Results Engine API", version="0.2.0")


def check_workbook(file: UploadFile) -> None:
    if not (file.filename or "").lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Invalid format. Upload an .xlsx or .xlsm workbook.")


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "dmmm-results-engine", "version": "0.2.0"}


@app.post("/api/v1/assessments/calculate")
async def calculate_assessment(file: UploadFile = File(...)):
    check_workbook(file)
    return DMMMEngine.parse_and_calculate(await file.read(), file.filename or "upload.xlsx")


@app.post("/api/v1/global-data/global-tracker/preview")
async def preview_global_tracker(file: UploadFile = File(...)):
    check_workbook(file)
    return GlobalTrackerEngine.parse(await file.read(), file.filename or "global-tracker.xlsx")
