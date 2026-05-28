import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def write_site(
    *,
    output_dir: Path,
    jobs: list[dict[str, Any]],
    tracker: dict[str, Any],
    analytics: dict[str, Any],
    errors: list[str],
    config: dict[str, Any],
    csv_path: Path | None = None,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    public_jobs = [_public_job(job) for job in jobs]
    public_tracker = _public_tracker(tracker)

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "candidate": config.get("candidate", {}),
        "filters": config.get("filters", {}),
        "jobs": public_jobs,
        "tracker": public_tracker,
        "analytics": analytics,
        "errors": errors,
    }

    (output_dir / "site_data.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    (output_dir / "jobs.json").write_text(json.dumps(public_jobs, indent=2), encoding="utf-8")
    (output_dir / "tracker.json").write_text(json.dumps(public_tracker, indent=2), encoding="utf-8")
    (output_dir / "analytics.json").write_text(json.dumps(analytics, indent=2), encoding="utf-8")

    if csv_path:
        write_csv(jobs, csv_path)

    return payload


def _public_job(job: dict[str, Any]) -> dict[str, Any]:
    sanitized = dict(job)
    sanitized.pop("tracker_notes", None)
    sanitized.pop("last_contact_at", None)
    sanitized.pop("applied_at", None)
    return sanitized


def _public_tracker(tracker: dict[str, Any]) -> dict[str, Any]:
    applications = []
    for item in tracker.get("applications", []):
        applications.append(
            {
                "job_id": item.get("job_id", ""),
                "company": item.get("company", ""),
                "title": item.get("title", ""),
                "source": item.get("source", ""),
                "status": item.get("status", "new"),
                "resume_family": item.get("resume_family", ""),
                "updated_at": item.get("updated_at", ""),
            }
        )
    return {"applications": applications, "updated_at": tracker.get("updated_at")}


def write_csv(rows: list[dict[str, Any]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "job_id",
        "company",
        "title",
        "resume_family",
        "resume_family_label",
        "location",
        "job_type",
        "publication_date",
        "fit_score",
        "matched_keywords",
        "gaps",
        "source",
        "source_type",
        "tracker_status",
        "url",
    ]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "job_id": row.get("job_id", ""),
                    "company": row.get("company", ""),
                    "title": row.get("title", ""),
                    "resume_family": row.get("resume_family", ""),
                    "resume_family_label": row.get("resume_family_label", row.get("resume_label", "")),
                    "location": row.get("location", ""),
                    "job_type": row.get("job_type", ""),
                    "publication_date": row.get("publication_date", ""),
                    "fit_score": row.get("fit_score", ""),
                    "matched_keywords": ", ".join(row.get("matched_keywords", [])),
                    "gaps": ", ".join(row.get("gaps", [])),
                    "source": row.get("source", ""),
                    "source_type": row.get("source_type", ""),
                    "tracker_status": row.get("tracker_status", ""),
                    "url": row.get("url", ""),
                }
            )
