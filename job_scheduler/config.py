import json
from copy import deepcopy
from pathlib import Path
from typing import Any


DEFAULT_CONFIG: dict[str, Any] = {
    "candidate": {
        "name": "Your Name",
        "target_locations": ["Remote", "Massachusetts", "Boston", "Cambridge"],
        "headline": "Software engineer focused on internal tools, developer productivity, and test automation",
    },
    "resume_routing": {
        "default_family": "swe",
        "families": {
            "swe": {
                "label": "Senior/Staff SWE Resume",
                "headline": "Senior software engineer focused on developer platforms, backend systems, and engineering productivity",
                "classifier_keywords": [
                    "staff software engineer",
                    "senior software engineer",
                    "software engineer",
                    "backend engineer",
                    "platform engineer",
                    "distributed systems",
                    "developer productivity",
                    "internal tools",
                ],
                "filter_overrides": {
                    "preferred_titles": [
                        "Staff Software Engineer",
                        "Senior Software Engineer",
                        "Software Engineer",
                        "Backend Engineer",
                        "Platform Engineer",
                        "Developer Productivity Engineer",
                        "Infrastructure Engineer",
                        "Internal Tools Engineer",
                    ],
                    "must_have_keywords": [
                        "python",
                        "java",
                        "javascript",
                        "typescript",
                        "developer productivity",
                        "internal tools",
                        "platform",
                        "backend",
                        "reliability",
                        "distributed systems",
                    ],
                    "nice_to_have_keywords": [
                        "ci/cd",
                        "aws",
                        "framework",
                        "tooling",
                        "observability",
                        "scalability",
                        "roadmap",
                        "adoption",
                    ],
                },
            },
            "sdet": {
                "label": "Senior/Staff SDET Resume",
                "headline": "Senior software engineer in test focused on UI automation, framework design, and release confidence",
                "classifier_keywords": [
                    "staff sdet",
                    "senior sdet",
                    "software engineer in test",
                    "test automation engineer",
                    "qa automation engineer",
                    "quality engineer",
                    "playwright",
                    "selenium",
                    "ui automation",
                    "quality",
                ],
                "filter_overrides": {
                    "preferred_titles": [
                        "Staff Software Engineer in Test",
                        "Senior Software Engineer in Test",
                        "Staff SDET",
                        "Senior SDET",
                        "Software Development Engineer in Test",
                        "SDET",
                        "Test Automation Engineer",
                        "QA Automation Engineer",
                    ],
                    "must_have_keywords": [
                        "playwright",
                        "selenium",
                        "test automation",
                        "ui testing",
                        "quality",
                        "automation",
                        "api testing",
                        "ci/cd",
                        "framework",
                        "release confidence",
                    ],
                    "nice_to_have_keywords": [
                        "developer productivity",
                        "internal tools",
                        "pytest",
                        "observability",
                        "reliability",
                        "record & replay",
                        "regression",
                    ],
                },
            },
        },
    },
    "filters": {
        "allow_remote": True,
        "allow_locations": ["Remote", "Massachusetts", "MA", "Boston", "Cambridge", "Waltham", "Framingham"],
        "employment_types": ["full_time", "full-time", "full time", "fulltime"],
        "preferred_titles": [
            "Software Engineer",
            "Senior Software Engineer",
            "Developer Productivity Engineer",
            "Software Development Engineer in Test",
            "SDET",
            "Test Automation Engineer",
            "QA Automation Engineer",
            "Infrastructure Engineer",
            "Internal Tools Engineer",
        ],
        "must_have_keywords": [
            "java",
            "javascript",
            "selenium",
            "test automation",
            "developer productivity",
            "ui testing",
            "web",
            "quality",
            "automation",
            "internal tools",
        ],
        "nice_to_have_keywords": [
            "playwright",
            "cypress",
            "ci/cd",
            "pytest",
            "api testing",
            "aws",
            "typescript",
            "framework",
            "tooling",
            "observability",
        ],
        "exclude_keywords": [
            "intern",
            "sales",
            "account executive",
            "nurse",
            "therapist",
            "contractor only",
            "part-time",
        ],
        "min_fit_score": 55,
        "daily_limit": 40,
    },
    "sources": {
        "remotive": {"enabled": True},
        "greenhouse": [],
        "lever": [],
        "ashby": [],
        "company_pages": [],
    },
    "company_profiles": {},
    "tracker": {
        "response_statuses": ["replied", "interviewing", "offer", "rejected"],
        "positive_statuses": ["interviewing", "offer"],
    },
}


def _deep_merge(base: Any, overrides: Any) -> Any:
    if isinstance(base, dict) and isinstance(overrides, dict):
        merged = deepcopy(base)
        for key, value in overrides.items():
            merged[key] = _deep_merge(merged.get(key), value)
        return merged
    return deepcopy(overrides)


def load_config(path: Path) -> dict[str, Any]:
    config = deepcopy(DEFAULT_CONFIG)
    if not path.exists():
        return config
    user_config = json.loads(path.read_text(encoding="utf-8"))
    return _deep_merge(config, user_config)


def family_config(config: dict[str, Any], family_key: str | None) -> dict[str, Any]:
    if not family_key:
        return {}
    return config.get("resume_routing", {}).get("families", {}).get(family_key, {})


def effective_filters(config: dict[str, Any], family_key: str | None = None) -> dict[str, Any]:
    filters = deepcopy(config.get("filters", {}))
    overrides = family_config(config, family_key).get("filter_overrides", {})
    return _deep_merge(filters, overrides)
