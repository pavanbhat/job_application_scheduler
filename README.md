# Job Application Scheduler

This repo is structured as a GitHub-hosted job search service:

- a Python pipeline that pulls jobs from multiple public ATS sources
- a static dashboard under `docs/` for GitHub Pages
- a local Playwright assistant for high-fit application preparation
- a scheduled GitHub Actions workflow that refreshes the dashboard
- resume-family routing so SWE-targeted roles can use one resume and SDET-targeted roles can use another
- a tracker model with response-rate analytics
- company-specific resume tailoring and outreach draft generation

It is designed for free GitHub hosting by using:

- `GitHub Actions` for scheduled runs
- `GitHub Pages` for the UI
- browser `localStorage` for interactive tracker edits in the hosted UI
- local JSON plus SQLite tracking for Playwright assistant activity

## What it covers

- Resume-driven job scoring
- Sources beyond the starter feed:
  - Remotive
  - Greenhouse boards
  - Lever postings
  - Ashby job boards
  - selected company career pages via JSON or RSS feeds
- Company-specific tailoring:
  - recommended headline
  - top resume bullets to surface
  - rewrite suggestions
  - recruiter and hiring-manager outreach drafts
- Resume routing:
  - `Senior/Staff SWE Resume`
  - `Senior/Staff SDET Resume`
  - per-job recommendation in the dashboard and CSV export
- Local automation:
  - queue high-fit roles into an `Auto-Prep Candidate` lane
  - open and prefill application pages locally with Playwright
  - sync local assistant activity into JSON and SQLite
- Application tracker analytics:
  - applied count
  - response rate
  - positive-response rate
  - offer rate
  - source/company breakdowns

## Important limits

- This is not an auto-apply bot.
- It does not fill forms, bypass CAPTCHAs, or impersonate you.
- The GitHub Pages UI is static, so tracker edits persist in the browser that made them unless you export and commit them back into `data/tracker.json`.
- The local Playwright assistant can prefill forms and upload the routed resume, but it still stops short of final submission. Review remains required.

## Repo layout

- `scheduler.py` - CLI entrypoint
- `job_scheduler/` - fetch, score, tailor, analytics, and site-generation modules
- `docs/` - GitHub Pages dashboard
- `docs/data/` - generated JSON and CSV artifacts
- `data/tracker.json` - seed tracker data
- `data/local_tracker.template.json` - template for the local assistant tracker
- `local_tracker.py` - sync local assistant JSON into SQLite
- `playwright_assistant/` - local browser automation worker and profile template
- `.github/workflows/scheduler.yml` - scheduled refresh workflow

## Setup

```bash
cd job_application_scheduler
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Configure

1. Provide either:
   - one generic resume via `sample_resume.txt` or `JOB_SCHEDULER_RESUME_TEXT`
   - or two targeted resumes via `--resume-swe` and `--resume-sdet`
2. Edit `config.json`:
   - target roles and keywords
   - ATS source boards
   - company-specific focus profiles
   - company career feed mappings
   - `resume_routing` family labels, classifiers, and family-specific scoring overrides
3. Keep `data/tracker.json` as your committed baseline tracker if you want repo-backed history.

## Build locally

Use fixture data for an offline build:

```bash
python scheduler.py build-site --fixtures data/sample_jobs_fixture.json
```

Use live sources:

```bash
python scheduler.py build-site --resume sample_resume.txt --config config.json
```

Use separate local PDFs for SWE and SDET targeting:

```bash
python scheduler.py build-site \
  --resume-swe /Users/pbhat/Downloads/Resume_2026_SWE.pdf \
  --resume-sdet /Users/pbhat/Downloads/Resume_2026_SDET.pdf \
  --config config.json
```

The main output is:

- `docs/data/site_data.json`
- `docs/data/jobs.csv`
- `docs/index.html`

## Local assistant

Install the browser helper:

```bash
cd playwright_assistant
npm install
npm run install:browser
```

If npm registry access is unreliable on your machine, you can skip the install and use the bundled desktop runtime through:

```bash
./run_worker.sh review --lane ready --limit 3 --prefill
```

Update `playwright_assistant/profile.json` with:

- your contact information
- the SWE and SDET resume file paths
- any generic application answers you want prefilled

Run the assistant against the highest-confidence queue:

```bash
./playwright_assistant/run_worker.sh review --lane ready --limit 3 --prefill
```

Useful variants:

```bash
./playwright_assistant/run_worker.sh review --job fixture-ramp-sdet --prefill
./playwright_assistant/run_worker.sh review --lane review --limit 5
```

The assistant writes to:

- local JSON tracker: `data/local_tracker.json`
- local SQLite mirror: `data/local_tracker.sqlite3`
- screenshots: `data/assistant_artifacts/screenshots/`

You can export the local tracker JSON and import it into the hosted dashboard UI to merge local assistant activity into the visual tracker view.

## GitHub deployment

1. Push the repo to GitHub.
2. Enable GitHub Pages and point it at the `docs/` folder on the default branch.
3. Add one of these secret setups:
   - single resume: `JOB_SCHEDULER_RESUME_TEXT`
   - dual text resumes: `JOB_SCHEDULER_RESUME_SWE_TEXT` and `JOB_SCHEDULER_RESUME_SDET_TEXT`
   - dual PDFs as base64: `JOB_SCHEDULER_RESUME_SWE_PDF_BASE64` and `JOB_SCHEDULER_RESUME_SDET_PDF_BASE64`
4. Adjust the ATS sources and `resume_routing` rules in `config.json`.
5. Let the workflow in `.github/workflows/scheduler.yml` run on schedule or trigger it manually.

To create the PDF secrets from your machine:

```bash
base64 -i /Users/pbhat/Downloads/Resume_2026_SWE.pdf | pbcopy
base64 -i /Users/pbhat/Downloads/Resume_2026_SDET.pdf | pbcopy
```

Paste those values into the matching GitHub repository secrets.

## ATS source notes

The source adapters are implemented against these public board endpoints:

- Greenhouse Job Board API: `GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true`
- Lever Postings API: `GET https://api.lever.co/v0/postings/{site}?mode=json`
- Ashby Job Postings API: `GET https://api.ashbyhq.com/posting-api/job-board/{JOB_BOARD_NAME}`

For custom company career pages, the scheduler currently supports:

- JSON feeds with a configurable `jobs_path` and `field_map`
- RSS feeds

## Tracker model

`data/tracker.json` stores entries like:

```json
{
  "job_id": "abc123",
  "company": "Stripe",
  "title": "Developer Productivity Engineer",
  "source": "Stripe",
  "status": "applied",
  "applied_at": "2026-04-20",
  "last_contact_at": "2026-04-23",
  "notes": "Sent recruiter note on LinkedIn"
}
```

Suggested statuses:

- `new`
- `saved`
- `applied`
- `replied`
- `interviewing`
- `rejected`
- `offer`
- `hidden`

## Privacy note

If you publish this repo publicly, the generated dashboard data will also be public. Do not commit private resume text, raw PDF files, or outreach content unless you are comfortable exposing them.
