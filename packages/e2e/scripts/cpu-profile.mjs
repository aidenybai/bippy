#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { runScenarios } from "./deopt-scenarios.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const E2E_ROOT = resolve(scriptDirectory, "..");
const REPO_ROOT = resolve(E2E_ROOT, "../..");
const OUTPUT_DIR = resolve(E2E_ROOT, "perf", process.env.PERF_LABEL ?? "current");

const APP_URL = process.env.CPU_PROFILE_APP_URL || "http://localhost:5180";
const SERVER_READY_TIMEOUT_MS = 60_000;

const log = (message) => console.log(`[cpu-profile] ${message}`);

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

const summarizeProfile = (profile) => {
  const nodesById = new Map(profile.nodes.map((node) => [node.id, node]));
  const selfTimeByNode = new Map();
  const sampleIntervalMicroseconds =
    profile.samples.length > 1 ? (profile.endTime - profile.startTime) / profile.samples.length : 0;
  for (const nodeId of profile.samples) {
    selfTimeByNode.set(nodeId, (selfTimeByNode.get(nodeId) ?? 0) + sampleIntervalMicroseconds);
  }
  const entries = [];
  for (const [nodeId, selfMicroseconds] of selfTimeByNode) {
    const node = nodesById.get(nodeId);
    if (!node) continue;
    const { functionName, url, lineNumber } = node.callFrame;
    entries.push({
      functionName: functionName || "(anonymous)",
      url,
      lineNumber,
      selfMs: Math.round(selfMicroseconds / 100) / 10,
    });
  }
  return entries.sort((first, second) => second.selfMs - first.selfMs);
};

const main = async () => {
  let serverProcess = null;
  const wasServerAlreadyRunning = await isServerReachable(APP_URL);
  if (!wasServerAlreadyRunning) {
    log("starting vite fixture app ...");
    serverProcess = spawn("pnpm", ["--filter", "@bippy/e2e-vite", "dev", "--port", "5180"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    if (!(await waitForServer(APP_URL, SERVER_READY_TIMEOUT_MS))) {
      serverProcess?.kill("SIGINT");
      throw new Error("fixture app dev server failed to start within timeout");
    }
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => log(`page error: ${error.message}`));
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

    const cdpSession = await context.newCDPSession(page);
    await cdpSession.send("Profiler.enable");
    await cdpSession.send("Profiler.setSamplingInterval", { interval: 100 });
    await cdpSession.send("Profiler.start");

    await runScenarios(page);

    const { profile } = await cdpSession.send("Profiler.stop");
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(resolve(OUTPUT_DIR, "scenarios.cpuprofile"), JSON.stringify(profile));

    const entries = summarizeProfile(profile);
    await writeFile(
      resolve(OUTPUT_DIR, "cpu-profile.summary.json"),
      JSON.stringify(entries.slice(0, 200), null, 2),
    );
    log(`wrote profile + summary to ${OUTPUT_DIR}`);
    log("top self-time frames (bippy only):");
    const bippyEntries = entries.filter((entry) => entry.url.includes("bippy"));
    for (const entry of bippyEntries.slice(0, 25)) {
      console.log(`  ${entry.selfMs}ms\t${entry.functionName}\t${entry.url}:${entry.lineNumber}`);
    }
    await page.close();
  } finally {
    await browser.close();
    if (serverProcess && !wasServerAlreadyRunning) serverProcess.kill("SIGINT");
  }
};

main().catch((error) => {
  console.error("[cpu-profile] fatal:", error);
  process.exit(1);
});
