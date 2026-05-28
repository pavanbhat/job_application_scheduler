import hashlib
import html
import re
from typing import Any


def normalize(text: str) -> str:
    text = html.unescape(text or "")
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip().lower()


def strip_html(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html.unescape(text or ""))).strip()


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z0-9\+#\.\-/]+", normalize(text))


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", normalize(text)).strip("-")


def stable_id(*parts: str) -> str:
    material = "||".join(part or "" for part in parts)
    return hashlib.sha1(material.encode("utf-8")).hexdigest()[:16]


def dot_get(value: Any, path: str, default: Any = "") -> Any:
    current = value
    for part in path.split("."):
        if current is None:
            return default
        if isinstance(current, dict):
            current = current.get(part, default)
            continue
        if isinstance(current, list):
            try:
                current = current[int(part)]
            except (ValueError, IndexError):
                return default
            continue
        return default
    return current


def compact_text(text: str, limit: int = 260) -> str:
    cleaned = strip_html(text)
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1].rstrip() + "..."

