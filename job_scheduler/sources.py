import json
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import requests

from .utils import compact_text, dot_get, stable_id, strip_html

REMOTIVE_API = "https://remotive.com/api/remote-jobs"


def _session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": "job-application-scheduler/1.0"})
    return session


def _normalize_job(
    *,
    source: str,
    source_type: str,
    company: str,
    title: str,
    url: str,
    description: str,
    location: str = "",
    job_type: str = "",
    publication_date: str = "",
    external_id: str = "",
) -> dict[str, Any]:
    return {
        "job_id": stable_id(source_type, external_id or url or f"{company}:{title}"),
        "company": company or "Unknown company",
        "title": title or "Untitled role",
        "location": location or "Unspecified",
        "job_type": job_type or "",
        "publication_date": publication_date or "",
        "url": url or "",
        "description": description or "",
        "summary": compact_text(description),
        "source": source,
        "source_type": source_type,
    }


def load_fixture_jobs(path: Path) -> list[dict[str, Any]]:
    jobs = json.loads(path.read_text(encoding="utf-8"))
    return jobs if isinstance(jobs, list) else jobs.get("jobs", [])


def fetch_all_jobs(config: dict[str, Any], fixture_path: Path | None = None) -> tuple[list[dict[str, Any]], list[str]]:
    if fixture_path:
        return load_fixture_jobs(fixture_path), []

    jobs: list[dict[str, Any]] = []
    errors: list[str] = []
    session = _session()

    source_config = config.get("sources", {})

    if source_config.get("remotive", {}).get("enabled", True):
        try:
            jobs.extend(fetch_remotive(session))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"Remotive fetch failed: {exc}")

    for board in source_config.get("greenhouse", []):
        try:
            jobs.extend(fetch_greenhouse(session, board))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"Greenhouse {board.get('board_token', 'unknown')} failed: {exc}")

    for board in source_config.get("lever", []):
        try:
            jobs.extend(fetch_lever(session, board))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"Lever {board.get('site', 'unknown')} failed: {exc}")

    for board in source_config.get("ashby", []):
        try:
            jobs.extend(fetch_ashby(session, board))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"Ashby {board.get('board', 'unknown')} failed: {exc}")

    for page in source_config.get("company_pages", []):
        try:
            jobs.extend(fetch_company_page(session, page))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"Company page {page.get('company', page.get('url', 'unknown'))} failed: {exc}")

    return jobs, errors


def fetch_remotive(session: requests.Session) -> list[dict[str, Any]]:
    response = session.get(REMOTIVE_API, timeout=30)
    response.raise_for_status()
    data = response.json()
    jobs: list[dict[str, Any]] = []
    for item in data.get("jobs", []):
        jobs.append(
            _normalize_job(
                source="Remotive",
                source_type="remotive",
                company=item.get("company_name", ""),
                title=item.get("title", ""),
                url=item.get("url", ""),
                description=item.get("description", ""),
                location=item.get("candidate_required_location") or item.get("location", ""),
                job_type=item.get("job_type", ""),
                publication_date=item.get("publication_date", ""),
                external_id=str(item.get("id", "")),
            )
        )
    return jobs


def fetch_greenhouse(session: requests.Session, board: dict[str, Any]) -> list[dict[str, Any]]:
    token = board["board_token"]
    url = f"https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true"
    response = session.get(url, timeout=30)
    response.raise_for_status()
    payload = response.json()
    jobs: list[dict[str, Any]] = []
    for item in payload.get("jobs", []):
        offices = ", ".join(office.get("location", "") for office in item.get("offices", []) if office.get("location"))
        location = item.get("location", {}).get("name") or offices
        jobs.append(
            _normalize_job(
                source=board.get("label") or board.get("company") or token,
                source_type="greenhouse",
                company=board.get("company") or board.get("label") or token,
                title=item.get("title", ""),
                url=item.get("absolute_url", ""),
                description=item.get("content", ""),
                location=location,
                job_type=_greenhouse_job_type(item),
                publication_date=item.get("updated_at", ""),
                external_id=str(item.get("id", "")),
            )
        )
    return jobs


def _greenhouse_job_type(item: dict[str, Any]) -> str:
    metadata = item.get("metadata")
    if isinstance(metadata, list):
        for entry in metadata:
            name = str(entry.get("name", "")).lower()
            if "employment" in name or "type" in name:
                value = entry.get("value")
                if isinstance(value, dict):
                    return str(value.get("name", ""))
                return str(value or "")
    if isinstance(metadata, dict):
        for key, value in metadata.items():
            if "employment" in key.lower() or "type" in key.lower():
                return str(value)
    return ""


def fetch_lever(session: requests.Session, board: dict[str, Any]) -> list[dict[str, Any]]:
    site = board["site"]
    url = f"https://api.lever.co/v0/postings/{site}?mode=json"
    response = session.get(url, timeout=30)
    response.raise_for_status()
    payload = response.json()
    jobs: list[dict[str, Any]] = []
    for item in payload:
        categories = item.get("categories", {}) or {}
        jobs.append(
            _normalize_job(
                source=board.get("label") or board.get("company") or site,
                source_type="lever",
                company=board.get("company") or board.get("label") or site,
                title=item.get("text", ""),
                url=item.get("hostedUrl") or item.get("applyUrl") or "",
                description=item.get("descriptionPlain") or item.get("description") or "",
                location=categories.get("location") or item.get("categories", {}).get("allLocations", ""),
                job_type=categories.get("commitment", ""),
                publication_date=str(item.get("createdAt", "")),
                external_id=str(item.get("id", "")),
            )
        )
    return jobs


def fetch_ashby(session: requests.Session, board: dict[str, Any]) -> list[dict[str, Any]]:
    name = board["board"]
    url = f"https://api.ashbyhq.com/posting-api/job-board/{name}"
    response = session.get(url, timeout=30)
    response.raise_for_status()
    payload = response.json()
    jobs: list[dict[str, Any]] = []
    for item in payload.get("jobs", []):
        jobs.append(
            _normalize_job(
                source=board.get("label") or board.get("company") or name,
                source_type="ashby",
                company=board.get("company") or board.get("label") or name,
                title=item.get("title", ""),
                url=item.get("jobUrl") or item.get("applyUrl") or "",
                description=item.get("descriptionPlain") or item.get("descriptionHtml") or "",
                location=item.get("location", ""),
                job_type=item.get("employmentType", ""),
                publication_date=item.get("publishedAt", ""),
                external_id=item.get("jobUrl") or item.get("applyUrl") or item.get("title", ""),
            )
        )
    return jobs


def fetch_company_page(session: requests.Session, page: dict[str, Any]) -> list[dict[str, Any]]:
    kind = page.get("kind", "json")
    if kind == "rss":
        return _fetch_rss_page(session, page)
    if kind == "json":
        return _fetch_json_page(session, page)
    raise ValueError(f"Unsupported company page kind: {kind}")


def _fetch_json_page(session: requests.Session, page: dict[str, Any]) -> list[dict[str, Any]]:
    response = session.get(page["url"], timeout=30)
    response.raise_for_status()
    payload = response.json()
    items = dot_get(payload, page.get("jobs_path", "jobs"), [])
    field_map = page.get("field_map", {})
    jobs: list[dict[str, Any]] = []
    for item in items:
        description = dot_get(item, field_map.get("description", ""), "")
        jobs.append(
            _normalize_job(
                source=page.get("label") or page.get("company", "Company page"),
                source_type="company-page",
                company=page.get("company", "Unknown company"),
                title=str(dot_get(item, field_map.get("title", ""), "")),
                url=str(dot_get(item, field_map.get("url", ""), "")),
                description=str(description),
                location=str(dot_get(item, field_map.get("location", ""), "")),
                job_type=str(dot_get(item, field_map.get("job_type", ""), "")),
                publication_date=str(dot_get(item, field_map.get("publication_date", ""), "")),
                external_id=str(dot_get(item, field_map.get("id", ""), "")),
            )
        )
    return jobs


def _fetch_rss_page(session: requests.Session, page: dict[str, Any]) -> list[dict[str, Any]]:
    response = session.get(page["url"], timeout=30)
    response.raise_for_status()
    root = ET.fromstring(response.text)
    jobs: list[dict[str, Any]] = []
    for item in root.findall(".//item"):
        description = strip_html(item.findtext("description", default=""))
        jobs.append(
            _normalize_job(
                source=page.get("label") or page.get("company", "Company page"),
                source_type="company-page",
                company=page.get("company", "Unknown company"),
                title=item.findtext("title", default=""),
                url=item.findtext("link", default=""),
                description=description,
                publication_date=item.findtext("pubDate", default=""),
                external_id=item.findtext("guid", default=""),
            )
        )
    return jobs

