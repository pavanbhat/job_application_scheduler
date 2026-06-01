const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const port = Number.parseInt(process.env.JOB_SCHEDULER_ASSISTANT_PORT || "4173", 10);
const rootDir = path.resolve(__dirname, "..");
const artifactsDir = path.join(rootDir, "data", "assistant_artifacts", "runs");
const workerScript = path.join(__dirname, "run_worker.sh");

fs.mkdirSync(artifactsDir, { recursive: true });

const server = http.createServer(async (req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/api/automation/health") {
    writeJson(res, 200, { ok: true, port });
    return;
  }

  if (req.method === "POST" && req.url === "/api/automation/start") {
    try {
      const body = await readJson(req);
      const job = body.job || {};
      if (!job.url) {
        writeJson(res, 400, { error: "Missing job.url" });
        return;
      }
      const runId = `${job.job_id || "manual"}-${Date.now()}`;
      const logPath = path.join(artifactsDir, `${runId}.log`);
      const logStream = fs.createWriteStream(logPath, { flags: "a" });
      const args = buildWorkerArgs(job);
      const child = spawn(workerScript, args, {
        cwd: rootDir,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout.pipe(logStream);
      child.stderr.pipe(logStream);
      child.unref();
      writeJson(res, 202, {
        ok: true,
        run_id: runId,
        log_path: logPath,
        message: `Local automation started for ${job.company || "manual job"} | ${job.title || job.url}`,
      });
      return;
    } catch (error) {
      writeJson(res, 500, { error: error.message });
      return;
    }
  }

  writeJson(res, 404, { error: "Not found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Job scheduler assistant bridge listening on http://127.0.0.1:${port}`);
});

function buildWorkerArgs(job) {
  const args = ["review", "--prefill"];
  if (job.job_id && !String(job.job_id).startsWith("manual-")) {
    args.push("--job", String(job.job_id));
  } else {
    args.push("--url", String(job.url));
    args.push("--title", String(job.title || "Manual job intake"));
    args.push("--company", String(job.company || "Manual Company"));
    args.push("--source", String(job.source || job.company || "Manual Company"));
    args.push("--source-type", String(job.source_type || "generic"));
    args.push("--resume-family", String(job.resume_family || "swe"));
  }
  if (job.automation_recommendation?.lane) {
    args.push("--lane", String(job.automation_recommendation.lane));
  }
  return args;
}

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(payload)}\n`);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}
