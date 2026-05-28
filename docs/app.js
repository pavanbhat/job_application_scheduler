const storageKey = "job-scheduler-tracker-v2";
const trackedStatuses = ["applied", "replied", "interviewing", "rejected", "offer"];
const responseStatuses = ["replied", "interviewing", "rejected", "offer"];
const positiveStatuses = ["interviewing", "offer"];

const state = {
  payload: null,
  trackerMap: new Map(),
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
};

boot();

async function boot() {
  const response = await fetch("./data/site_data.json", { cache: "no-store" });
  state.payload = await response.json();
  hydrateTrackerMap(state.payload);
  populateHeader(state.payload);
  populateSourceFilter(state.payload.jobs);
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
  els.importTracker.addEventListener("click", () => els.importTrackerFile.click());
  els.importTrackerFile.addEventListener("change", importTracker);
  els.exportTracker.addEventListener("click", exportTracker);
  els.clearTracker.addEventListener("click", clearLocalTracker);
  els.inspectorStatus.addEventListener("change", updateInspectorTracker);
  els.inspectorLastContact.addEventListener("change", updateInspectorTracker);
  els.inspectorNotes.addEventListener("input", updateInspectorTracker);
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
  return state.payload.jobs.map((job) => {
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

  fillList(els.inspectorHighlights, job.tailoring?.resume_highlights ?? []);
  fillList(els.inspectorRewrites, job.tailoring?.rewrite_suggestions ?? []);
  els.inspectorRecruiter.textContent = job.tailoring?.outreach_message?.recruiter || "";
  els.inspectorManager.textContent = job.tailoring?.outreach_message?.hiring_manager || "";
  fillInspectorChips(job);
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

function clearLocalTracker() {
  localStorage.removeItem(storageKey);
  hydrateTrackerMap(state.payload);
  render();
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

function capitalize(value) {
  if (!value) {
    return "";
  }
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}
