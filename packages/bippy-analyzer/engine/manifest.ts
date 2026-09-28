import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import source from "./source.json" with { type: "json" };
import { EngineBuildError } from "./errors.js";
import { getFileHashes, getHash, getTreeHash } from "./files.js";

export const engineDirectory = fileURLToPath(new URL(".", import.meta.url));
export const outputDirectory = join(engineDirectory, "dist");
const require = createRequire(import.meta.url);
export const upstreamDirectory = dirname(dirname(require.resolve("@engine262/engine262")));

export interface EngineBuildIdentity {
  upstreamRevision: string;
  publishedBundleSha256: string;
  sourceSha256: string;
  inputSha256: string;
}

export interface EngineBuildManifest extends EngineBuildIdentity {
  format: 1;
  nodeVersion: string;
  outputs: Record<string, string>;
}

interface UnknownRecord {
  [key: string]: unknown;
}
const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isHash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const isHashRecord = (value: unknown): value is Record<string, string> =>
  isRecord(value) &&
  Object.entries(value).every(
    ([name, hash]) =>
      !name.startsWith("/") &&
      !name.includes("\\") &&
      !name.split("/").some((part) => part === ".." || part === ".") &&
      isHash(hash),
  );

const getToolMetadata = async (name: string): Promise<string> => {
  let directory: string;
  try {
    return await readFile(require.resolve(`${name}/package.json`), "utf8");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED"
    )
      throw error;
    directory = dirname(require.resolve(name));
  }
  while (dirname(directory) !== directory) {
    try {
      const content = await readFile(join(directory, "package.json"), "utf8");
      const metadata: unknown = JSON.parse(content);
      if (isRecord(metadata) && metadata.name === name) return content;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    directory = dirname(directory);
  }
  throw new EngineBuildError(`Cannot identify installed engine build tool: ${name}`);
};

export const getBuildIdentity = async (): Promise<EngineBuildIdentity> => {
  const sourceHashes = await getFileHashes(join(upstreamDirectory, "src"));
  const sourceSha256 = getTreeHash(sourceHashes);
  const publishedBundleSha256 = getHash(
    await readFile(join(upstreamDirectory, "lib/engine262.mjs")),
  );
  if (
    sourceSha256 !== source.sourceSha256 ||
    publishedBundleSha256 !== source.publishedBundleSha256
  )
    throw new EngineBuildError(
      "Installed engine262 source or bundle differs from the pinned baseline",
    );
  if (
    getHash(await readFile(join(engineDirectory, "vendor/transform.mts"))) !==
    source.transformSha256
  )
    throw new EngineBuildError("Upstream engine262 macro transform differs from its pinned source");
  const harnessSha256 = getHash(
    await readFile(join(upstreamDirectory, "lib/test262-harness.json")),
  );
  if (harnessSha256 !== source.harnessSha256)
    throw new EngineBuildError("Published Test262 harness data differs from its pinned bytes");
  const packageMetadata: unknown = JSON.parse(
    await readFile(join(upstreamDirectory, "package.json"), "utf8"),
  );
  if (!isRecord(packageMetadata) || packageMetadata.version !== source.packageVersion)
    throw new EngineBuildError(
      "Installed engine262 package version differs from the pinned version",
    );
  const inputs: Record<string, string> = {
    upstreamSource: sourceSha256,
    upstreamBundle: publishedBundleSha256,
    upstreamHarness: harnessSha256,
  };
  for (const name of ["scripts", "patches", "vendor"])
    Object.assign(inputs, await getFileHashes(join(engineDirectory, name), `${name}/`));
  for (const name of (await readdir(engineDirectory)).filter(
    (name) => name.endsWith(".ts") || name.endsWith(".json"),
  ))
    inputs[name] = getHash(await readFile(join(engineDirectory, name)));
  const packageContent = await readFile(join(engineDirectory, "../package.json"), "utf8");
  inputs["analyzer-package.json"] = getHash(packageContent);
  const packageManifest: unknown = JSON.parse(packageContent);
  if (!isRecord(packageManifest) || !isRecord(packageManifest.devDependencies))
    throw new EngineBuildError("Missing engine toolchain dependencies");
  for (const name of [
    "@babel/core",
    "@babel/plugin-proposal-decorators",
    "@babel/preset-typescript",
    "@rollup/plugin-commonjs",
    "@rollup/plugin-json",
    "@rollup/plugin-node-resolve",
    "@typescript/native-preview",
    "@types/node",
    "@unicode/unicode-17.0.0",
    "devtools-protocol",
    "jsbd",
    "rollup",
    "tsx",
  ]) {
    const content = await getToolMetadata(name);
    const installed: unknown = JSON.parse(content);
    const expected = packageManifest.devDependencies[name];
    if (
      !isRecord(installed) ||
      typeof installed.version !== "string" ||
      typeof expected !== "string" ||
      (/^\d/.test(expected) && installed.version !== expected)
    )
      throw new EngineBuildError(`Unexpected engine build tool version: ${name}`);
    inputs[`tool:${name}`] = getHash(content);
  }
  inputs["pnpm-lock.yaml"] = getHash(
    await readFile(resolve(engineDirectory, "../../../pnpm-lock.yaml")),
  );
  return {
    upstreamRevision: source.revision,
    publishedBundleSha256,
    sourceSha256,
    inputSha256: getTreeHash(inputs),
  };
};

export const readBuildManifest = async (
  directory = outputDirectory,
): Promise<EngineBuildManifest> => {
  const value: unknown = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  if (
    !isRecord(value) ||
    value.format !== 1 ||
    typeof value.upstreamRevision !== "string" ||
    !isHash(value.publishedBundleSha256) ||
    !isHash(value.sourceSha256) ||
    !isHash(value.inputSha256) ||
    typeof value.nodeVersion !== "string" ||
    !isHashRecord(value.outputs)
  )
    throw new EngineBuildError("Invalid engine build manifest");
  for (const name of ["engine.mjs", "engine.mjs.map", "declaration/index.d.mts", "LICENSE"])
    if (!(name in value.outputs))
      throw new EngineBuildError(`Missing engine build artifact: ${name}`);
  return {
    format: 1,
    upstreamRevision: value.upstreamRevision,
    publishedBundleSha256: value.publishedBundleSha256,
    sourceSha256: value.sourceSha256,
    inputSha256: value.inputSha256,
    nodeVersion: value.nodeVersion,
    outputs: value.outputs,
  };
};

export const verifyEngineBuild = async (
  directory = outputDirectory,
): Promise<EngineBuildManifest> => {
  const [identity, manifest] = await Promise.all([
    getBuildIdentity(),
    readBuildManifest(directory),
  ]);
  for (const key of [
    "upstreamRevision",
    "publishedBundleSha256",
    "sourceSha256",
    "inputSha256",
  ] satisfies (keyof EngineBuildIdentity)[])
    if (manifest[key] !== identity[key])
      throw new EngineBuildError(
        "Engine build is stale; run pnpm --filter bippy-analyzer build:engine",
      );
  const outputs = await getFileHashes(directory);
  delete outputs["manifest.json"];
  if (getTreeHash(outputs) !== getTreeHash(manifest.outputs))
    throw new EngineBuildError(
      "Engine build artifacts differ from their manifest; rebuild the engine",
    );
  return manifest;
};
