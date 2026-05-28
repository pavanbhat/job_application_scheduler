import argparse
import os
from pathlib import Path

from job_scheduler.config import load_config
from job_scheduler.pipeline import build_dashboard
from job_scheduler.resumes import load_resume_text


def _env_resume_text(name: str) -> str:
    return os.getenv(name, "").strip()


def _resolve_resume(path_value: str | None, base_dir: Path) -> Path | None:
    if not path_value:
        return None
    path = Path(path_value)
    if not path.is_absolute():
        path = base_dir / path
    return path


def _resume_text(resume_path: Path | None, env_var: str | None = None) -> str:
    if env_var:
        env_resume = _env_resume_text(env_var)
        if env_resume:
            return env_resume
    env_resume = os.getenv("JOB_SCHEDULER_RESUME_TEXT", "").strip()
    if env_resume:
        return env_resume
    if resume_path and resume_path.exists():
        return load_resume_text(resume_path)
    return ""


def _resume_texts(args: argparse.Namespace, base_dir: Path, config: dict) -> dict[str, str]:
    families = config.get("resume_routing", {}).get("families", {})
    default_family = config.get("resume_routing", {}).get("default_family", "swe")
    texts: dict[str, str] = {}
    has_family_specific_input = any(
        [
            getattr(args, "resume_swe", None),
            getattr(args, "resume_sdet", None),
            _env_resume_text("JOB_SCHEDULER_RESUME_SWE_TEXT"),
            _env_resume_text("JOB_SCHEDULER_RESUME_SDET_TEXT"),
        ]
    )

    generic_resume = ""
    if args.resume != "sample_resume.txt" or not has_family_specific_input:
        generic_resume = _resume_text(_resolve_resume(args.resume, base_dir), None)
    if generic_resume:
        texts[default_family] = generic_resume

    family_args = {
        "swe": ("resume_swe", "JOB_SCHEDULER_RESUME_SWE_TEXT"),
        "sdet": ("resume_sdet", "JOB_SCHEDULER_RESUME_SDET_TEXT"),
    }
    for family_key in families:
        arg_name, env_name = family_args.get(family_key, (None, None))
        path_value = getattr(args, arg_name, None) if arg_name else None
        family_text = _resume_text(_resolve_resume(path_value, base_dir), env_name)
        if family_text:
            texts[family_key] = family_text

    if not texts:
        raise FileNotFoundError(
            "Provide --resume, --resume-swe/--resume-sdet, or set JOB_SCHEDULER_RESUME_TEXT / JOB_SCHEDULER_RESUME_SWE_TEXT / JOB_SCHEDULER_RESUME_SDET_TEXT."
        )
    if len(texts) == 1 and default_family not in texts:
        only_key = next(iter(texts))
        texts[default_family] = texts[only_key]
    return texts


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the GitHub Pages job scheduler dashboard.")
    subparsers = parser.add_subparsers(dest="command")

    build_parser = subparsers.add_parser("build-site", help="Build docs/data JSON and CSV artifacts.")
    build_parser.add_argument("--resume", default="sample_resume.txt", help="Path to resume text file.")
    build_parser.add_argument("--resume-swe", default=None, help="Path to the SWE-targeted resume file (text or PDF).")
    build_parser.add_argument("--resume-sdet", default=None, help="Path to the SDET-targeted resume file (text or PDF).")
    build_parser.add_argument("--config", default="config.json", help="Path to config file.")
    build_parser.add_argument("--output-dir", default="docs/data", help="Output data directory.")
    build_parser.add_argument("--tracker", default="data/tracker.json", help="Path to tracker JSON.")
    build_parser.add_argument("--csv", default="docs/data/jobs.csv", help="Path to CSV export.")
    build_parser.add_argument("--fixtures", default=None, help="Optional fixture JSON path for offline runs.")

    args = parser.parse_args()
    command = args.command or "build-site"
    if command != "build-site":
        raise ValueError(f"Unsupported command: {command}")

    base_dir = Path(__file__).resolve().parent
    resume_path = Path(args.resume)
    if not resume_path.is_absolute():
        resume_path = base_dir / resume_path

    config_path = Path(args.config)
    if not config_path.is_absolute():
        config_path = base_dir / config_path

    output_dir = Path(args.output_dir)
    if not output_dir.is_absolute():
        output_dir = base_dir / output_dir

    tracker_path = Path(args.tracker)
    if not tracker_path.is_absolute():
        tracker_path = base_dir / tracker_path

    csv_path = Path(args.csv)
    if not csv_path.is_absolute():
        csv_path = base_dir / csv_path

    fixture_path = Path(args.fixtures).resolve() if args.fixtures else None
    config = load_config(config_path)
    resume_texts = _resume_texts(args, base_dir, config)
    tracker_path.parent.mkdir(parents=True, exist_ok=True)
    if not tracker_path.exists():
        tracker_path.write_text('{"applications": [], "updated_at": null}\n', encoding="utf-8")

    payload = build_dashboard(
        resume_texts=resume_texts,
        config=config,
        output_dir=output_dir,
        tracker_path=tracker_path,
        csv_path=csv_path,
        fixture_path=fixture_path,
    )

    print(f"Built dashboard with {len(payload['jobs'])} jobs into {output_dir}")
    for job in payload["jobs"][:10]:
        print(f"[{job['fit_score']:>3}] {job['company']} | {job['title']} | {job['source']}")


if __name__ == "__main__":
    main()
