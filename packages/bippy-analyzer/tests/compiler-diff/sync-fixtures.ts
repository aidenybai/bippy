import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync } from "@babel/core";

interface UpstreamManifest {
  repository: string;
  revision: string;
  path: string;
}

const FIXTURES_DIRECTORY = fileURLToPath(new URL("fixtures", import.meta.url));
const COMPILER_DIRECTORY = join(FIXTURES_DIRECTORY, "compiler");
const SOURCE_PATTERN = /\.(?:js|jsx|ts|tsx)$/;

const manifest: UpstreamManifest = JSON.parse(
  readFileSync(join(FIXTURES_DIRECTORY, "upstream.json"), "utf8"),
);

const runGit = (directory: string, gitArguments: string[]): string =>
  execFileSync("git", ["-C", directory, ...gitArguments], { encoding: "utf8" }).trim();

const isParseable = (fileName: string, code: string, plugins: Array<"typescript" | "jsx">) => {
  try {
    parseSync(code, {
      filename: fileName,
      babelrc: false,
      configFile: false,
      parserOpts: { plugins },
    });
    return true;
  } catch {
    return false;
  }
};

const checkoutDirectory = mkdtempSync(join(tmpdir(), "compiler-fixtures-"));
try {
  runGit(checkoutDirectory, ["init", "-q"]);
  runGit(checkoutDirectory, ["remote", "add", "origin", manifest.repository]);
  runGit(checkoutDirectory, ["sparse-checkout", "set", "--no-cone", manifest.path]);
  runGit(checkoutDirectory, [
    "fetch",
    "-q",
    "--depth",
    "1",
    "--filter=blob:none",
    "origin",
    manifest.revision,
  ]);
  runGit(checkoutDirectory, ["checkout", "-q", "FETCH_HEAD"]);

  rmSync(COMPILER_DIRECTORY, { recursive: true, force: true });
  const upstreamDirectory = join(checkoutDirectory, manifest.path);
  const trackedPaths = runGit(upstreamDirectory, ["ls-files", "."]).split("\n");
  let count = 0;
  for (const trackedPath of trackedPaths) {
    if (!SOURCE_PATTERN.test(trackedPath)) continue;
    const sourcePath = join(upstreamDirectory, trackedPath);
    const code = readFileSync(sourcePath, "utf8");
    // Flow fixtures need Hermes, which neither side parses with.
    if (code.includes("@flow") || !isParseable(sourcePath, code, ["typescript", "jsx"])) continue;
    // Upstream parses every fixture as TypeScript, but TypeScript parses `.js` as JavaScript.
    const isTypeScriptInJs = trackedPath.endsWith(".js") && !isParseable(sourcePath, code, ["jsx"]);
    const targetPath = join(
      COMPILER_DIRECTORY,
      isTypeScriptInJs ? trackedPath.replace(/\.js$/, ".tsx") : trackedPath,
    );
    mkdirSync(dirname(targetPath), { recursive: true });
    cpSync(sourcePath, targetPath);
    count++;
  }
  console.log(
    `Synced ${count} fixtures from ${manifest.revision} into ${relative(process.cwd(), COMPILER_DIRECTORY)}`,
  );
} finally {
  rmSync(checkoutDirectory, { recursive: true, force: true });
}
