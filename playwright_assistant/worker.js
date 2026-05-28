const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const jobsPath = path.join(rootDir, "docs", "data", "jobs.json");
const trackerPath = path.join(rootDir, "data", "local_tracker.json");
const trackerTemplatePath = path.join(rootDir, "data", "local_tracker.template.json");
const sqlitePath = path.join(rootDir, "data", "local_tracker.sqlite3");
const screenshotsDir = path.join(rootDir, "data", "assistant_artifacts", "screenshots");
const profilePath = path.join(__dirname, "profile.json");
const profileExamplePath = path.join(__dirname, "profile.example.json");
const userDataDir = path.join(__dirname, ".playwright-profile");
const bundledPlaywrightPath = "/Users/pbhat/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jobs = readJson(jobsPath);
  const tracker = ensureLocalTracker();
  const profile = ensureProfile();
  const selectedJobs = selectJobs(jobs, tracker, args);

  if (!selectedJobs.length) {
    console.log("No jobs matched the requested assistant filters.");
    return;
  }

  fs.mkdirSync(screenshotsDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: args.headless,
    viewport: { width: 1440, height: 1024 },
  });

  for (const job of selectedJobs) {
    const page = await context.newPage();
    const startedAt = new Date().toISOString();
    const sessionId = `${job.job_id}-${Date.now()}`;
    const screenshotBase = path.join(screenshotsDir, `${job.job_id}-${Date.now()}`);

    try {
      await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(1200);
      const beforeShot = `${screenshotBase}-before.png`;
      await page.screenshot({ path: beforeShot, fullPage: true });

      let result = "opened";
      let notes = "Opened role in local assistant.";
      if (args.prefill) {
        const fillResult = await prefillBySource(page, profile, job);
        result = fillResult.result;
        notes = fillResult.notes;
        const afterShot = `${screenshotBase}-after.png`;
        await page.screenshot({ path: afterShot, fullPage: true });
      }

      upsertTrackerApplication(tracker, job, {
        status: trackerStatusAfterRun(args.prefill),
        notes,
        updated_at: new Date().toISOString(),
      });
      tracker.sessions.push({
        session_id: sessionId,
        job_id: job.job_id,
        mode: args.prefill ? "prefill" : "review",
        result,
        screenshot_path: `${screenshotBase}${args.prefill ? "-after.png" : "-before.png"}`,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        notes,
      });

      console.log(`[assistant] ${job.company} | ${job.title} | ${result}`);
    } catch (error) {
      upsertTrackerApplication(tracker, job, {
        status: "saved",
        notes: `Assistant error: ${error.message}`,
        updated_at: new Date().toISOString(),
      });
      tracker.sessions.push({
        session_id: sessionId,
        job_id: job.job_id,
        mode: args.prefill ? "prefill" : "review",
        result: "error",
        screenshot_path: "",
        started_at: startedAt,
        completed_at: new Date().toISOString(),
        notes: error.message,
      });
      console.error(`[assistant] ${job.company} | ${job.title} | error: ${error.message}`);
    } finally {
      await page.close();
    }
  }

  await context.close();
  writeJson(trackerPath, tracker);
  syncLocalTrackerToSqlite();
}

function parseArgs(argv) {
  const args = {
    command: argv[0] || "review",
    jobId: null,
    limit: 3,
    lane: "ready",
    prefill: argv.includes("--prefill"),
    headless: argv.includes("--headless"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--job" && argv[index + 1]) {
      args.jobId = argv[index + 1];
    }
    if (value === "--limit" && argv[index + 1]) {
      args.limit = Number.parseInt(argv[index + 1], 10) || 3;
    }
    if (value === "--lane" && argv[index + 1]) {
      args.lane = argv[index + 1];
    }
  }
  return args;
}

function ensureLocalTracker() {
  if (!fs.existsSync(trackerPath)) {
    fs.copyFileSync(trackerTemplatePath, trackerPath);
  }
  const tracker = readJson(trackerPath);
  tracker.applications = tracker.applications || [];
  tracker.sessions = tracker.sessions || [];
  return tracker;
}

function ensureProfile() {
  if (!fs.existsSync(profilePath)) {
    fs.copyFileSync(profileExamplePath, profilePath);
  }
  return readJson(profilePath);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function selectJobs(jobs, tracker, args) {
  const applications = new Map((tracker.applications || []).map((item) => [item.job_id, item]));
  const augmented = jobs.map((job) => ({
    ...job,
    tracker_status: applications.get(job.job_id)?.status || job.tracker_status || "new",
  }));

  if (args.jobId) {
    return augmented.filter((job) => job.job_id === args.jobId);
  }

  return augmented
    .filter((job) => job.automation_recommendation?.lane === args.lane)
    .filter((job) => !["applied", "offer", "hidden"].includes(job.tracker_status))
    .slice(0, args.limit);
}

async function prefillKnownFields(page, profile, job) {
  const identity = profile.identity || {};
  const documents = profile.documents || {};
  const answers = profile.answers || {};

  const resumeUploaded = await uploadResumeIfPresent(page, documents, job.resume_family);
  await fillTextField(page, ["first name", "given name"], identity.firstName);
  await fillTextField(page, ["last name", "family name", "surname"], identity.lastName);
  await fillTextField(page, ["full name", "name"], identity.fullName);
  await fillTextField(page, ["email"], identity.email);
  await fillTextField(page, ["phone", "mobile"], identity.phone);
  await fillTextField(page, ["city", "location"], identity.city);
  await fillTextField(page, ["linkedin"], identity.linkedin);
  await fillTextField(page, ["github"], identity.github);
  await fillTextField(page, ["website", "portfolio"], identity.website);
  await fillTextarea(page, ["cover letter", "why are you interested", "why do you want"], documents.genericCoverLetter);

  for (const [label, value] of Object.entries(answers)) {
    await fillTextField(page, [label], value);
  }

  return {
    result: "prefilled-review",
    notes: resumeUploaded
      ? "Prefilled common fields and uploaded the routed resume. Final submission still requires review."
      : "Prefilled common fields, but no supported resume upload input was found. Final submission still requires review.",
  };
}

async function prefillBySource(page, profile, job) {
  const sourceType = job.source_type || "";
  if (sourceType === "greenhouse") {
    const result = await prefillKnownFields(page, profile, job);
    return {
      ...result,
      notes: `${result.notes} Adapter: Greenhouse best-effort prefill.`,
    };
  }
  if (sourceType === "lever") {
    const result = await prefillKnownFields(page, profile, job);
    return {
      ...result,
      notes: `${result.notes} Adapter: Lever best-effort prefill.`,
    };
  }
  if (sourceType === "ashby") {
    const result = await prefillKnownFields(page, profile, job);
    return {
      ...result,
      notes: `${result.notes} Adapter: Ashby best-effort prefill.`,
    };
  }
  const result = await prefillKnownFields(page, profile, job);
  return {
    ...result,
    notes: `${result.notes} Adapter: generic best-effort path for unsupported or custom job pages.`,
  };
}

async function uploadResumeIfPresent(page, documents, family) {
  const resumePath = family === "sdet" ? documents.sdetResume : documents.sweResume;
  if (!resumePath || !fs.existsSync(resumePath)) {
    return false;
  }
  const inputs = page.locator('input[type="file"]');
  const count = await inputs.count();
  let uploaded = false;
  for (let index = 0; index < count; index += 1) {
    await inputs.nth(index).setInputFiles(resumePath).then(() => {
      uploaded = true;
    }).catch(() => {});
  }
  return uploaded;
}

async function fillTextField(page, keywords, value) {
  if (!value) {
    return;
  }
  const keywordMatchers = keywords.map((item) => item.toLowerCase());
  const inputs = page.locator("input, textarea");
  const count = await inputs.count();
  for (let index = 0; index < count; index += 1) {
    const handle = inputs.nth(index);
    const attributes = [
      await handle.getAttribute("name"),
      await handle.getAttribute("placeholder"),
      await handle.getAttribute("aria-label"),
      await handle.getAttribute("id"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (keywordMatchers.some((keyword) => attributes.includes(keyword))) {
      await handle.fill(String(value)).catch(() => {});
    }
  }
}

async function fillTextarea(page, keywords, value) {
  if (!value) {
    return;
  }
  await fillTextField(page, keywords, value);
}

function upsertTrackerApplication(tracker, job, patch) {
  const applications = tracker.applications || [];
  const index = applications.findIndex((item) => item.job_id === job.job_id);
  const existing = index >= 0 ? applications[index] : {};
  const next = {
    ...existing,
    job_id: job.job_id,
    company: job.company,
    title: job.title,
    source: job.source,
    status: patch.status || existing.status || "saved",
    applied_at: existing.applied_at || (patch.status === "applied" ? todayString() : ""),
    last_contact_at: patch.last_contact_at || existing.last_contact_at || "",
    notes: patch.notes || existing.notes || "",
    updated_at: patch.updated_at || new Date().toISOString(),
    resume_family: job.resume_family || "",
    job_url: job.url || "",
  };
  if (index >= 0) {
    applications[index] = next;
  } else {
    applications.push(next);
  }
  tracker.applications = applications;
}

function trackerStatusAfterRun(prefill) {
  return prefill ? "saved" : "new";
}

function syncLocalTrackerToSqlite() {
  const result = spawnSync("python3", ["local_tracker.py", "--json", trackerPath, "--db", sqlitePath], {
    cwd: rootDir,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error("Failed to synchronize local tracker JSON into SQLite.");
  }
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function loadPlaywright() {
  try {
    return require("playwright");
  } catch (error) {
    return require(bundledPlaywrightPath);
  }
}
