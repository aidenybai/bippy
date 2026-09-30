import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { buildBundle } from "./build-bundle.js";
import { EngineBuildCleanupError, EngineBuildError, EngineCleanupError } from "../errors.js";
import { getFileHashes } from "../files.js";
import {
  engineDirectory,
  getBuildIdentity,
  outputDirectory,
  upstreamDirectory,
  verifyEngineBuild,
  type EngineBuildManifest,
} from "../manifest.js";

const buildDirectory = join(engineDirectory, ".build");
const sourceDirectory = join(buildDirectory, "source");
const stagingDirectory = join(buildDirectory, "output");
const lockDirectory = join(buildDirectory, "lock");

const build = async (): Promise<void> => {
  const identity = await getBuildIdentity();
  if (!process.argv.includes("--force")) {
    try {
      await verifyEngineBuild();
      console.log("Engine build is current");
      return;
    } catch {}
  }
  await mkdir(buildDirectory, { recursive: true });
  try {
    await mkdir(lockDirectory);
  } catch (cause) {
    throw new EngineBuildError("Cannot acquire engine build lock; another build may be running", {
      cause,
    });
  }
  let failure: unknown;
  let isFailed = false;
  try {
    await rm(sourceDirectory, { recursive: true, force: true });
    await rm(stagingDirectory, { recursive: true, force: true });
    await mkdir(sourceDirectory, { recursive: true });
    await mkdir(stagingDirectory, { recursive: true });
    await cp(join(upstreamDirectory, "src"), join(sourceDirectory, "src"), { recursive: true });
    await cp(
      join(engineDirectory, "extensions"),
      join(sourceDirectory, "src/host-defined/control"),
      { recursive: true },
    );
    await mkdir(join(sourceDirectory, "lib"));
    await cp(
      join(upstreamDirectory, "lib/test262-harness.json"),
      join(sourceDirectory, "lib/test262-harness.json"),
    );
    const repositoryDirectory = resolve(engineDirectory, "../../..");
    for (const name of [
      "evaluation-hook.patch",
      "typecheck.patch",
      "string-substr.patch",
      "simple-parameters.patch",
      "lazy-argument-accessors.patch",
      "unused-arguments.patch",
      "object-checkpoint.patch",
      "declarative-roots.patch",
      "binding-checkpoint.patch",
      "control-machine.patch",
      "collection-roots.patch",
      "indexed-internal-lists.patch",
      "abstract-number.patch",
      "boolean-decision.patch",
      "boolean-expressions.patch",
      "number-predicates.patch",
      "ephemeron-roots.patch",
      "suspended-control-roots.patch",
      "host-job-roots.patch",
      "promise-roots.patch",
      "agent-decisions.patch",
      "array-checkpoints.patch",
      "collection-checkpoints.patch",
      "set-zero.patch",
      "promise-all-roots.patch",
      "promise-combinator-roots.patch",
      "promise-finally-roots.patch",
      "evaluation-checkpoints.patch",
      "function-checkpoints.patch",
      "data-graph-checkpoints.patch",
      "owner-storage-capture.patch",
      "constructor-checkpoints.patch",
      "builtin-checkpoints.patch",
      "global-checkpoints.patch",
      "arguments-checkpoints.patch",
      "intrinsic-checkpoints.patch",
      "error-checkpoints.patch",
      "regexp-checkpoints.patch",
      "weak-map-checkpoints.patch",
      "context-checkpoints.patch",
      "checkpoint-host-effects.patch",
      "web-queue-checkpoints.patch",
      "job-queue-checkpoints.patch",
      "host-state-roots.patch",
      "builtin-capture-edges.patch",
      "native-capture-registration.patch",
      "native-capture-roots.patch",
      "reference-checkpoints.patch",
      "native-list-checkpoints.patch",
      "checkpoint-nondeterminism.patch",
      "descriptor-checkpoints.patch",
      "descriptor-initializers.patch",
      "checkpoint-module-effects.patch",
      "pending-module-loads.patch",
      "module-load-roots.patch",
      "module-cache-roots.patch",
      "template-cache-roots.patch",
      "callable-captures.patch",
      "iterator-record-checkpoints.patch",
      "script-syntax-regions.patch",
      "numeric-parity.patch",
    ])
      execFileSync(
        "git",
        [
          "apply",
          "--unidiff-zero",
          `--directory=${relative(repositoryDirectory, sourceDirectory)}`,
          join(engineDirectory, "patches", name),
        ],
        { cwd: repositoryDirectory, timeout: 30000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" },
      );
    execFileSync("tsgo", ["--project", join(engineDirectory, "tsconfig.json")], {
      cwd: engineDirectory,
      timeout: 120000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: "pipe",
      encoding: "utf8",
    });
    await buildBundle(sourceDirectory, stagingDirectory);
    await cp(join(engineDirectory, "vendor/LICENSE"), join(stagingDirectory, "LICENSE"));
    await cp(
      join(engineDirectory, "extensions/LICENSE"),
      join(stagingDirectory, "CONTROL-LICENSE"),
    );
    const manifest: EngineBuildManifest = {
      format: 1,
      ...identity,
      nodeVersion: process.versions.node,
      outputs: await getFileHashes(stagingDirectory),
    };
    await writeFile(
      join(stagingDirectory, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    await verifyEngineBuild(stagingDirectory);
    const previousDirectory = join(buildDirectory, "previous");
    await rm(previousDirectory, { recursive: true, force: true });
    let hasPrevious = false;
    try {
      await readFile(join(outputDirectory, "manifest.json"));
      hasPrevious = true;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    if (hasPrevious) await rename(outputDirectory, previousDirectory);
    else await rm(outputDirectory, { recursive: true, force: true });
    try {
      await rename(stagingDirectory, outputDirectory);
    } catch (error) {
      if (hasPrevious) {
        try {
          await rename(previousDirectory, outputDirectory);
        } catch (cleanupError) {
          throw new EngineBuildCleanupError(error, cleanupError);
        }
      }
      throw error;
    }
    await rm(previousDirectory, { recursive: true, force: true });
    console.log(`Built engine262 from source: ${manifest.outputs["engine.mjs"]}`);
  } catch (error) {
    isFailed = true;
    failure = error;
  }
  const cleanupFailures: unknown[] = [];
  for (const directory of [sourceDirectory, stagingDirectory, lockDirectory]) {
    try {
      await rm(directory, { recursive: true, force: true });
    } catch (error) {
      cleanupFailures.push(error);
    }
  }
  if (cleanupFailures.length) {
    const cleanupFailure = new EngineCleanupError(cleanupFailures);
    if (isFailed) throw new EngineBuildCleanupError(failure, cleanupFailure);
    throw cleanupFailure;
  }
  if (isFailed) throw failure;
};

await build();
