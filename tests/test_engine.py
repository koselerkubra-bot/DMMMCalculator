import io
import openpyxl
from dmmm_engine.core import CANONICAL_CAPABILITIES, DMMMEngine, GlobalTrackerEngine


def country_workbook(score=2, exclude_rows=None, blank_rows=None):
    exclude_rows, blank_rows = set(exclude_rows or []), set(blank_rows or [])
    wb = openpyxl.Workbook(); q = wb.active; q.title = "DMMM Questionnaire"
    for cell, value in {"B4":"Capability", "C4":"Skill", "K4":"Self-rating", "L4":"Target Rating +1 years", "M4":"Comments", "P4":"Weighting"}.items(): q[cell] = value
    for capability in CANONICAL_CAPABILITIES.values():
        for row in capability["rows"]:
            q.cell(row, 3, f"Skill {row}"); q.cell(row, 11, None if row in blank_rows else score); q.cell(row, 12, score + 1 if score < 4 else 4); q.cell(row, 16, 0 if row in exclude_rows else 1)
    wb.create_sheet("Introduction"); wb.create_sheet("General Questions")
    su = wb.create_sheet("Sign-up")
    for cell, value in {"D5":"Test User", "D7":"Turkey", "D9":"Crop Protection", "D11":"Oct 2026", "D13":"Oct 2027"}.items(): su[cell] = value
    out = io.BytesIO(); wb.save(out); return out.getvalue()


def tracker_workbook():
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Global Metrics"
    headers = ["Region", "BU", "Market", "DMS Score Yes = 4, No =0", "Canva", "Trinity ", "Emplifi", "SEMrush score", "Marketing Cloud/Message Bird"]
    for col, value in enumerate(headers, 1): ws.cell(3, col, value)
    values = ["AMEA", "CP", "Turkey*", 4, 3, 2, 1, 81, 4]
    for col, value in enumerate(values, 1): ws.cell(4, col, value)
    out = io.BytesIO(); wb.save(out); return out.getvalue()


def test_equal_capability_weighting():
    result = DMMMEngine.parse_and_calculate(country_workbook(2))
    assert result["status"] == "Ready to calculate"
    assert result["summary"]["overall_current_score"] == 2.00
    assert result["summary"]["overall_target_score"] == 3.00
    assert result["summary"]["is_final"] is True


def test_exclusion_removes_numerator_and_denominator():
    result = DMMMEngine.parse_and_calculate(country_workbook(2, exclude_rows=[31, 32]))
    paid = result["capability_breakdown"]["PAID_MEDIA"]
    assert paid["included_skills_count"] == 10
    assert paid["excluded_skills_count"] == 2
    assert paid["current_score"] == 2.00


def test_current_missing_blocks_final_score():
    result = DMMMEngine.parse_and_calculate(country_workbook(2, blank_rows=[5]))
    assert result["status"] == "Blocked by input error"
    assert result["summary"]["overall_current_score"] is None
    assert any("K5" in message for message in result["validation"]["errors"])


def test_tracker_generates_current_proposals_not_targets():
    result = GlobalTrackerEngine.parse(tracker_workbook())
    assert result["status"] == "Ready for GDM review"
    by_row = {x["questionnaire_row"]: x for x in result["proposals"]}
    assert by_row[13]["proposed_current_score"] == 4
    assert by_row[69]["proposed_current_score"] == 3
    assert "target" not in by_row[23]
    assert by_row[23]["country_key"] == "turkey"
