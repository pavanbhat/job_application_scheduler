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
    url: "",
    title: "",
    company: "",
    source: "",
    sourceType: "",
    resumeFamily: "",
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
    if (value === "--url" && argv[index + 1]) {
      args.url = argv[index + 1];
    }
    if (value === "--title" && argv[index + 1]) {
      args.title = argv[index + 1];
    }
    if (value === "--company" && argv[index + 1]) {
      args.company = argv[index + 1];
    }
    if (value === "--source" && argv[index + 1]) {
      args.source = argv[index + 1];
    }
    if (value === "--source-type" && argv[index + 1]) {
      args.sourceType = argv[index + 1];
    }
    if (value === "--resume-family" && argv[index + 1]) {
      args.resumeFamily = argv[index + 1];
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
  if (args.url) {
    return [buildAdHocJob(args)];
  }
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

function buildAdHocJob(args) {
  const sourceType = args.sourceType || inferSourceTypeFromUrl(args.url);
  const company = args.company || inferCompanyNameFromUrl(args.url);
  const title = args.title || "Manual job intake";
  const source = args.source || company;
  const resumeFamily = args.resumeFamily || inferResumeFamily(args.url);
  return {
    job_id: `manual-${Date.now()}`,
    company,
    title,
    location: "Manual intake",
    job_type: "",
    publication_date: "",
    url: args.url,
    description: "Manual job intake from a pasted URL.",
    summary: "Manual intake role opened by the local assistant.",
    source,
    source_type: sourceType,
    fit_score: 0,
    matched_keywords: [],
    gaps: [],
    company_focus: [],
    company_priority: "manual",
    resume_family: resumeFamily,
    resume_label: resumeFamily === "sdet" ? "Senior/Staff SDET Resume" : "Senior/Staff SWE Resume",
    resume_family_label: resumeFamily === "sdet" ? "Senior/Staff SDET Resume" : "Senior/Staff SWE Resume",
    tailoring: {
      headline: "Manual intake role.",
      resume_highlights: [],
      rewrite_suggestions: [],
      outreach_message: { recruiter: "", hiring_manager: "" },
    },
    automation_recommendation: {
      lane: args.lane || "review",
      label: "Manual Review",
      reason: "Manual URL intake.",
      next_step: "Open locally and review before submission.",
    },
    tracker_status: "new",
  };
}

async function prefillBySource(page, profile, job) {
  const sourceType = job.source_type || "";
  if (sourceType === "linkedin" || sourceType === "indeed") {
    return {
      result: "handoff-required",
      notes: `${sourceType === "linkedin" ? "LinkedIn" : "Indeed"} URL detected. Open the downstream employer application page, then rerun automation on that URL. Final submission still requires review.`,
    };
  }
  const resumeUploaded = await uploadResumeIfPresent(page, profile.documents || {}, job.resume_family);

  if (sourceType === "greenhouse") {
    await prefillGreenhouse(page, profile, job);
    return adapterResult("Greenhouse", resumeUploaded);
  }
  if (sourceType === "lever") {
    await prefillLever(page, profile, job);
    return adapterResult("Lever", resumeUploaded);
  }
  if (sourceType === "ashby") {
    await prefillAshby(page, profile, job);
    return adapterResult("Ashby", resumeUploaded);
  }
  if (sourceType === "workday") {
    await prefillWorkday(page, profile, job);
    return adapterResult("Workday", resumeUploaded);
  }

  await prefillGeneric(page, profile, job);
  return adapterResult("generic", resumeUploaded);
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
    const input = inputs.nth(index);
    const descriptor = await elementDescriptor(input);
    if (descriptor.includes("resume") || descriptor.includes("cv") || descriptor.includes("curriculum")) {
      await input.setInputFiles(resumePath).then(() => {
        uploaded = true;
      }).catch(() => {});
    }
  }
  if (!uploaded && count === 1) {
    await inputs.first().setInputFiles(resumePath).then(() => {
      uploaded = true;
    }).catch(() => {});
  }
  return uploaded;
}

async function prefillGeneric(page, profile, job) {
  await fillCommonFields(page, profile, job, page.locator("body"));
}

async function prefillGreenhouse(page, profile, job) {
  const scope = page.locator('form[action*="greenhouse"], #application_form, .application, main');
  await fillCommonFields(page, profile, job, scope.first());
  await fillSelectOrChoiceGroup(page, ["work authorization", "authorized to work", "legally authorized"], profile.answers?.["work authorization"]);
  await fillSelectOrChoiceGroup(page, ["visa sponsorship", "require sponsorship", "sponsorship"], profile.answers?.["visa sponsorship"]);
}

async function prefillLever(page, profile, job) {
  const scope = page.locator('.application-page, .application-form, form, main');
  await fillCommonFields(page, profile, job, scope.first());
  await fillSelectOrChoiceGroup(page, ["work authorization", "authorized to work"], profile.answers?.["work authorization"]);
  await fillSelectOrChoiceGroup(page, ["visa sponsorship", "sponsorship"], profile.answers?.["visa sponsorship"]);
}

async function prefillAshby(page, profile, job) {
  const scope = page.locator('[data-testid*="application"], form, main');
  await fillCommonFields(page, profile, job, scope.first());
  await fillSelectOrChoiceGroup(page, ["work authorization", "authorized to work"], profile.answers?.["work authorization"]);
  await fillSelectOrChoiceGroup(page, ["visa sponsorship", "sponsorship"], profile.answers?.["visa sponsorship"]);
}

async function prefillWorkday(page, profile, job) {
  const scope = page.locator('[data-automation-id], form, main');
  for (let step = 0; step < 4; step += 1) {
    await fillCommonFields(page, profile, job, scope.first());
    await fillSelectOrChoiceGroup(page, ["work authorization", "authorized to work"], profile.answers?.["work authorization"]);
    await fillSelectOrChoiceGroup(page, ["visa sponsorship", "sponsorship"], profile.answers?.["visa sponsorship"]);
    const advanced = await clickProgressButton(page, ["next", "continue", "review"]);
    if (!advanced) {
      break;
    }
    await page.waitForTimeout(1200);
    if (await hasSubmitButton(page)) {
      break;
    }
  }
}

async function fillCommonFields(page, profile, job, scope) {
  const identity = profile.identity || {};
  const documents = profile.documents || {};
  const answers = profile.answers || {};
  const activeScope = scope || page.locator("body");

  await fillTextLikeField(activeScope, ["first name", "given name"], identity.firstName);
  await fillTextLikeField(activeScope, ["last name", "family name", "surname"], identity.lastName);
  await fillTextLikeField(activeScope, ["full name"], identity.fullName);
  await fillTextLikeField(activeScope, ["email"], identity.email);
  await fillTextLikeField(activeScope, ["phone", "mobile"], identity.phone);
  await fillTextLikeField(activeScope, ["city", "location", "current location"], identity.city);
  await fillTextLikeField(activeScope, ["linkedin"], identity.linkedin);
  await fillTextLikeField(activeScope, ["github"], identity.github);
  await fillTextLikeField(activeScope, ["website", "portfolio", "personal site"], identity.website);
  await fillTextLikeField(activeScope, ["cover letter", "why are you interested", "why do you want", "additional information"], documents.genericCoverLetter);

  for (const [label, value] of Object.entries(answers)) {
    await fillSelectOrChoiceGroup(page, [label], value);
    await fillTextLikeField(activeScope, [label], value);
  }

  await fillTextLikeField(activeScope, ["job title", "current title"], job.title);
}

async function fillTextLikeField(scope, keywords, value) {
  if (!value) {
    return;
  }
  const keywordMatchers = keywords.map((item) => item.toLowerCase());
  const inputs = scope.locator('input:not([type="radio"]):not([type="checkbox"]):not([type="file"]), textarea');
  const count = await inputs.count();
  for (let index = 0; index < count; index += 1) {
    const handle = inputs.nth(index);
    const descriptor = await elementDescriptor(handle);
    if (keywordMatchers.some((keyword) => descriptor.includes(keyword))) {
      await handle.fill(String(value)).catch(() => {});
    }
  }
}

async function fillSelectOrChoiceGroup(page, keywords, value) {
  if (!value) {
    return;
  }
  const normalizedValue = normalizeChoiceValue(value);
  const keywordMatchers = keywords.map((item) => item.toLowerCase());

  const selects = page.locator("select");
  const selectCount = await selects.count();
  for (let index = 0; index < selectCount; index += 1) {
    const select = selects.nth(index);
    const descriptor = await elementDescriptor(select);
    if (keywordMatchers.some((keyword) => descriptor.includes(keyword))) {
      await selectOption(select, normalizedValue);
    }
  }

  const radioInputs = page.locator('input[type="radio"]');
  const radioCount = await radioInputs.count();
  for (let index = 0; index < radioCount; index += 1) {
    const input = radioInputs.nth(index);
    const descriptor = await elementDescriptor(input);
    const valueDescriptor = [
      descriptor,
      (await input.getAttribute("value")) || "",
      await labelTextForElement(input),
    ].join(" ").toLowerCase();
    if (keywordMatchers.some((keyword) => descriptor.includes(keyword)) && optionMatches(valueDescriptor, normalizedValue)) {
      await input.check().catch(() => {});
    }
  }

  const checkboxes = page.locator('input[type="checkbox"]');
  const checkboxCount = await checkboxes.count();
  for (let index = 0; index < checkboxCount; index += 1) {
    const input = checkboxes.nth(index);
    const descriptor = await elementDescriptor(input);
    if (keywordMatchers.some((keyword) => descriptor.includes(keyword))) {
      if (normalizedValue === "yes") {
        await input.check().catch(() => {});
      } else if (normalizedValue === "no") {
        await input.uncheck().catch(() => {});
      }
    }
  }
}

async function selectOption(select, normalizedValue) {
  const options = await select.locator("option").evaluateAll((nodes) => nodes.map((node) => ({
    value: node.value,
    text: (node.textContent || "").trim(),
  })));
  const match = options.find((option) => optionMatches(`${option.value} ${option.text}`.toLowerCase(), normalizedValue));
  if (match) {
    await select.selectOption(match.value).catch(() => {});
  }
}

async function elementDescriptor(handle) {
  const attributes = [
    await handle.getAttribute("name"),
    await handle.getAttribute("placeholder"),
    await handle.getAttribute("aria-label"),
    await handle.getAttribute("id"),
    await handle.getAttribute("data-testid"),
    await handle.getAttribute("data-qa"),
    await labelTextForElement(handle),
    await fieldsetLegend(handle),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return attributes;
}

async function labelTextForElement(handle) {
  return handle.evaluate((node) => {
    const id = node.getAttribute("id");
    if (id) {
      const explicit = document.querySelector(`label[for="${id}"]`);
      if (explicit) {
        return (explicit.textContent || "").trim();
      }
    }
    const parentLabel = node.closest("label");
    if (parentLabel) {
      return (parentLabel.textContent || "").trim();
    }
    const wrapper = node.closest('[data-testid], .application-question, .application-field, .field, .question');
    if (wrapper) {
      const label = wrapper.querySelector("label, legend, h3, h4, span");
      if (label) {
        return (label.textContent || "").trim();
      }
    }
    return "";
  }).catch(() => "");
}

async function fieldsetLegend(handle) {
  return handle.evaluate((node) => {
    const fieldset = node.closest("fieldset");
    if (!fieldset) {
      return "";
    }
    const legend = fieldset.querySelector("legend");
    return legend ? (legend.textContent || "").trim() : "";
  }).catch(() => "");
}

function normalizeChoiceValue(value) {
  const text = String(value).trim().toLowerCase();
  if (["yes", "y", "true"].includes(text)) {
    return "yes";
  }
  if (["no", "n", "false"].includes(text)) {
    return "no";
  }
  return text;
}

function optionMatches(optionText, normalizedValue) {
  if (!normalizedValue) {
    return false;
  }
  if (normalizedValue === "yes") {
    return /\byes\b|\bi am authorized\b|\bauthorized\b/.test(optionText);
  }
  if (normalizedValue === "no") {
    return /\bno\b|\bdo not\b|\bnot require\b/.test(optionText);
  }
  return optionText.includes(normalizedValue);
}

function adapterResult(adapterName, resumeUploaded) {
  const uploadText = resumeUploaded
    ? "uploaded the routed resume"
    : "did not detect a supported resume upload field";
  return {
    result: "prefilled-review",
    notes: `Prefilled common fields, ${uploadText}, and stopped before final submission. Adapter: ${adapterName}.`,
  };
}

async function clickProgressButton(page, labels) {
  const buttons = page.locator('button, [role="button"]');
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const text = ((await button.textContent().catch(() => "")) || "").trim().toLowerCase();
    if (labels.some((label) => text === label || text.startsWith(`${label} `) || text.includes(` ${label}`))) {
      if (text.includes("submit") || text.includes("apply")) {
        continue;
      }
      const disabled = await button.isDisabled().catch(() => true);
      if (!disabled) {
        await button.click().catch(() => {});
        return true;
      }
    }
  }
  return false;
}

async function hasSubmitButton(page) {
  const buttons = page.locator('button, [role="button"]');
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const text = (((await buttons.nth(index).textContent().catch(() => "")) || "").trim().toLowerCase());
    if (text.includes("submit") || text.includes("apply now") || text === "apply") {
      return true;
    }
  }
  return false;
}

function inferSourceTypeFromUrl(rawUrl) {
  const value = String(rawUrl || "").toLowerCase();
  if (value.includes("linkedin.com")) {
    return "linkedin";
  }
  if (value.includes("indeed.com")) {
    return "indeed";
  }
  if (value.includes("greenhouse")) {
    return "greenhouse";
  }
  if (value.includes("lever.co")) {
    return "lever";
  }
  if (value.includes("ashby")) {
    return "ashby";
  }
  if (value.includes("workday") || value.includes("myworkdayjobs")) {
    return "workday";
  }
  return "generic";
}

function inferCompanyNameFromUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./, "");
    const primary = (host.split(".")[0] || "ManualCompany")
      .split(/[-_]/g)
      .filter(Boolean)
      .map((part) => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
      .join(" ");
    return primary || "Manual Company";
  } catch (_error) {
    return "Manual Company";
  }
}

function inferResumeFamily(rawUrl) {
  const value = String(rawUrl || "").toLowerCase();
  return /(sdet|qa|quality|test|automation)/.test(value) ? "sdet" : "swe";
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
