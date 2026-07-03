#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { runScenarios } from "./deopt-scenarios.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const E2E_ROOT = resolve(scriptDirectory, "..");
const REPO_ROOT = resolve(E2E_ROOT, "../..");
const OUTPUT_DIR = resolve(E2E_ROOT, "perf", process.env.PERF_LABEL ?? "current");

const APP_URL = process.env.DEOPT_TRACE_APP_URL || "http://localhost:5180";
const SERVER_READY_TIMEOUT_MS = 60_000;
const CDP_READY_TIMEOUT_MS = 20_000;

const log = (message) => console.log(`[deopt] ${message}`);

const isServerReachable = async (url) => {
  try {
    const response = await fetch(url);
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
};

const waitForServer = async (url, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerReachable(url)) return true;
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 200));
  }
  return false;
};

const startDevServer = () => {
  log("starting vite fixture app (pnpm --filter @bippy/e2e-vite dev --port 5180) ...");
  const child = spawn("pnpm", ["--filter", "@bippy/e2e-vite", "dev", "--port", "5180"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  child.stderr?.on("data", (chunk) => process.stderr.write(`[dev] ${chunk}`));
  return child;
};

const findFreePort = () =>
  new Promise((resolvePromise, rejectPromise) => {
    const server = net.createServer();
    server.unref();
    server.on("error", rejectPromise);
    server.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePromise(port));
    });
  });

const launchChromeWithDeoptTrace = async () => {
  const chromeBinary = process.env.CHROME_BINARY || chromium.executablePath();
  if (!chromeBinary || !existsSync(chromeBinary)) {
    throw new Error(
      `chromium binary not found (resolved: ${chromeBinary ?? "<unset>"}); set CHROME_BINARY or run \`npx playwright install chromium\``,
    );
  }
  const port = await findFreePort();
  const userDataDir = resolve(process.env.TMPDIR ?? "/tmp", `bippy-deopt-profile-${Date.now()}`);
  const jsFlags = "--trace-deopt --trace-deopt-verbose --log-deopt --code-comments";
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--disable-gpu",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-dev-shm-usage",
    `--js-flags=${jsFlags}`,
    "about:blank",
  ];
  await mkdir(userDataDir, { recursive: true });
  // cwd matters: --log-deopt makes V8 drop isolate-*-v8.log files into the
  // Chrome process's cwd, so point it at the throwaway profile dir.
  const child = spawn(chromeBinary, args, {
    cwd: userDataDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  const outputChunks = [];
  child.stdout?.on("data", (chunk) => outputChunks.push(chunk.toString()));
  child.stderr?.on("data", (chunk) => outputChunks.push(chunk.toString()));
  const cdpUrl = `http://127.0.0.1:${port}/json/version`;
  const deadline = Date.now() + CDP_READY_TIMEOUT_MS;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    try {
      const response = await fetch(cdpUrl);
      ready = response.ok;
    } catch {}
    if (!ready) await new Promise((resolveTimer) => setTimeout(resolveTimer, 100));
  }
  if (!ready) {
    try {
      child.kill("SIGKILL");
    } catch {}
    throw new Error("chrome CDP endpoint not reachable in time");
  }
  log(`chrome ready on port ${port}`);
  return { child, port, getOutput: () => outputChunks.join("") };
};

const parseDeopts = (outputText) => {
  const lines = outputText.split(/\r?\n/);
  const deoptLines = lines.filter(
    (line) =>
      (line.startsWith("[deoptimizing") || line.startsWith("[bailout")) &&
      !line.startsWith("[bailout end") &&
      !line.startsWith("[deoptimizing end"),
  );
  const grouped = new Map();
  for (const line of deoptLines) {
    const reasonMatch = line.match(/reason: (.*?)\): begin/) || line.match(/reason: ([^,\])]+)/);
    const fnMatch =
      line.match(/<JSFunction ([^ ]+)\s+\(sfi = ([^)]+)\)>/) || line.match(/<JSFunction ([^>]+)>/);
    const kindMatch = line.match(/kind:\s*([A-Za-z-]+)/);
    const eventType = line.startsWith("[deoptimizing") ? "deopt" : "bailout";
    const key = [
      eventType,
      kindMatch ? kindMatch[1] : "?",
      reasonMatch ? reasonMatch[1].trim() : "(unknown)",
      fnMatch ? fnMatch[1] : "(anonymous)",
    ].join("|");
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  const summary = Array.from(grouped.entries())
    .map(([key, count]) => {
      const [eventType, kind, reason, functionName] = key.split("|");
      return { eventType, kind, reason, functionName, count };
    })
    .sort((first, second) => second.count - first.count);
  return { totalDeoptLines: deoptLines.length, deoptLines, summary };
};

const main = async () => {
  let serverProcess = null;
  const wasServerAlreadyRunning = await isServerReachable(APP_URL);
  if (!wasServerAlreadyRunning) {
    serverProcess = startDevServer();
    if (!(await waitForServer(APP_URL, SERVER_READY_TIMEOUT_MS))) {
      serverProcess?.kill("SIGINT");
      throw new Error("fixture app dev server failed to start within timeout");
    }
    log("fixture app dev server ready");
  } else {
    log("fixture app dev server already running, reusing");
  }

  const chromeHandle = await launchChromeWithDeoptTrace();
  try {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${chromeHandle.port}`);
    const context =
      browser.contexts()[0] ??
      (await browser.newContext({ viewport: { width: 1280, height: 720 } }));
    const page = await context.newPage();
    page.on("pageerror", (error) => log(`page error: ${error.message}`));
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    await runScenarios(page);
    await page.close();
    await browser.close();
  } finally {
    try {
      chromeHandle.child.stdout?.destroy();
      chromeHandle.child.stderr?.destroy();
      chromeHandle.child.kill("SIGKILL");
    } catch {}
    if (serverProcess && !wasServerAlreadyRunning) serverProcess.kill("SIGINT");
  }

  const outputText = chromeHandle.getOutput();
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(resolve(OUTPUT_DIR, "deopt.stderr.log"), outputText);
  const { totalDeoptLines, deoptLines, summary } = parseDeopts(outputText);
  await writeFile(
    resolve(OUTPUT_DIR, "deopt.summary.json"),
    JSON.stringify({ totalDeoptLines, uniqueSites: summary.length, summary }, null, 2),
  );
  await writeFile(resolve(OUTPUT_DIR, "deopt.lines.log"), deoptLines.join("\n"));
  log(`wrote ${totalDeoptLines} deopt lines (${summary.length} unique sites) to ${OUTPUT_DIR}`);
  if (summary.length > 0) {
    log("top deopt sites:");
    for (const entry of summary.slice(0, 20)) {
      console.log(
        `  x${entry.count}\t${entry.eventType}\t${entry.kind}\tfn=${entry.functionName}\treason=${entry.reason}`,
      );
    }
  }
};

main().catch((error) => {
  console.error("[deopt] fatal:", error);
  process.exit(1);
});
