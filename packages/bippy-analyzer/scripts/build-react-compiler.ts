import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

const REPOSITORY = "https://github.com/facebook/react.git";
const UPSTREAM_PATH = "compiler/packages/babel-plugin-react-compiler/src";
const PACKAGE_DIRECTORY = fileURLToPath(new URL("..", import.meta.url));
const PATCH_PATH = join(PACKAGE_DIRECTORY, "patches/react-compiler.patch");
const TARGET_DIRECTORY = join(PACKAGE_DIRECTORY, "src/react-compiler");
const STAMP_PATH = join(TARGET_DIRECTORY, ".stamp");
const EXCLUDED_DIRECTORY = "__tests__";
const REVISION_PATTERN = /facebook\/react@([0-9a-f]{40})/;
const HEADER_LINES = 2;

const readPatch = (): string => readFileSync(PATCH_PATH, "utf8");

const getRevision = (patch: string): string => {
  const revision = REVISION_PATTERN.exec(patch)?.[1];
  if (!revision)
    throw new Error(`${PATCH_PATH} must name the upstream revision as facebook/react@<sha>`);
  return revision;
};

const getPatchPreamble = (revision: string): string =>
  `Patches babel-plugin-react-compiler from facebook/react@${revision}.\n` +
  "Edit src/react-compiler, then run `pnpm build --save` to regenerate this file.\n\n";

const getHeader = (revision: string): string =>
  `// GENERATED from facebook/react@${revision.slice(0, 7)} and patches/react-compiler.patch. Edits\n` +
  "// here are lost on the next `pnpm build` unless recorded in the patch with `pnpm build --save`.\n";

const runGit = (directory: string, gitArguments: string[]): string =>
  execFileSync("git", ["-C", directory, ...gitArguments], { encoding: "utf8" }).trim();

const isGitSuccessful = (directory: string, gitArguments: string[]): boolean => {
  try {
    runGit(directory, gitArguments);
    return true;
  } catch {
    return false;
  }
};

const withCheckout = <Result>(callback: (directory: string) => Result): Result => {
  const directory = mkdtempSync(join(tmpdir(), "react-compiler-"));
  try {
    runGit(directory, ["init", "-q"]);
    runGit(directory, ["config", "user.name", "build"]);
    runGit(directory, ["config", "user.email", "build@localhost"]);
    runGit(directory, ["remote", "add", "origin", REPOSITORY]);
    runGit(directory, ["sparse-checkout", "set", "--no-cone", UPSTREAM_PATH]);
    return callback(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const checkoutRevision = (directory: string, revision: string): string => {
  runGit(directory, ["fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", revision]);
  const commit = runGit(directory, ["rev-parse", "FETCH_HEAD"]);
  runGit(directory, ["checkout", "-q", commit]);
  return commit;
};

const applyPatch = (directory: string, patch: string): string => {
  if (patch.includes("diff --git")) {
    runGit(directory, ["apply", `--directory=${UPSTREAM_PATH}`, PATCH_PATH]);
    runGit(directory, ["add", "-A"]);
    runGit(directory, ["commit", "-qm", "patch"]);
  }
  return runGit(directory, ["rev-parse", "HEAD"]);
};

const forEachSourceFile = (directory: string, callback: (path: string) => void): void => {
  for (const entry of readdirSync(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name.endsWith(".ts")) callback(join(entry.parentPath, entry.name));
  }
};

const copyToTarget = (upstreamDirectory: string, revision: string, stamp: string): void => {
  rmSync(TARGET_DIRECTORY, { recursive: true, force: true });
  cpSync(upstreamDirectory, TARGET_DIRECTORY, {
    recursive: true,
    filter: (source) => !source.split(/[\\/]/).includes(EXCLUDED_DIRECTORY),
  });
  const header = getHeader(revision);
  forEachSourceFile(TARGET_DIRECTORY, (path) =>
    writeFileSync(path, header + readFileSync(path, "utf8")),
  );
  writeFileSync(STAMP_PATH, stamp);
};

const getStamp = (patch: string): string => createHash("sha256").update(patch).digest("hex");

const build = (): void => {
  const patch = readPatch();
  const stamp = getStamp(patch);
  if (existsSync(STAMP_PATH) && readFileSync(STAMP_PATH, "utf8") === stamp) return;
  const revision = getRevision(patch);
  withCheckout((directory) => {
    checkoutRevision(directory, revision);
    applyPatch(directory, patch);
    copyToTarget(join(directory, UPSTREAM_PATH), revision, stamp);
  });
  console.log(`Built src/react-compiler from facebook/react@${revision.slice(0, 7)}`);
};

const save = (): void => {
  const revision = getRevision(readPatch());
  const diff = withCheckout((directory) => {
    checkoutRevision(directory, revision);
    const upstreamDirectory = join(directory, UPSTREAM_PATH);
    for (const entry of readdirSync(upstreamDirectory)) {
      if (entry !== EXCLUDED_DIRECTORY) rmSync(join(upstreamDirectory, entry), { recursive: true });
    }
    cpSync(TARGET_DIRECTORY, upstreamDirectory, {
      recursive: true,
      filter: (source) => source !== STAMP_PATH,
    });
    forEachSourceFile(upstreamDirectory, (path) => {
      if (path.includes(`/${EXCLUDED_DIRECTORY}/`)) return;
      const lines = readFileSync(path, "utf8").split("\n");
      if (lines[0]?.startsWith("// GENERATED from facebook/react@"))
        writeFileSync(path, lines.slice(HEADER_LINES).join("\n"));
    });
    runGit(directory, ["add", "-A", UPSTREAM_PATH]);
    return runGit(directory, ["diff", "--cached", `--relative=${UPSTREAM_PATH}`]);
  });
  const patch = getPatchPreamble(revision) + (diff === "" ? "" : `${diff}\n`);
  writeFileSync(PATCH_PATH, patch);
  writeFileSync(STAMP_PATH, getStamp(patch));
  console.log("Saved src/react-compiler's edits to patches/react-compiler.patch");
};

const upgrade = (target: string): void => {
  const patch = readPatch();
  const revision = getRevision(patch);
  withCheckout((directory) => {
    checkoutRevision(directory, revision);
    const patched = applyPatch(directory, patch);
    const commit = checkoutRevision(directory, target);
    const isClean =
      !patch.includes("diff --git") ||
      isGitSuccessful(directory, ["cherry-pick", "--no-commit", patched]);
    const conflicts = isClean ? "" : runGit(directory, ["diff", "--name-only", "--diff-filter=U"]);
    const upgradedPatch = patch.replace(REVISION_PATTERN, `facebook/react@${commit}`);
    writeFileSync(PATCH_PATH, upgradedPatch);
    copyToTarget(join(directory, UPSTREAM_PATH), commit, getStamp(upgradedPatch));
    if (isClean) {
      console.log(`Moved to facebook/react@${commit.slice(0, 7)}. Run \`pnpm build --save\`.`);
      return;
    }
    console.log(`Moved to facebook/react@${commit.slice(0, 7)}. Resolve these, then run --save:`);
    console.log(conflicts.replaceAll(`${UPSTREAM_PATH}/`, "  src/react-compiler/"));
    process.exitCode = 1;
  });
};

new Command()
  .name("build")
  .description(
    "Build src/react-compiler: babel-plugin-react-compiler's source at the revision patches/react-compiler.patch names, with that patch applied.",
  )
  .option("--save", "record the edits in src/react-compiler as the patch")
  .option("--upgrade <revision>", "move to another upstream revision, reapplying the patch")
  .action((options: { save?: boolean; upgrade?: string }) =>
    options.save ? save() : options.upgrade ? upgrade(options.upgrade) : build(),
  )
  .parse();
