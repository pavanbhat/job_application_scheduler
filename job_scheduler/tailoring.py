from typing import Any

from .utils import normalize, tokenize


def build_tailoring(job: dict[str, Any], resume_profile: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    company_profile = _company_profile(job, config)
    focus_keywords = list(dict.fromkeys(job.get("matched_keywords", []) + company_profile.get("focus_keywords", [])))[:6]
    highlight_bullets = _top_resume_bullets(job, resume_profile, focus_keywords)
    headline = _tailored_headline(job, resume_profile, focus_keywords)
    rewrite_suggestions = _rewrite_suggestions(job, focus_keywords, job.get("gaps", []))
    outreach = _outreach_message(job, resume_profile, focus_keywords, company_profile)

    return {
        "headline": headline,
        "resume_highlights": highlight_bullets,
        "rewrite_suggestions": rewrite_suggestions,
        "outreach_message": outreach,
    }


def _top_resume_bullets(job: dict[str, Any], resume_profile: dict[str, Any], focus_keywords: list[str]) -> list[str]:
    keywords = set(tokenize(" ".join(focus_keywords + [job.get("title", ""), job.get("company", "")])))
    scored = []
    for bullet in resume_profile.get("bullets", []):
        bullet_tokens = set(tokenize(bullet))
        overlap = len(bullet_tokens & keywords)
        scored.append((overlap, len(bullet), bullet))
    ranked = [bullet for overlap, _, bullet in sorted(scored, key=lambda item: (-item[0], -item[1])) if overlap > 0]
    if not ranked:
        ranked = resume_profile.get("bullets", [])[:3]
    return ranked[:3]


def _tailored_headline(job: dict[str, Any], resume_profile: dict[str, Any], focus_keywords: list[str]) -> str:
    base_headline = resume_profile.get("headline") or "Software engineer"
    if not focus_keywords:
        return f"{base_headline} aligned to {job.get('company', 'the company')}"
    focus = ", ".join(focus_keywords[:3])
    return f"{base_headline} aligned to {job.get('company', 'the company')} across {focus}"


def _rewrite_suggestions(job: dict[str, Any], focus_keywords: list[str], gaps: list[str]) -> list[str]:
    suggestions = []
    if focus_keywords:
        suggestions.append(f"Move bullets that prove {', '.join(focus_keywords[:3])} into the top third of the resume.")
    suggestions.append(f"Mirror the language in the {job.get('title', 'role')} description for the first 2-3 bullet points.")
    if gaps:
        suggestions.append(f"Address the likely gap around {', '.join(gaps[:2])} in the resume summary or a cover note if you have adjacent experience.")
    return suggestions[:3]


def _outreach_message(
    job: dict[str, Any],
    resume_profile: dict[str, Any],
    focus_keywords: list[str],
    company_profile: dict[str, Any],
) -> dict[str, str]:
    candidate_name = resume_profile.get("candidate_name", "Your Name")
    focus = ", ".join(focus_keywords[:3]) if focus_keywords else "internal tooling and execution"
    hook = company_profile.get("outreach_hook") or "the work looks tightly aligned with my background"

    recruiter = (
        f"Hi there,\n\n"
        f"I applied for the {job.get('title', '')} role at {job.get('company', '')}. "
        f"{hook.capitalize()}, especially around {focus}. "
        f"My background is strongest in building reliable engineering systems and improving delivery speed.\n\n"
        f"If the team is actively reviewing candidates, I'd appreciate a quick conversation.\n\n"
        f"Best,\n{candidate_name}"
    )

    hiring_manager = (
        f"Hi,\n\n"
        f"I wanted to reach out directly about the {job.get('title', '')} opening. "
        f"I've spent most of my recent work on systems related to {focus}, which seems relevant to the team's current needs.\n\n"
        f"I'd be glad to share a concise summary of the projects most relevant to this role.\n\n"
        f"Thanks,\n{candidate_name}"
    )

    return {"recruiter": recruiter, "hiring_manager": hiring_manager}


def _company_profile(job: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    normalized_company = normalize(job.get("company", ""))
    for company_name, profile in config.get("company_profiles", {}).items():
        if normalize(company_name) == normalized_company:
            return profile
    return {}
