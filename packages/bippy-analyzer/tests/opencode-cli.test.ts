import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vite-plus/test";

const execute = promisify(execFile);
const packageDirectory = resolve(import.meta.dirname, "..");
const cliPath = join(packageDirectory, "scripts/opencode.ts");
const tsxPath = createRequire(join(packageDirectory, "package.json")).resolve("tsx/cli");
const createdDirectories: string[] = [];
const runCli = (...arguments_: string[]) =>
  execute(process.execPath, [tsxPath, cliPath, ...arguments_], { cwd: packageDirectory });

const createRun = async () => {
  const name = `test-${randomUUID()}`;
  const directory = join(packageDirectory, ".opencode-audits", name);
  createdDirectories.push(directory);
  await mkdir(join(directory, "replies"), { recursive: true });
  return { name, directory };
};

afterEach(async () => {
  await Promise.all(
    createdDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("OpenCode audit CLI controls", () => {
  it("shows help without starting a host", async () => {
    expect((await runCli("--help")).stdout).toContain("approve|reject");
  });

  it.each(["../escape", "private", "/absolute", "Name"])(
    "rejects unsafe run name %s",
    async (name) => {
      await expect(runCli("status", name)).rejects.toMatchObject({ code: 1 });
    },
  );

  it("reads saved status without starting a host", async () => {
    const { name, directory } = await createRun();
    await writeFile(join(directory, "status.json"), JSON.stringify({ isRunning: false }));
    expect(JSON.parse((await runCli("status", name)).stdout)).toEqual({ isRunning: false });
  });

  it("queues one-time approvals, rejections, and aborts", async () => {
    const { name, directory } = await createRun();
    await runCli("approve", name, "per_approved");
    await runCli("reject", name, "per_rejected");
    await runCli("abort", name);
    expect(await readFile(join(directory, "replies", "per_approved"), "utf8")).toBe("once");
    expect(await readFile(join(directory, "replies", "per_rejected"), "utf8")).toBe("reject");
    expect(await readFile(join(directory, "abort"), "utf8")).toBe("");
  });

  it("rejects request path traversal and extra arguments", async () => {
    const { name } = await createRun();
    await expect(runCli("approve", name, "../escape")).rejects.toMatchObject({ code: 1 });
    await expect(runCli("status", name, "extra")).rejects.toMatchObject({ code: 1 });
  });
});
