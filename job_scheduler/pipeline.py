from pathlib import Path
from typing import Any

from .config import family_config
from .scoring import classify_job_family, dedupe_jobs, extract_resume_profile, job_passes_filters, score_job
from .site import write_site
from .sources import fetch_all_jobs
from .tailoring import build_tailoring
from .tracker import compute_analytics, load_tracker, merge_tracker


def build_dashboard(
    *,
    resume_texts: dict[str, str],
    config: dict[str, Any],
    output_dir: Path,
    tracker_path: Path,
    csv_path: Path | None = None,
    fixture_path: Path | None = None,
) -> dict[str, Any]:
    resume_profiles = {
        family_key: extract_resume_profile(text, config, family_key)
        for family_key, text in resume_texts.items()
        if text.strip()
    }
    if not resume_profiles:
        raise ValueError("At least one resume text must be provided.")

    raw_jobs, errors = fetch_all_jobs(config, fixture_path=fixture_path)

    shortlisted = []
    available_families = set(resume_profiles)
    for job in raw_jobs:
        if not job_passes_filters(job, config):
            continue
        family_key = classify_job_family(job, config, available_families)
        resume_profile = resume_profiles[family_key]
        scored = score_job(job, resume_profile, config, family_key=family_key)
        if scored["fit_score"] < config.get("filters", {}).get("min_fit_score", 55):
            continue
        scored["resume_family_label"] = family_config(config, family_key).get("label", family_key)
        scored["tailoring"] = build_tailoring(scored, resume_profile, config)
        shortlisted.append(scored)

    ranked = dedupe_jobs(shortlisted)[: config.get("filters", {}).get("daily_limit", 40)]
    tracker = load_tracker(tracker_path)
    merged_jobs = merge_tracker(ranked, tracker)
    analytics = compute_analytics(tracker, config)

    return write_site(
        output_dir=output_dir,
        jobs=merged_jobs,
        tracker=tracker,
        analytics=analytics,
        errors=errors,
        config=config,
        csv_path=csv_path,
    )
