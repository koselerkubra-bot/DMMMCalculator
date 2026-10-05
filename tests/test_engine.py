import io
import openpyxl
from dmmm_engine.core import DMMMEngine, CANONICAL_CAPABILITIES

def create_mock_workbook(default_score=2, exclude_rows=None):
    if exclude_rows is None:
        exclude_rows = []

    wb = openpyxl.Workbook()
    
    # 1. Questionnaire Sheet
    ws_q = wb.active
    ws_q.title = "DMMM Questionnaire"
    ws_q["R4"] = "Reviewer Notes (Global)"

    for cap_info in CANONICAL_CAPABILITIES.values():
        for r in cap_info["rows"]:
            ws_q.cell(row=r, column=3, value=f"Skill {r}")
            ws_q.cell(row=r, column=11, value=default_score) # Self score
            ws_q.cell(row=r, column=12, value=default_score + 1 if default_score < 4 else 4) # Target
            ws_q.cell(row=r, column=16, value=0 if r in exclude_rows else 1) # P flag

    # 2. Sign-up Sheet
    ws_su = wb.create_sheet(title="Sign-up")
    ws_su["D5"] = "Test User"
    ws_su["D7"] = "Turkey"
    ws_su["D9"] = "Crop Protection"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_baseline_score_calculation():
    """All 2s must yield 2.00 for all capabilities and 2.00 overall."""
    file_bytes = create_mock_workbook(default_score=2)
    res = DMMMEngine.parse_and_calculate(file_bytes)

    assert res["status"] == "Ready to calculate"
    assert res["summary"]["overall_current_score"] == 2.00
    assert res["summary"]["is_final"] is True

    for cap in res["capability_breakdown"].values():
        assert cap["current_score"] == 2.00


def test_p0_exclusion_logic():
    """P=0 rows should be dropped from both numerator and denominator."""
    # Exclude rows 31 and 32 in Paid Media (rows 25-36, total 12 skills)
    file_bytes = create_mock_workbook(default_score=2, exclude_rows=[31, 32])
    res = DMMMEngine.parse_and_calculate(file_bytes)

    paid_media = res["capability_breakdown"]["PAID_MEDIA"]
    assert paid_media["included_skills_count"] == 10
    assert paid_media["valid_scores_count"] == 10
    assert paid_media["current_score"] == 2.00
