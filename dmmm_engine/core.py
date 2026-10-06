"""Deterministic parsing, scoring and Global Tracker ingestion for DMMM 2026."""
from __future__ import annotations

import hashlib
import io
import re
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

import openpyxl

CANONICAL_CAPABILITIES = {
    "DMS": {"name": "Digital Marketing Strategy", "rows": range(5, 14)},
    "CONTENT": {"name": "Content Marketing", "rows": range(14, 25)},
    "PAID_MEDIA": {"name": "Paid Digital Media", "rows": range(25, 37)},
    "SOCIAL": {"name": "Social Media", "rows": range(37, 47)},
    "INFLUENCER": {"name": "Influencer Marketing & Partnership", "rows": range(47, 52)},
    "UX": {"name": "User Experience (UX) Web Design / Mobile", "rows": range(52, 61)},
    "SEO": {"name": "Search Engine Optimization (SEO)", "rows": range(61, 72)},
    "DATA_ANALYTICS": {"name": "Data & Analytics", "rows": range(72, 81)},
    "MARKETING_AUTO": {"name": "Marketing Automation", "rows": range(81, 91)},
}

PREPOPULATED_ROWS = {13, 23, 24, 46, 60, 69, 70, 71, 89, 90}
REQUIRED_SHEETS = {"Introduction", "Sign-up", "General Questions", "DMMM Questionnaire"}
QUESTIONNAIRE_HEADERS = {
    "B4": "Capability", "C4": "Skill", "K4": "Self-rating",
    "L4": "Target Rating +1 years", "M4": "Comments", "P4": "Weighting",
}

# Global Tracker 2025 Global Metrics source mapping. These create proposed current
# score records only; target ratings are never imported or modified.
GLOBAL_METRICS_MAPPING = {
    "DMS Score Yes = 4, No =0": {"row": 13, "mode": "direct", "source": "Global Metrics / DMS completion"},
    "Canva": {"row": 23, "mode": "direct", "source": "Global Metrics / Canva"},
    "Trinity ": {"row": 24, "mode": "direct", "source": "Global Metrics / Trinity"},
    "Emplifi": {"row": 46, "mode": "direct", "source": "Global Metrics / Emplifi"},
    "SEMrush score": {"row": 69, "mode": "semrush_health", "source": "Global Metrics / SEMrush"},
    "Marketing Cloud/Message Bird": {"row": 89, "mode": "direct", "source": "Global Metrics / Marketing Cloud/Message Bird"},
}


def normalise_country(value: Any) -> str:
    text = str(value or "").strip().casefold()
    text = text.replace("türkiye", "turkey").replace("turkiye", "turkey")
    text = re.sub(r"\s*\*\s*$", "", text)
    text = re.sub(r"\s+new\s+2026$", "", text)
    text = re.sub(r"\s+seed(s)?$", "", text)
    text = re.sub(r"\s*-\s*seed$", "", text)
    return re.sub(r"[^a-z0-9]+", "", text)


def normalise_bu(value: Any) -> str:
    text = str(value or "").strip().casefold()
    return {"s": "seeds", "seed": "seeds", "seeds": "seeds", "cp": "cp", "crop protection": "cp"}.get(text, text)


def normalise_score(raw_value: Any) -> Tuple[Optional[float], str]:
    """Return an integer DMMM score only. Decimal capability values are invalid inputs."""
    if raw_value is None or str(raw_value).strip() == "":
        return None, "missing"
    if isinstance(raw_value, bool):
        return None, "invalid"
    text = str(raw_value).strip()
    match = re.fullmatch(r"([0-4])(?:\s*(?:-|\(|:).*)?", text)
    if not match:
        return None, "invalid"
    return float(match.group(1)), "valid"


def numeric_score(raw_value: Any) -> Optional[float]:
    """Normalise tracker data, accepting decimal comma for historical fields."""
    if raw_value is None or str(raw_value).strip() == "":
        return None
    try:
        value = float(str(raw_value).strip().replace(",", "."))
    except (TypeError, ValueError):
        return None
    return value if 0 <= value <= 4 else None


def parse_inclusion(raw_value: Any) -> Tuple[Optional[bool], str]:
    if raw_value is None or str(raw_value).strip() == "":
        return None, "missing"
    if isinstance(raw_value, bool):
        return None, "invalid"
    try:
        value = int(str(raw_value).strip())
    except (TypeError, ValueError):
        return None, "invalid"
    if value == 1:
        return True, "included"
    if value == 0:
        return False, "excluded"
    return None, "invalid"


def semrush_health_to_proposed_score(raw_value: Any) -> Tuple[Optional[float], str]:
    """L4 is deliberately not inferred: it needs additional CWV/critical-issue evidence."""
    try:
        health = float(str(raw_value).strip().replace(",", "."))
    except (TypeError, ValueError):
        return None, "invalid_metric"
    if health < 0 or health > 100:
        return None, "invalid_metric"
    if health < 40:
        return 0.0, "derived_l0"
    if health < 60:
        return 1.0, "derived_l1"
    if health < 75:
        return 2.0, "derived_l2"
    return 3.0, "derived_l3_level4_requires_additional_evidence"


class DMMMEngine:
    @staticmethod
    def normalize_score(raw_val: Any) -> Tuple[Optional[float], str]:
        return normalise_score(raw_val)

    @classmethod
    def parse_and_calculate(cls, file_bytes: bytes, filename: str = "upload.xlsm") -> Dict[str, Any]:
        checksum = hashlib.sha256(file_bytes).hexdigest()
        try:
            workbook = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=False, keep_vba=False)
        except Exception as exc:
            return {"status": "Blocked by file error", "errors": [f"Unreadable Excel file: {exc}"], "checksum": checksum}

        errors: List[str] = []
        warnings: List[str] = []
        missing_sheets = sorted(REQUIRED_SHEETS - set(workbook.sheetnames))
        if missing_sheets:
            return {"status": "Blocked by template mismatch", "errors": [f"Missing required sheet: {x}" for x in missing_sheets], "checksum": checksum}

        questionnaire = workbook["DMMM Questionnaire"]
        for cell, expected in QUESTIONNAIRE_HEADERS.items():
            actual = str(questionnaire[cell].value or "").strip()
            if actual != expected:
                errors.append(f"{cell}: expected header '{expected}', found '{actual or 'blank'}'.")
        if errors:
            return {"status": "Blocked by template mismatch", "errors": errors, "warnings": warnings, "checksum": checksum}

        profile = "DMMM_2026_AMEA" if "Reviewer Notes (AMEA)" in str(questionnaire["R4"].value or "") else "DMMM_2026_GLOBAL_WORKBOOK_V1"
        signup = workbook["Sign-up"]
        metadata = {
            "submitter": signup["D5"].value,
            "country": signup["D7"].value,
            "business_unit": signup["D9"].value,
            "assessment_date": str(signup["D11"].value or ""),
            "review_date": str(signup["D13"].value or ""),
        }
        for label in ("submitter", "country", "business_unit", "assessment_date", "review_date"):
            if metadata[label] in (None, ""):
                warnings.append(f"Sign-up!{ {'submitter':'D5','country':'D7','business_unit':'D9','assessment_date':'D11','review_date':'D13'}[label] }: {label.replace('_', ' ')} is blank.")

        skills: List[Dict[str, Any]] = []
        capabilities: Dict[str, Dict[str, Any]] = {}
        current_capability_values: List[float] = []
        target_capability_values: List[float] = []

        for capability_id, capability in CANONICAL_CAPABILITIES.items():
            current_values: List[float] = []
            target_values: List[float] = []
            included_count = excluded_count = 0
            capability_has_error = False
            for row in capability["rows"]:
                skill = questionnaire.cell(row, 3).value
                if not skill:
                    errors.append(f"C{row}: expected a skill name.")
                    capability_has_error = True
                    continue
                included, inclusion_status = parse_inclusion(questionnaire.cell(row, 16).value)
                if inclusion_status == "missing":
                    errors.append(f"P{row} ({skill}): inclusion flag is required; use 1 or 0.")
                    capability_has_error = True
                elif inclusion_status == "invalid":
                    errors.append(f"P{row} ({skill}): unsupported inclusion value '{questionnaire.cell(row, 16).value}'; use 1 or 0.")
                    capability_has_error = True
                if included is False:
                    excluded_count += 1
                elif included is True:
                    included_count += 1

                current, current_status = normalise_score(questionnaire.cell(row, 11).value)
                target, target_status = normalise_score(questionnaire.cell(row, 12).value)
                status = "excluded" if included is False else current_status
                if included is True and current is None:
                    errors.append(f"K{row} ({skill}): current self-rating is {current_status}.")
                    capability_has_error = True
                if included is True and target is None:
                    warnings.append(f"L{row} ({skill}): target rating is {target_status}; target gap cannot be completed.")
                if included is True and current is not None:
                    current_values.append(current)
                if included is True and target is not None:
                    target_values.append(target)
                skills.append({
                    "row": row, "capability_id": capability_id, "capability": capability["name"], "skill_name": skill,
                    "assessment_type": "prepopulated" if row in PREPOPULATED_ROWS else "self_assessment",
                    "inclusion_status": inclusion_status, "is_included": included is True, "is_prepopulated": row in PREPOPULATED_ROWS,
                    "raw_self": questionnaire.cell(row, 11).value, "normalized_self": current, "self_status": current_status,
                    "raw_target": questionnaire.cell(row, 12).value, "normalized_target": target, "target_status": target_status,
                    "comments": questionnaire.cell(row, 13).value, "reviewer_notes": questionnaire.cell(row, 18).value if profile == "DMMM_2026_AMEA" else None,
                })

            current_score = None if capability_has_error or included_count == 0 else sum(current_values) / included_count
            target_score = None if capability_has_error or included_count == 0 or len(target_values) != included_count else sum(target_values) / included_count
            if current_score is not None:
                current_capability_values.append(current_score)
            if target_score is not None:
                target_capability_values.append(target_score)
            capabilities[capability_id] = {
                "capability_name": capability["name"], "included_skills_count": included_count,
                "excluded_skills_count": excluded_count, "valid_current_count": len(current_values),
                "valid_target_count": len(target_values), "current_score": round(current_score, 2) if current_score is not None else None,
                "target_score": round(target_score, 2) if target_score is not None else None,
                "gap": round(target_score-current_score, 2) if current_score is not None and target_score is not None else None,
            }

        all_current_ready = len(current_capability_values) == 9 and not errors
        all_target_ready = len(target_capability_values) == 9 and not errors
        current_overall = round(sum(current_capability_values) / 9, 2) if all_current_ready else None
        target_overall = round(sum(target_capability_values) / 9, 2) if all_target_ready else None
        return {
            "metadata": {"file_name": filename, "sha256": checksum, "detected_profile": profile, "country_info": metadata},
            "status": "Ready to calculate" if not errors else "Blocked by input error",
            "validation": {"errors": errors, "warnings": warnings},
            "summary": {"overall_current_score": current_overall, "overall_target_score": target_overall,
                        "gap": round(target_overall-current_overall, 2) if current_overall is not None and target_overall is not None else None,
                        "is_final": all_current_ready},
            "capability_breakdown": capabilities, "skills_detail": skills,
        }


class GlobalTrackerEngine:
    """Parses known Global Tracker 2025 structures into proposed GDM current-score records."""
    @classmethod
    def parse(cls, file_bytes: bytes, filename: str = "global-tracker.xlsx") -> Dict[str, Any]:
        checksum = hashlib.sha256(file_bytes).hexdigest()
        try:
            workbook = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True, keep_vba=False)
        except Exception as exc:
            return {"status": "Blocked by file error", "errors": [f"Unreadable Excel file: {exc}"], "checksum": checksum}
        if "Global Metrics" not in workbook.sheetnames:
            return {"status": "Blocked by source mismatch", "errors": ["Missing required Global Tracker sheet: 'Global Metrics'"], "checksum": checksum}
        sheet = workbook["Global Metrics"]
        headers = {str(sheet.cell(3, col).value or "").strip(): col for col in range(1, sheet.max_column + 1)}
        missing = [x for x in GLOBAL_METRICS_MAPPING if x.strip() not in headers]
        if missing:
            return {"status": "Blocked by source mismatch", "errors": [f"Missing Global Metrics header: {x}" for x in missing], "checksum": checksum}

        proposals: List[Dict[str, Any]] = []
        unmatched_rows: List[Dict[str, Any]] = []
        for row in range(4, sheet.max_row + 1):
            country = sheet.cell(row, 3).value
            business_unit = sheet.cell(row, 2).value
            region = sheet.cell(row, 1).value
            if not country or not business_unit:
                continue
            record_proposals = 0
            for source_header, rule in GLOBAL_METRICS_MAPPING.items():
                raw = sheet.cell(row, headers[source_header.strip()]).value
                if raw is None or str(raw).strip() == "":
                    continue
                if rule["mode"] == "direct":
                    score = numeric_score(raw)
                    state = "proposed" if score is not None else "invalid_metric"
                else:
                    score, state = semrush_health_to_proposed_score(raw)
                item = {
                    "country_key": normalise_country(country), "country_raw": country, "business_unit_key": normalise_bu(business_unit),
                    "business_unit_raw": business_unit, "region_raw": region, "questionnaire_row": rule["row"],
                    "raw_metric": raw, "proposed_current_score": score, "proposal_status": state,
                    "source_system": rule["source"], "source_file": filename, "source_sheet": "Global Metrics", "source_row": row,
                    "checksum": checksum,
                }
                proposals.append(item)
                record_proposals += 1
            if not record_proposals:
                unmatched_rows.append({"source_row": row, "country": country, "business_unit": business_unit, "reason": "No usable mapped source metrics"})

        return {"status": "Ready for GDM review", "metadata": {"file_name": filename, "sha256": checksum, "source_profile": "DMMM_GLOBAL_TRACKER_2025"}, "proposals": proposals, "unmatched_rows": unmatched_rows}
