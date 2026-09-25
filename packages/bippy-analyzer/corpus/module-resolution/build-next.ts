import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCorpusRoot, getProjects, image, type CorpusProject } from "./context.js";

const root = getCorpusRoot();
const label = process.argv[3] ?? "native-build";
const installation = process.argv[4] ?? "install";
if (![label, installation].every((value) => /^[a-z0-9-]+$/.test(value)))
  throw new Error("Labels must use lowercase letters, digits, or hyphens");
const run = async (project: CorpusProject) => {
  const install = JSON.parse(
    readFileSync(join(root, "reports", `${project.id}-${installation}.json`), "utf8"),
  );
  const output = join(root, "reports", `${project.id}-${label}`);
  mkdirSync(output);
  if (install.code !== 0 || !install.volume) {
    writeFileSync(
      join(output, "run.json"),
      JSON.stringify({ project, status: "install-nonpass", installation: install }, null, 2),
    );
    process.exitCode = 1;
    return;
  }
  const name = `bippy-next-build-${project.id}`;
  const command = [
    "node",
    "node_modules/next/dist/bin/next",
    "build",
    "--turbopack",
    "--experimental-build-mode",
    "compile",
    ...(project.id === "invoify" ? ["--no-lint"] : []),
  ];
  const args = [
    "run",
    "--rm",
    "--name",
    name,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "256",
    "--memory",
    "2g",
    "--cpus",
    "2",
    "--tmpfs",
    "/tmp:rw,nosuid,size=512m",
    "--mount",
    `type=volume,source=${install.volume},target=/project`,
    "--workdir",
    "/project",
    "--env",
    "HOME=/tmp/home",
    "--env",
    "NEXT_TELEMETRY_DISABLED=1",
    "--env",
    "RAYON_NUM_THREADS=2",
    image,
    ...command,
  ];
  const log = createWriteStream(join(output, "run.log"), { flags: "wx" });
  const started = Date.now();
  let timedOut = false;
  await new Promise<void>((resolve, reject) => {
    const child = spawn("docker", args);
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const timer = setTimeout(() => {
      timedOut = true;
      spawn("docker", ["kill", name]);
    }, 120000);
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      log.end();
      writeFileSync(
        join(output, "run.json"),
        JSON.stringify(
          {
            project,
            image,
            command,
            args,
            code,
            signal,
            timedOut,
            elapsedMs: Date.now() - started,
            scope: "Native Next CLI compile mode, not application acceptance",
          },
          null,
          2,
        ),
      );
      if (code !== 0) process.exitCode = 1;
      console.log(project.id, code, timedOut);
      resolve();
    });
  });
};
const main = async () => {
  for (const project of getProjects(root).filter((project) => project.toolchain === "next"))
    await run(project);
};
void main();
