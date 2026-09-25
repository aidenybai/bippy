import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCorpusRoot, getProjects, image } from "./context.js";

const root = getCorpusRoot();
const namespace = createHash("sha256").update(root).digest("hex").slice(0, 12);
const run = async (id: string, command: string[], volume?: string) => {
  const directory = join(root, id === "tools" ? "tools" : `projects/${id}`);
  if (existsSync(join(root, "reports", `${id}-install.json`)))
    throw new Error(`${id}: installation receipt already exists`);
  if (volume) {
    execFileSync("docker", ["volume", "create", volume]);
    const archive = execFileSync("git", ["-C", directory, "archive", "HEAD"], {
      maxBuffer: 128 * 1024 * 1024,
    });
    execFileSync(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--mount",
        `type=volume,source=${volume},target=/project`,
        "-i",
        image,
        "tar",
        "-xf",
        "-",
        "-C",
        "/project",
      ],
      { input: archive },
    );
  }
  const name = `bippy-resolver-${namespace}-${id}`;
  const args = [
    "run",
    "--rm",
    "--name",
    name,
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
    "--mount",
    volume
      ? `type=volume,source=${volume},target=/project`
      : `type=bind,source=${directory},target=/project`,
    "--workdir",
    "/project",
    "--env",
    "HOME=/tmp/home",
    "--env",
    "CI=1",
    image,
    ...command,
  ];
  const log = createWriteStream(join(root, "reports", `${id}-install.log`), { flags: "wx" });
  const started = Date.now();
  let timedOut = false;
  await new Promise<void>((resolve, reject) => {
    const child = spawn("docker", args);
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const timer = setTimeout(() => {
      timedOut = true;
      spawn("docker", ["kill", name]);
    }, 240000);
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      log.end();
      writeFileSync(
        join(root, "reports", `${id}-install.json`),
        JSON.stringify(
          {
            id,
            image,
            command,
            args,
            volume,
            code,
            signal,
            timedOut,
            elapsedMs: Date.now() - started,
          },
          null,
          2,
        ),
      );
      if (code !== 0) process.exitCode = 1;
      console.log(id, code, timedOut);
      resolve();
    });
  });
};

const main = async () => {
  await run("tools", ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
  for (const project of getProjects(root)) {
    const directory = join(root, "projects", project.id);
    const command =
      project.id === "zustand-demo"
        ? ["npx", "--yes", "pnpm@11.3.0", "install", "--frozen-lockfile", "--ignore-scripts"]
        : existsSync(join(directory, "pnpm-lock.yaml"))
          ? ["npx", "--yes", "pnpm@10.12.1", "install", "--frozen-lockfile", "--ignore-scripts"]
          : existsSync(join(directory, "package-lock.json"))
            ? ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"]
            : existsSync(join(directory, "yarn.lock"))
              ? [
                  "npx",
                  "--yes",
                  "yarn@1.22.22",
                  "install",
                  "--frozen-lockfile",
                  "--ignore-scripts",
                  "--non-interactive",
                ]
              : ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"];
    await run(project.id, command, `bippy-resolver-${namespace}-${project.id}`);
  }
};
void main();
