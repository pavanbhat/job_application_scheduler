import argparse
import json
import sqlite3
from pathlib import Path


def load_local_tracker(path: Path) -> dict:
    if not path.exists():
        return {"applications": [], "sessions": []}
    return json.loads(path.read_text(encoding="utf-8"))


def ensure_database(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS applications (
                job_id TEXT PRIMARY KEY,
                company TEXT,
                title TEXT,
                source TEXT,
                status TEXT,
                applied_at TEXT,
                last_contact_at TEXT,
                notes TEXT,
                updated_at TEXT,
                resume_family TEXT,
                job_url TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                job_id TEXT,
                mode TEXT,
                result TEXT,
                screenshot_path TEXT,
                started_at TEXT,
                completed_at TEXT,
                notes TEXT
            )
            """
        )
        conn.commit()


def sync_local_tracker(json_path: Path, db_path: Path) -> None:
    tracker = load_local_tracker(json_path)
    ensure_database(db_path)

    with sqlite3.connect(db_path) as conn:
        for item in tracker.get("applications", []):
            conn.execute(
                """
                INSERT INTO applications (
                    job_id, company, title, source, status, applied_at,
                    last_contact_at, notes, updated_at, resume_family, job_url
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(job_id) DO UPDATE SET
                    company=excluded.company,
                    title=excluded.title,
                    source=excluded.source,
                    status=excluded.status,
                    applied_at=excluded.applied_at,
                    last_contact_at=excluded.last_contact_at,
                    notes=excluded.notes,
                    updated_at=excluded.updated_at,
                    resume_family=excluded.resume_family,
                    job_url=excluded.job_url
                """,
                (
                    item.get("job_id", ""),
                    item.get("company", ""),
                    item.get("title", ""),
                    item.get("source", ""),
                    item.get("status", ""),
                    item.get("applied_at", ""),
                    item.get("last_contact_at", ""),
                    item.get("notes", ""),
                    item.get("updated_at", ""),
                    item.get("resume_family", ""),
                    item.get("job_url", ""),
                ),
            )
        for item in tracker.get("sessions", []):
            conn.execute(
                """
                INSERT INTO sessions (
                    session_id, job_id, mode, result, screenshot_path,
                    started_at, completed_at, notes
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    job_id=excluded.job_id,
                    mode=excluded.mode,
                    result=excluded.result,
                    screenshot_path=excluded.screenshot_path,
                    started_at=excluded.started_at,
                    completed_at=excluded.completed_at,
                    notes=excluded.notes
                """,
                (
                    item.get("session_id", ""),
                    item.get("job_id", ""),
                    item.get("mode", ""),
                    item.get("result", ""),
                    item.get("screenshot_path", ""),
                    item.get("started_at", ""),
                    item.get("completed_at", ""),
                    item.get("notes", ""),
                ),
            )
        conn.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync the local Playwright tracker JSON into SQLite.")
    parser.add_argument("--json", default="data/local_tracker.json", help="Path to the local tracker JSON file.")
    parser.add_argument("--db", default="data/local_tracker.sqlite3", help="Path to the SQLite database.")
    args = parser.parse_args()

    json_path = Path(args.json).resolve()
    db_path = Path(args.db).resolve()
    sync_local_tracker(json_path, db_path)
    print(f"Synchronized {json_path} into {db_path}")


if __name__ == "__main__":
    main()
