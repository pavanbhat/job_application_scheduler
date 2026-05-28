import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_TRACKER = {"applications": [], "updated_at": None}


def load_tracker(path: Path) -> dict[str, Any]:
    if not path.exists():
        return DEFAULT_TRACKER.copy()
    return json.loads(path.read_text(encoding="utf-8"))


def merge_tracker(jobs: list[dict[str, Any]], tracker: dict[str, Any]) -> list[dict[str, Any]]:
    applications = {item["job_id"]: item for item in tracker.get("applications", []) if item.get("job_id")}
    enriched = []
    for job in jobs:
        tracker_entry = applications.get(job["job_id"], {})
        enriched.append(
            {
                **job,
                "tracker_status": tracker_entry.get("status", "new"),
                "tracker_notes": tracker_entry.get("notes", ""),
                "applied_at": tracker_entry.get("applied_at", ""),
                "last_contact_at": tracker_entry.get("last_contact_at", ""),
            }
        )
    return enriched


def compute_analytics(tracker: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    applications = tracker.get("applications", [])
    response_statuses = set(config.get("tracker", {}).get("response_statuses", []))
    positive_statuses = set(config.get("tracker", {}).get("positive_statuses", []))
    applied_entries = [entry for entry in applications if entry.get("status") not in {"new", "saved", "hidden"}]

    responded_entries = [entry for entry in applied_entries if entry.get("status") in response_statuses]
    positive_entries = [entry for entry in applied_entries if entry.get("status") in positive_statuses]
    offers = [entry for entry in applied_entries if entry.get("status") == "offer"]

    by_source: dict[str, dict[str, Any]] = {}
    by_company: dict[str, dict[str, Any]] = {}
    status_counts: dict[str, int] = {}

    for entry in applications:
        status = entry.get("status", "new")
        source = entry.get("source", "Unknown")
        company = entry.get("company", "Unknown")
        status_counts[status] = status_counts.get(status, 0) + 1

        source_bucket = by_source.setdefault(source, {"applications": 0, "responses": 0})
        company_bucket = by_company.setdefault(company, {"applications": 0, "responses": 0})
        if status not in {"new", "saved", "hidden"}:
            source_bucket["applications"] += 1
            company_bucket["applications"] += 1
        if status in response_statuses:
            source_bucket["responses"] += 1
            company_bucket["responses"] += 1

    for bucket in list(by_source.values()) + list(by_company.values()):
        bucket["response_rate"] = _percentage(bucket["responses"], bucket["applications"])

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "applications_tracked": len(applications),
        "applied_count": len(applied_entries),
        "response_count": len(responded_entries),
        "response_rate": _percentage(len(responded_entries), len(applied_entries)),
        "positive_response_rate": _percentage(len(positive_entries), len(applied_entries)),
        "offer_rate": _percentage(len(offers), len(applied_entries)),
        "status_counts": status_counts,
        "by_source": by_source,
        "by_company": dict(sorted(by_company.items(), key=lambda item: (-item[1]["applications"], item[0]))[:10]),
    }


def write_tracker(path: Path, tracker: dict[str, Any]) -> None:
    path.write_text(json.dumps(tracker, indent=2), encoding="utf-8")


def _percentage(numerator: int, denominator: int) -> float:
    if denominator == 0:
        return 0.0
    return round((numerator / denominator) * 100, 1)

