import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getCorpusRoot, getProjects, image, type CorpusProject } from "./context.js";

const root = getCorpusRoot();
const label = process.argv[3] ?? "audit";
const installation = process.argv[4] ?? "install";
if (![label, installation].every((value) => /^[a-z0-9-]+$/.test(value)))
  throw new Error("Labels must use lowercase letters, digits, or hyphens");
const sourceHash = (directory: string, files: string[]) => {
  const hash = createHash("sha256");
  for (const file of files) {
    const path = join(directory, file);
    hash
      .update(file)
      .update("\0")
      .update(lstatSync(path).isSymbolicLink() ? readlinkSync(path) : readFileSync(path));
  }
  return hash.digest("hex");
};
const run = async (project: CorpusProject) => {
  const output = join(root, "reports", `${project.id}-${label}`);
  mkdirSync(output);
  const receipt = join(root, "reports", `${project.id}-${installation}.json`);
  const install = existsSync(receipt) ? JSON.parse(readFileSync(receipt, "utf8")) : undefined;
  if (install?.code !== 0) {
    writeFileSync(
      join(output, "run.json"),
      JSON.stringify(
        { project, status: "install-nonpass", installation: install ?? null },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }
  const directory = join(root, "projects", project.id);
  const revision = execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (revision !== project.revision) throw new Error(`${project.id}: revision mismatch`);
  execFileSync("git", ["-C", directory, "diff", "--exit-code", "HEAD"]);
  const files = execFileSync("git", ["-C", directory, "ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .sort();
  const before = sourceHash(directory, files);
  const projectFile = join(output, "metadata.json");
  const trackedFile = join(output, "tracked.json");
  writeFileSync(projectFile, JSON.stringify({ ...project, expectedSourceHash: before }));
  writeFileSync(trackedFile, JSON.stringify(files));
  const name = `bippy-resolver-test-${project.id}`;
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
    install.volume
      ? `type=volume,source=${install.volume},target=/project`
      : `type=bind,source=${directory},target=/project`,
    "--mount",
    `type=bind,source=${join(root, "tools")},target=/tools,readonly`,
    "--mount",
    `type=bind,source=${output},target=/reports`,
    "--mount",
    `type=bind,source=${projectFile},target=/project-metadata.json,readonly`,
    "--mount",
    `type=bind,source=${trackedFile},target=/tracked-files.json,readonly`,
    "--workdir",
    "/tools",
    "--env",
    "HOME=/tmp/home",
    "--env",
    `BIPPY_RESOLVER_REPORT_SUFFIX=${label}`,
    "--env",
    "NEXT_TELEMETRY_DISABLED=1",
    "--env",
    "RAYON_NUM_THREADS=2",
    image,
    "node",
    "/tools/node_modules/vite-plus/bin/vp",
    "test",
    "corpus/module-resolution/corpus.test.ts",
    "--pool=forks",
    "--maxWorkers=1",
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
    }, 150000);
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      log.end();
      const after = sourceHash(directory, files);
      writeFileSync(
        join(output, "run.json"),
        JSON.stringify(
          {
            project,
            image,
            code,
            signal,
            timedOut,
            elapsedMs: Date.now() - started,
            sourceBefore: before,
            sourceAfter: after,
            unchanged: before === after,
            args,
          },
          null,
          2,
        ),
      );
      if (code !== 0 || before !== after) process.exitCode = 1;
      console.log(project.id, code, timedOut, before === after);
      resolve();
    });
  });
};
const main = async () => {
  for (const project of getProjects(root)) await run(project);
};
void main();
