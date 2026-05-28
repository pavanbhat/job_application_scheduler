from collections import Counter
import re
from typing import Any

from .config import effective_filters, family_config
from .utils import normalize, tokenize


def extract_resume_profile(resume_text: str, config: dict[str, Any], family_key: str | None = None) -> dict[str, Any]:
    filters = effective_filters(config, family_key)
    family = family_config(config, family_key)
    text = normalize(resume_text)
    tokens = tokenize(resume_text)
    keyword_counts = Counter(tokens)

    keywords = (
        filters.get("must_have_keywords", [])
        + filters.get("nice_to_have_keywords", [])
        + [
            phrase
            for profile in config.get("company_profiles", {}).values()
            for phrase in profile.get("focus_keywords", [])
        ]
    )
    for phrase in keywords:
        lowered = normalize(phrase)
        if lowered and lowered in text:
            keyword_counts[lowered] += 3

    bullets = []
    for raw_line in resume_text.splitlines():
        line = raw_line.strip().lstrip("-*\u2022 ").strip()
        if len(line) >= 30:
            bullets.append(line)

    if not bullets:
        bullets = [segment.strip() for segment in resume_text.split(".") if len(segment.strip()) >= 30]

    return {
        "raw_text": resume_text,
        "normalized_text": text,
        "keyword_counts": keyword_counts,
        "bullets": bullets[:20],
        "candidate_name": config.get("candidate", {}).get("name", "Your Name"),
        "headline": family.get("headline") or config.get("candidate", {}).get("headline", ""),
        "resume_family": family_key,
        "resume_label": family.get("label", family_key or "Primary Resume"),
    }


def job_passes_filters(job: dict[str, Any], config: dict[str, Any]) -> bool:
    filters = config.get("filters", {})
    combined = normalize(" ".join([job.get("title", ""), job.get("description", ""), job.get("company", ""), job.get("location", "")]))

    job_type = normalize(job.get("job_type", ""))
    employment_terms = [normalize(term) for term in filters.get("employment_types", [])]
    if employment_terms and not any(term and term in job_type for term in employment_terms):
        if "full" not in combined:
            return False

    allow_locations = [normalize(loc) for loc in filters.get("allow_locations", [])]
    remote_allowed = filters.get("allow_remote", True)
    location_blob = normalize(job.get("location", ""))
    location_match = any(loc and loc in location_blob for loc in allow_locations if loc != "remote")
    remote_match = remote_allowed and "remote" in location_blob
    if allow_locations and not (location_match or remote_match):
        return False

    return not any(_contains_phrase(combined, term) for term in filters.get("exclude_keywords", []))


def score_job(
    job: dict[str, Any],
    resume_profile: dict[str, Any],
    config: dict[str, Any],
    family_key: str | None = None,
) -> dict[str, Any]:
    filters = effective_filters(config, family_key)
    company_profile = _company_profile(job, config)
    combined = normalize(" ".join([job.get("title", ""), job.get("description", ""), job.get("company", ""), job.get("location", ""), job.get("job_type", "")]))

    title_points = _title_score(job.get("title", ""), filters.get("preferred_titles", []))
    skill_points, matched, gaps = _skill_score(
        combined,
        resume_profile["keyword_counts"],
        filters.get("must_have_keywords", []),
        filters.get("nice_to_have_keywords", []),
        company_profile.get("focus_keywords", []),
    )
    location_points = 10 if ("remote" in normalize(job.get("location", "")) or _contains_allowed_location(job.get("location", ""), filters)) else 6
    seniority_points = _seniority_score(combined)
    priority_points = 5 if company_profile.get("priority", "").lower() == "high" else 0
    total = min(title_points + skill_points + location_points + seniority_points + priority_points, 100)

    return {
        **job,
        "fit_score": total,
        "matched_keywords": matched,
        "gaps": gaps,
        "company_focus": company_profile.get("focus_keywords", []),
        "company_priority": company_profile.get("priority", "normal"),
        "resume_family": family_key or resume_profile.get("resume_family") or "default",
        "resume_label": resume_profile.get("resume_label", "Primary Resume"),
        "automation_recommendation": _automation_recommendation(total, gaps),
    }


def classify_job_family(job: dict[str, Any], config: dict[str, Any], available_families: set[str]) -> str:
    default_family = config.get("resume_routing", {}).get("default_family", "swe")
    if default_family not in available_families:
        default_family = next(iter(available_families))

    title = normalize(job.get("title", ""))
    description = normalize(job.get("description", ""))
    best_family = default_family
    best_score = -1

    for family_key, family in config.get("resume_routing", {}).get("families", {}).items():
        if family_key not in available_families:
            continue
        score = 0
        for keyword in family.get("classifier_keywords", []):
            lowered = normalize(keyword)
            if lowered in title:
                score += 5
            elif lowered in description:
                score += 2
        for preferred_title in family.get("filter_overrides", {}).get("preferred_titles", []):
            lowered = normalize(preferred_title)
            if lowered in title:
                score += 4
        if score > best_score:
            best_family = family_key
            best_score = score
    return best_family


def dedupe_jobs(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str, str, str]] = set()
    deduped: list[dict[str, Any]] = []
    for row in sorted(rows, key=lambda item: (-item["fit_score"], item["company"], item["title"])):
        key = (normalize(row["company"]), normalize(row["title"]), row["url"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def _title_score(title: str, preferred_titles: list[str]) -> int:
    normalized_title = normalize(title)
    score = 0
    for preferred in preferred_titles:
        candidate = normalize(preferred)
        if candidate == normalized_title:
            score += 28
        elif candidate in normalized_title or normalized_title in candidate:
            score += 18
    if any(term in normalized_title for term in ["software engineer", "automation", "quality", "test", "developer productivity", "internal tools"]):
        score += 10
    return min(score, 35)


def _skill_score(
    job_text: str,
    resume_keywords: Counter,
    must_have_keywords: list[str],
    nice_to_have_keywords: list[str],
    company_focus_keywords: list[str],
) -> tuple[int, list[str], list[str]]:
    matched: list[str] = []
    gaps: list[str] = []
    score = 0

    for keyword in must_have_keywords:
        lowered = normalize(keyword)
        if lowered in job_text and lowered in resume_keywords:
            score += 7
            matched.append(keyword)
        elif lowered in job_text:
            gaps.append(keyword)

    for keyword in nice_to_have_keywords:
        lowered = normalize(keyword)
        if lowered in job_text and lowered in resume_keywords:
            score += 3
            matched.append(keyword)
        elif lowered in job_text:
            gaps.append(keyword)

    for keyword in company_focus_keywords:
        lowered = normalize(keyword)
        if lowered in job_text and lowered in resume_keywords:
            score += 4
            matched.append(keyword)
        elif lowered in job_text:
            gaps.append(keyword)

    return min(score, 45), sorted(set(matched)), sorted(set(gaps))


def _seniority_score(text: str) -> int:
    if "staff" in text or "principal" in text or "director" in text:
        return 2
    if "senior" in text or "sr." in text:
        return 10
    if "mid" in text or " ii " in f" {text} " or " iii " in f" {text} ":
        return 8
    if "entry" in text or "junior" in text:
        return 5
    return 7


def _contains_allowed_location(location: str, filters: dict[str, Any]) -> bool:
    normalized_location = normalize(location)
    return any(
        allowed and allowed != "remote" and allowed in normalized_location
        for allowed in [normalize(item) for item in filters.get("allow_locations", [])]
    )


def _company_profile(job: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    company_profiles = config.get("company_profiles", {})
    normalized_company = normalize(job.get("company", ""))
    for company_name, profile in company_profiles.items():
        if normalize(company_name) == normalized_company:
            return profile
    return {}


def _contains_phrase(text: str, phrase: str) -> bool:
    normalized_phrase = normalize(phrase)
    if not normalized_phrase:
        return False
    pattern = re.compile(rf"(?<![a-z0-9]){re.escape(normalized_phrase)}(?![a-z0-9])")
    return bool(pattern.search(text))


def _automation_recommendation(fit_score: int, gaps: list[str]) -> dict[str, str]:
    if fit_score >= 82 and len(gaps) <= 3:
        return {
            "lane": "ready",
            "label": "Auto-Prep Candidate",
            "reason": "Strong fit with limited gaps. Safe to queue for local Playwright prefill.",
            "next_step": "Run the local assistant in prefill mode, then review before submission.",
        }
    if fit_score >= 68:
        return {
            "lane": "review",
            "label": "Manual Review",
            "reason": "Worth pursuing, but the gaps or title fit still need a quick human check.",
            "next_step": "Review the role and tailor the top resume bullets before opening the form.",
        }
    return {
        "lane": "watch",
        "label": "Watchlist",
        "reason": "Below the high-confidence threshold for automated preparation.",
        "next_step": "Keep it visible for strategic companies, otherwise skip.",
    }
