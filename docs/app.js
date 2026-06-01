const storageKey = "job-scheduler-tracker-v2";
const manualJobsStorageKey = "job-scheduler-manual-jobs-v1";
const trackedStatuses = ["applied", "replied", "interviewing", "rejected", "offer"];
const responseStatuses = ["replied", "interviewing", "rejected", "offer"];
const positiveStatuses = ["interviewing", "offer"];

const state = {
  payload: null,
  trackerMap: new Map(),
  manualJobs: [],
  filteredJobs: [],
  selectedJobId: null,
};

const els = {
  generatedAt: document.querySelector("#generated-at"),
  candidateHeadline: document.querySelector("#candidate-headline"),
  readyCount: document.querySelector("#ready-count"),
  appliedCount: document.querySelector("#applied-count"),
  statsGrid: document.querySelector("#stats-grid"),
  sourceBreakdown: document.querySelector("#source-breakdown"),
  companyBreakdown: document.querySelector("#company-breakdown"),
  statusBreakdown: document.querySelector("#status-breakdown"),
  automationLanes: document.querySelector("#automation-lanes"),
  jobsList: document.querySelector("#jobs-list"),
  jobCount: document.querySelector("#job-count"),
  search: document.querySelector("#search-input"),
  sourceFilter: document.querySelector("#source-filter"),
  statusFilter: document.querySelector("#status-filter"),
  laneFilter: document.querySelector("#lane-filter"),
  manualJobUrl: document.querySelector("#manual-job-url"),
  addManualJob: document.querySelector("#add-manual-job"),
  manualIntakeStatus: document.querySelector("#manual-intake-status"),
  importTracker: document.querySelector("#import-tracker"),
  importTrackerFile: document.querySelector("#import-tracker-file"),
  exportTracker: document.querySelector("#export-tracker"),
  clearTracker: document.querySelector("#clear-tracker"),
  template: document.querySelector("#job-card-template"),
  emptyInspector: document.querySelector("#empty-inspector"),
  inspector: document.querySelector("#job-inspector"),
  inspectorTitle: document.querySelector("#inspector-title"),
  inspectorMeta: document.querySelector("#inspector-meta"),
  inspectorLink: document.querySelector("#inspector-link"),
  inspectorFit: document.querySelector("#inspector-fit"),
  inspectorLane: document.querySelector("#inspector-lane"),
  inspectorResume: document.querySelector("#inspector-resume"),
  inspectorAdapterPill: document.querySelector("#inspector-adapter-pill"),
  inspectorStatus: document.querySelector("#inspector-status"),
  inspectorLastContact: document.querySelector("#inspector-last-contact"),
  inspectorNotes: document.querySelector("#inspector-notes"),
  inspectorSummary: document.querySelector("#inspector-summary"),
  inspectorNextStep: document.querySelector("#inspector-next-step"),
  inspectorChips: document.querySelector("#inspector-chips"),
  inspectorHeadline: document.querySelector("#inspector-headline"),
  inspectorHighlights: document.querySelector("#inspector-highlights"),
  inspectorRewrites: document.querySelector("#inspector-rewrites"),
  inspectorRecruiter: document.querySelector("#inspector-recruiter"),
  inspectorManager: document.querySelector("#inspector-manager"),
  inspectorCommand: document.querySelector("#inspector-command"),
  inspectorChecklist: document.querySelector("#inspector-checklist"),
  inspectorAdapterDetails: document.querySelector("#inspector-adapter-details"),
  inspectorLocalArtifacts: document.querySelector("#inspector-local-artifacts"),
  copyCommand: document.querySelector("#copy-command"),
  startLocalAutomation: document.querySelector("#start-local-automation"),
  automationStatus: document.querySelector("#automation-status"),
};

boot();

async function boot() {
  const response = await fetch("./data/site_data.json", { cache: "no-store" });
  state.payload = await response.json();
  hydrateTrackerMap(state.payload);
  hydrateManualJobs();
  populateHeader(state.payload);
  populateSourceFilter(materializedJobs());
  bindEvents();
  render();
}

function hydrateTrackerMap(payload) {
  const seedEntries = payload.tracker?.applications ?? [];
  const browserEntries = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
  const merged = new Map();
  for (const entry of [...seedEntries, ...browserEntries]) {
    if (entry?.job_id) {
      merged.set(entry.job_id, entry);
    }
  }
  state.trackerMap = merged;
}

function populateHeader(payload) {
  els.generatedAt.textContent = new Date(payload.generated_at).toLocaleString();
  els.candidateHeadline.textContent = payload.candidate?.headline ?? "";
}

function populateSourceFilter(jobs) {
  els.sourceFilter.innerHTML = '<option value="all">All sources</option>';
  const seen = [...new Set(jobs.map((job) => job.source))].sort();
  for (const source of seen) {
    const option = document.createElement("option");
    option.value = source;
    option.textContent = source;
    els.sourceFilter.append(option);
  }
}

function bindEvents() {
  els.search.addEventListener("input", render);
  els.sourceFilter.addEventListener("change", render);
  els.statusFilter.addEventListener("change", render);
  els.laneFilter.addEventListener("change", render);
  els.addManualJob.addEventListener("click", addManualJobFromUrl);
  els.importTracker.addEventListener("click", () => els.importTrackerFile.click());
  els.importTrackerFile.addEventListener("change", importTracker);
  els.exportTracker.addEventListener("click", exportTracker);
  els.clearTracker.addEventListener("click", clearLocalTracker);
  els.inspectorStatus.addEventListener("change", updateInspectorTracker);
  els.inspectorLastContact.addEventListener("change", updateInspectorTracker);
  els.inspectorNotes.addEventListener("input", updateInspectorTracker);
  els.copyCommand.addEventListener("click", copyInspectorCommand);
  els.startLocalAutomation.addEventListener("click", startLocalAutomation);
}

function render() {
  const jobs = materializedJobs();
  const query = els.search.value.trim().toLowerCase();
  const source = els.sourceFilter.value;
  const status = els.statusFilter.value;
  const lane = els.laneFilter.value;

  state.filteredJobs = jobs.filter((job) => {
    const searchBlob = [job.company, job.title, job.location, ...(job.matched_keywords ?? [])].join(" ").toLowerCase();
    const matchesQuery = !query || searchBlob.includes(query);
    const matchesSource = source === "all" || job.source === source;
    const matchesStatus = status === "all" || job.tracker_status === status;
    const matchesLane = lane === "all" || job.automation_recommendation?.lane === lane;
    return matchesQuery && matchesSource && matchesStatus && matchesLane;
  });

  if (!state.selectedJobId || !state.filteredJobs.some((job) => job.job_id === state.selectedJobId)) {
    state.selectedJobId = state.filteredJobs[0]?.job_id ?? null;
  }

  renderOverview(jobs);
  renderJobs(state.filteredJobs);
  renderInspector(selectedJob());
  els.jobCount.textContent = `${state.filteredJobs.length} visible roles`;
}

function materializedJobs() {
  return [...(state.payload.jobs || []), ...state.manualJobs].map((job) => {
    const tracker = trackerEntry(job.job_id);
    return {
      ...job,
      tracker_status: tracker?.status ?? job.tracker_status ?? "new",
      tracker_notes: tracker?.notes ?? job.tracker_notes ?? "",
      last_contact_at: tracker?.last_contact_at ?? job.last_contact_at ?? "",
      applied_at: tracker?.applied_at ?? job.applied_at ?? "",
    };
  });
}

function hydrateManualJobs() {
  state.manualJobs = JSON.parse(localStorage.getItem(manualJobsStorageKey) ?? "[]");
}

function renderOverview(jobs) {
  const entries = [...state.trackerMap.values()];
  const appliedEntries = entries.filter((entry) => trackedStatuses.includes(entry.status));
  const respondedEntries = appliedEntries.filter((entry) => responseStatuses.includes(entry.status));
  const positiveEntries = appliedEntries.filter((entry) => positiveStatuses.includes(entry.status));
  const offers = appliedEntries.filter((entry) => entry.status === "offer");
  const readyJobs = jobs.filter((job) => job.automation_recommendation?.lane === "ready");

  els.readyCount.textContent = String(readyJobs.length);
  els.appliedCount.textContent = String(appliedEntries.length);

  const cards = [
    metricCard("Ranked jobs", jobs.length),
    metricCard("Auto-prep queue", readyJobs.length),
    metricCard("Applied", appliedEntries.length),
    metricCard("Response rate", percentage(respondedEntries.length, appliedEntries.length)),
    metricCard("Offer rate", percentage(offers.length, appliedEntries.length)),
  ];
  els.statsGrid.replaceChildren(...cards);

  renderMetricBreakdown(els.automationLanes, automationLaneRows(jobs));
  renderMetricBreakdown(els.statusBreakdown, statusRows(entries));
  renderMetricBreakdown(els.sourceBreakdown, groupedRows(entries, "source"));
  renderMetricBreakdown(els.companyBreakdown, groupedRows(entries, "company"));
}

function metricCard(label, value) {
  const card = document.createElement("div");
  card.className = "stat-card";
  card.innerHTML = `<span class="label">${label}</span><strong>${value}</strong>`;
  return card;
}

function automationLaneRows(jobs) {
  const order = ["ready", "review", "watch"];
  const counts = new Map(order.map((lane) => [lane, 0]));
  for (const job of jobs) {
    const lane = job.automation_recommendation?.lane ?? "watch";
    counts.set(lane, (counts.get(lane) ?? 0) + 1);
  }
  return order.map((lane) => ({
    name: laneLabel(lane),
    detail: `${counts.get(lane) ?? 0} roles`,
  }));
}

function statusRows(entries) {
  const order = ["new", "saved", "applied", "replied", "interviewing", "offer", "rejected", "hidden"];
  const counts = new Map(order.map((status) => [status, 0]));
  for (const entry of entries) {
    counts.set(entry.status || "new", (counts.get(entry.status || "new") ?? 0) + 1);
  }
  return order.map((status) => ({ name: capitalize(status), detail: `${counts.get(status) ?? 0} roles` }));
}

function groupedRows(entries, key) {
  const map = new Map();
  for (const entry of entries) {
    const bucketKey = entry[key] || "Unknown";
    const bucket = map.get(bucketKey) || { applications: 0, responses: 0 };
    if (trackedStatuses.includes(entry.status)) {
      bucket.applications += 1;
    }
    if (responseStatuses.includes(entry.status)) {
      bucket.responses += 1;
    }
    map.set(bucketKey, bucket);
  }
  return [...map.entries()]
    .map(([name, value]) => ({
      name,
      detail: `${value.applications} apps | ${percentage(value.responses, value.applications)} response`,
    }))
    .sort((left, right) => parseInt(right.detail, 10) - parseInt(left.detail, 10))
    .slice(0, 8);
}

function renderMetricBreakdown(container, rows) {
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "muted-copy";
    empty.textContent = "No tracker activity yet.";
    container.replaceChildren(empty);
    return;
  }
  const nodes = rows.map((row) => {
    const div = document.createElement("div");
    div.className = "metric-row";
    div.innerHTML = `<span>${row.name}</span><span>${row.detail}</span>`;
    return div;
  });
  container.replaceChildren(...nodes);
}

function renderJobs(jobs) {
  if (!jobs.length) {
    const empty = document.createElement("p");
    empty.className = "muted-copy";
    empty.textContent = "No jobs match the current filters.";
    els.jobsList.replaceChildren(empty);
    return;
  }

  const nodes = jobs.map((job) => {
    const fragment = els.template.content.cloneNode(true);
    const card = fragment.querySelector(".job-card");
    const button = fragment.querySelector(".job-select");

    if (job.job_id === state.selectedJobId) {
      card.classList.add("is-selected");
    }

    fragment.querySelector(".score-pill").textContent = `${job.fit_score} fit`;
    fragment.querySelector(".job-title").textContent = `${job.company} | ${job.title}`;
    fragment.querySelector(".job-meta").textContent = `${job.source} | ${job.location} | ${job.job_type || "Employment type not listed"}`;
    fragment.querySelector(".job-summary").textContent = job.summary || "No summary available.";

    const lanePill = fragment.querySelector(".lane-pill");
    lanePill.dataset.lane = job.automation_recommendation?.lane || "watch";
    lanePill.textContent = job.automation_recommendation?.label || "Watchlist";

    const statusPill = fragment.querySelector(".status-pill");
    statusPill.textContent = capitalize(job.tracker_status);

    fillChips(fragment.querySelector(".matched-row"), job);

    button.addEventListener("click", () => {
      state.selectedJobId = job.job_id;
      render();
    });

    return fragment;
  });
  els.jobsList.replaceChildren(...nodes);
}

function renderInspector(job) {
  if (!job) {
    els.emptyInspector.classList.remove("hidden");
    els.inspector.classList.add("hidden");
    return;
  }

  els.emptyInspector.classList.add("hidden");
  els.inspector.classList.remove("hidden");

  els.inspectorTitle.textContent = `${job.company} | ${job.title}`;
  els.inspectorMeta.textContent = `${job.source} | ${job.location} | Posted ${job.publication_date || "unknown"}`;
  els.inspectorLink.href = job.url || "#";
  els.inspectorFit.textContent = `${job.fit_score}`;
  els.inspectorLane.textContent = job.automation_recommendation?.label || "Watchlist";
  els.inspectorResume.textContent = job.resume_family_label || job.resume_label || "Primary Resume";
  els.inspectorStatus.value = job.tracker_status;
  els.inspectorLastContact.value = job.last_contact_at || "";
  els.inspectorNotes.value = job.tracker_notes || "";
  els.inspectorSummary.textContent = job.automation_recommendation?.reason || "";
  els.inspectorNextStep.textContent = job.automation_recommendation?.next_step || "";
  els.inspectorHeadline.textContent = job.tailoring?.headline || "";
  els.inspectorLink.dataset.jobId = job.job_id;
  els.inspectorStatus.dataset.jobId = job.job_id;
  els.inspectorLastContact.dataset.jobId = job.job_id;
  els.inspectorNotes.dataset.jobId = job.job_id;
  els.inspectorAdapterPill.textContent = adapterTitle(job.source_type);
  els.inspectorAdapterPill.dataset.sourceType = normalizedSourceType(job.source_type);
  els.inspectorCommand.textContent = localAssistantCommand(job);

  fillList(els.inspectorHighlights, job.tailoring?.resume_highlights ?? []);
  fillList(els.inspectorRewrites, job.tailoring?.rewrite_suggestions ?? []);
  els.inspectorRecruiter.textContent = job.tailoring?.outreach_message?.recruiter || "";
  els.inspectorManager.textContent = job.tailoring?.outreach_message?.hiring_manager || "";
  fillList(els.inspectorChecklist, checklistItems(job));
  fillList(els.inspectorAdapterDetails, adapterDetails(job));
  fillList(els.inspectorLocalArtifacts, localArtifactDetails(job));
  fillInspectorChips(job);
  els.automationStatus.textContent = restrictedBoardMessage(job.url) || "Uses the localhost assistant bridge. Login, CAPTCHA, and final submit remain manual.";
}

function fillList(container, items) {
  const nodes = items.map((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    return li;
  });
  container.replaceChildren(...nodes);
}

function fillInspectorChips(job) {
  const chips = [];
  chips.push(chipNode(`Use: ${job.resume_family_label || job.resume_label}`, "resume-chip"));
  chips.push(chipNode(job.automation_recommendation?.label || "Watchlist", "action-chip"));
  for (const keyword of job.matched_keywords ?? []) {
    chips.push(chipNode(keyword));
  }
  for (const keyword of (job.gaps ?? []).slice(0, 3)) {
    chips.push(chipNode(`Gap: ${keyword}`, "gap"));
  }
  els.inspectorChips.replaceChildren(...chips);
}

function fillChips(container, job) {
  const chips = [];
  chips.push(chipNode(`Use: ${job.resume_family_label || job.resume_label}`, "resume-chip"));
  chips.push(chipNode(job.automation_recommendation?.label || "Watchlist", "action-chip"));
  for (const keyword of job.matched_keywords ?? []) {
    chips.push(chipNode(keyword));
  }
  for (const keyword of (job.gaps ?? []).slice(0, 2)) {
    chips.push(chipNode(`Gap: ${keyword}`, "gap"));
  }
  container.replaceChildren(...chips);
}

function chipNode(text, extraClass = "") {
  const chip = document.createElement("span");
  chip.className = `chip ${extraClass}`.trim();
  chip.textContent = text;
  return chip;
}

function updateInspectorTracker() {
  const job = selectedJob();
  if (!job) {
    return;
  }
  const existing = trackerEntry(job.job_id) ?? {};
  const nextStatus = els.inspectorStatus.value;
  const next = {
    ...existing,
    job_id: job.job_id,
    company: job.company,
    title: job.title,
    source: job.source,
    status: nextStatus,
    applied_at: existing.applied_at || (nextStatus === "applied" ? todayString() : ""),
    last_contact_at: els.inspectorLastContact.value || "",
    notes: els.inspectorNotes.value || "",
  };
  state.trackerMap.set(job.job_id, next);
  persistTracker();
  render();
}

function importTracker(event) {
  const [file] = event.target.files ?? [];
  if (!file) {
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const parsed = JSON.parse(String(reader.result));
    const applications = parsed.applications ?? [];
    for (const entry of applications) {
      if (entry?.job_id) {
        state.trackerMap.set(entry.job_id, entry);
      }
    }
    persistTracker();
    render();
  };
  reader.readAsText(file);
  event.target.value = "";
}

function exportTracker() {
  const blob = new Blob([JSON.stringify({ applications: [...state.trackerMap.values()] }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "tracker-export.json";
  link.click();
  URL.revokeObjectURL(url);
}

function addManualJobFromUrl() {
  const url = els.manualJobUrl.value.trim();
  if (!url) {
    els.manualIntakeStatus.textContent = "Paste a valid job URL first.";
    return;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_error) {
    els.manualIntakeStatus.textContent = "That URL is not valid.";
    return;
  }

  const sourceType = inferSourceType(parsed);
  const resumeFamily = inferResumeFamily(url);
  const company = inferCompanyName(parsed);
  const title = inferTitleFromUrl(parsed);
  const lane = sourceType === "workday" || sourceType === "greenhouse" || sourceType === "lever" || sourceType === "ashby" ? "review" : "watch";
  const job = {
    job_id: `manual-${Date.now()}`,
    company,
    title,
    location: "Manual intake",
    job_type: "",
    publication_date: "",
    url,
    description: "Manual URL intake from an external job board or employer application page.",
    summary: "Added locally from a pasted URL. Use the local assistant to prepare the application.",
    source: sourceLabelFor(parsed, sourceType),
    source_type: sourceType,
    fit_score: 0,
    matched_keywords: [],
    gaps: [],
    resume_family: resumeFamily,
    resume_label: resumeFamily === "sdet" ? "Senior/Staff SDET Resume" : "Senior/Staff SWE Resume",
    resume_family_label: resumeFamily === "sdet" ? "Senior/Staff SDET Resume" : "Senior/Staff SWE Resume",
    tailoring: {
      headline: "Manual intake role. Review the destination application before relying on automation output.",
      resume_highlights: [],
      rewrite_suggestions: ["Review the actual employer job description and tailor the resume before submission."],
      outreach_message: { recruiter: "", hiring_manager: "" },
    },
    automation_recommendation: {
      lane,
      label: laneLabel(lane),
      reason: sourceType === "linkedin" || sourceType === "indeed"
        ? "Manual discovery URL. The assistant can open it locally, but you may need to hand off to the employer application page."
        : "Manual intake URL. Start local automation and review each step before submission.",
      next_step: sourceType === "linkedin" || sourceType === "indeed"
        ? "Open locally, navigate to the employer apply page, then continue with assistant prefill."
        : "Run the local assistant in prefill mode, review field mapping, and continue through the ATS flow.",
    },
    tracker_status: "new",
  };

  state.manualJobs = [job, ...state.manualJobs];
  persistManualJobs();
  populateSourceFilter(materializedJobs());
  state.selectedJobId = job.job_id;
  els.manualJobUrl.value = "";
  els.manualIntakeStatus.textContent = `Added ${company} | ${title} to your local queue.`;
  render();
}

async function copyInspectorCommand() {
  const text = els.inspectorCommand.textContent.trim();
  if (!text) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    els.copyCommand.textContent = "Copied";
    window.setTimeout(() => {
      els.copyCommand.textContent = "Copy command";
    }, 1200);
  } catch (_error) {
    els.copyCommand.textContent = "Copy failed";
    window.setTimeout(() => {
      els.copyCommand.textContent = "Copy command";
    }, 1200);
  }
}

async function startLocalAutomation() {
  const job = selectedJob();
  if (!job) {
    return;
  }
  els.automationStatus.textContent = "Starting local assistant...";
  try {
    const response = await fetch("http://127.0.0.1:4173/api/automation/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Failed to start local automation.");
    }
    els.automationStatus.textContent = payload.message || `Local automation started. Run ID: ${payload.run_id}`;
  } catch (error) {
    els.automationStatus.textContent = `Unable to reach the local assistant bridge at http://127.0.0.1:4173. ${error.message}`;
  }
}

function clearLocalTracker() {
  localStorage.removeItem(storageKey);
  localStorage.removeItem(manualJobsStorageKey);
  hydrateTrackerMap(state.payload);
  hydrateManualJobs();
  populateSourceFilter(materializedJobs());
  render();
}

function persistManualJobs() {
  localStorage.setItem(manualJobsStorageKey, JSON.stringify(state.manualJobs));
}

function selectedJob() {
  return state.filteredJobs.find((job) => job.job_id === state.selectedJobId) ?? null;
}

function trackerEntry(jobId) {
  return state.trackerMap.get(jobId);
}

function persistTracker() {
  localStorage.setItem(storageKey, JSON.stringify([...state.trackerMap.values()]));
}

function percentage(numerator, denominator) {
  return `${percentageValue(numerator, denominator)}%`;
}

function percentageValue(numerator, denominator) {
  if (!denominator) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 10;
}

function laneLabel(lane) {
  if (lane === "ready") {
    return "Auto-Prep Candidate";
  }
  if (lane === "review") {
    return "Manual Review";
  }
  return "Watchlist";
}

function localAssistantCommand(job) {
  const lane = job.automation_recommendation?.lane || "review";
  if (String(job.job_id || "").startsWith("manual-")) {
    return `./playwright_assistant/run_worker.sh review --url "${job.url}" --company "${job.company}" --title "${job.title}" --source "${job.source}" --source-type "${job.source_type}" --resume-family ${job.resume_family || "swe"} --lane ${lane} --prefill`;
  }
  return `./playwright_assistant/run_worker.sh review --job ${job.job_id} --lane ${lane} --prefill`;
}

function checklistItems(job) {
  const items = [
    `Open the ${adapterTitle(job.source_type)} application page locally with the assistant.`,
    `Confirm the ${job.resume_family_label || job.resume_label || "recommended"} uploads successfully.`,
    "Review all autofilled identity, work authorization, and employment-history answers.",
    "Validate any generated cover note or outreach copy before reuse.",
    "Submit manually only after screenshots and tracker notes look correct.",
  ];
  if ((job.gaps ?? []).length) {
    items.splice(3, 0, `Check likely gap areas: ${(job.gaps ?? []).slice(0, 3).join(", ")}.`);
  }
  return items;
}

function adapterDetails(job) {
  const sourceType = normalizedSourceType(job.source_type);
  const detailMap = {
    greenhouse: [
      "Targets common Greenhouse resume, cover letter, LinkedIn, website, and location fields.",
      "Uses label-aware matching plus file-input scanning for resume uploads.",
      "Handles work authorization and sponsorship style questions when labels are detectable.",
    ],
    lever: [
      "Targets Lever application fields, resume upload blocks, and common profile/contact questions.",
      "Matches label text, placeholders, and select/radio prompts for authorization and sponsorship answers.",
      "Uses a best-effort fallback when the posting page is customized.",
    ],
    ashby: [
      "Targets Ashby field wrappers, file uploads, and structured application questions.",
      "Prefills profile URLs, free-text responses, and common yes/no compliance prompts.",
      "Falls back to generic matching if Ashby-specific containers are not present.",
    ],
    workday: [
      "Targets Workday multi-step candidate forms, contact info, profile, and work authorization prompts.",
      "Attempts to advance through intermediate Next and Continue screens while stopping short of final submission.",
      "Best results come from pasting the direct employer Workday application URL rather than a discovery-board URL.",
    ],
    linkedin: [
      "LinkedIn is treated as a manual discovery source, not an automation target.",
      "The assistant can open the page locally, but you should hand off to the employer application page before continuing.",
      "Do not rely on full-site automation for LinkedIn-hosted pages.",
    ],
    indeed: [
      "Indeed is treated as a manual discovery source, not a full automation target.",
      "The assistant can open the page locally, but you should continue on the employer application page for reliable prefill.",
      "Best results come from pasting the downstream ATS apply URL.",
    ],
    generic: [
      "Uses generic DOM scanning against labels, placeholders, aria-labels, and file inputs.",
      "Suitable for review-first preparation, not guaranteed full site coverage.",
      "Best used when the role is valuable enough to justify manual completion after prefill.",
    ],
  };
  return detailMap[sourceType] || detailMap.generic;
}

function localArtifactDetails(job) {
  return [
    `JSON tracker entry: data/local_tracker.json -> ${job.job_id}`,
    `SQLite mirror: data/local_tracker.sqlite3 -> applications.job_id = ${job.job_id}`,
    `Screenshots: data/assistant_artifacts/screenshots/${job.job_id}-*.png`,
    `Persistent browser state: playwright_assistant/.playwright-profile`,
  ];
}

function normalizedSourceType(sourceType) {
  if (["greenhouse", "lever", "ashby", "workday", "linkedin", "indeed"].includes(sourceType)) {
    return sourceType;
  }
  return "generic";
}

function adapterTitle(sourceType) {
  const normalized = normalizedSourceType(sourceType);
  if (normalized === "greenhouse") {
    return "Greenhouse adapter";
  }
  if (normalized === "lever") {
    return "Lever adapter";
  }
  if (normalized === "ashby") {
    return "Ashby adapter";
  }
  if (normalized === "workday") {
    return "Workday adapter";
  }
  if (normalized === "linkedin") {
    return "LinkedIn handoff";
  }
  if (normalized === "indeed") {
    return "Indeed handoff";
  }
  return "Generic adapter";
}

function inferSourceType(parsedUrl) {
  const host = parsedUrl.hostname.toLowerCase();
  const href = parsedUrl.href.toLowerCase();
  if (host.includes("linkedin.com")) {
    return "linkedin";
  }
  if (host.includes("indeed.com")) {
    return "indeed";
  }
  if (host.includes("greenhouse")) {
    return "greenhouse";
  }
  if (host.includes("lever.co")) {
    return "lever";
  }
  if (host.includes("ashby")) {
    return "ashby";
  }
  if (host.includes("workday") || href.includes("myworkdayjobs")) {
    return "workday";
  }
  return "generic";
}

function inferResumeFamily(rawUrl) {
  const value = rawUrl.toLowerCase();
  if (/(sdet|qa|quality|test|automation)/.test(value)) {
    return "sdet";
  }
  return "swe";
}

function inferCompanyName(parsedUrl) {
  const host = parsedUrl.hostname.replace(/^www\./, "");
  const segments = host.split(".");
  const primary = segments[0] || "Manual Company";
  return primary
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
    .join(" ");
}

function inferTitleFromUrl(parsedUrl) {
  const pathBits = parsedUrl.pathname.split("/").filter(Boolean).slice(-2);
  if (!pathBits.length) {
    return "Manual job intake";
  }
  return pathBits
    .join(" ")
    .replace(/[-_]/g, " ")
    .replace(/\bjobs?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || "Manual job intake";
}

function sourceLabelFor(parsedUrl, sourceType) {
  if (sourceType === "linkedin") {
    return "LinkedIn";
  }
  if (sourceType === "indeed") {
    return "Indeed";
  }
  return inferCompanyName(parsedUrl);
}

function restrictedBoardMessage(url) {
  try {
    const parsed = new URL(url);
    const sourceType = inferSourceType(parsed);
    if (sourceType === "linkedin" || sourceType === "indeed") {
      return "This URL is a discovery-board page. The assistant will open it locally, but you should hand off to the employer application page before continuing.";
    }
  } catch (_error) {
    return "";
  }
  return "";
}

function capitalize(value) {
  if (!value) {
    return "";
  }
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}
