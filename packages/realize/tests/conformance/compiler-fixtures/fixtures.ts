import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { extname, join } from "node:path";
import { parseSync } from "@babel/core";
import { CACHE_DIRECTORY, PACKAGE_DIRECTORY } from "../runner/repos";

interface FixtureSource {
  repository: string;
  revision: string;
  fixtures: string;
  runtime: string;
}

export interface Fixture {
  name: string;
  file: string;
  entry: string | null;
  output: string | null;
  isSequential: boolean;
  error: string | null;
}

const EVAL_OUTPUT_SEPARATOR = "\n### Eval output\n";
const OK_PREFIX = "(kind: ok) ";
const ENTRY_PATTERN = /FIXTURE_ENTRYPOINT\s*=\s*\{\s*fn:\s*([A-Za-z_$][\w$]*)/;
const SHARED_RUNTIME_PATTERN = /(["'])shared-runtime\1/g;
const SOURCE_EXTENSIONS = new Map([
  [".js", ".jsx"],
  [".jsx", ".jsx"],
  [".ts", ".tsx"],
  [".tsx", ".tsx"],
]);
const PROJECT_TSCONFIG = {
  compilerOptions: {
    jsx: "react-jsx",
    strict: true,
    allowJs: true,
    checkJs: false,
    module: "esnext",
    moduleResolution: "bundler",
    target: "es2022",
    noEmit: true,
    skipLibCheck: true,
  },
  include: ["src"],
};

const SOURCE = JSON.parse(
  readFileSync(join(import.meta.dirname, "source.json"), "utf8"),
) as FixtureSource;

const CHECKOUT_DIRECTORY = join(CACHE_DIRECTORY, "react-compiler-fixtures");
export const PROJECT_DIRECTORY = join(CACHE_DIRECTORY, "react-compiler-fixtures-project");

const git = (...args: string[]): string =>
  execFileSync("git", ["-C", CHECKOUT_DIRECTORY, ...args], { encoding: "utf8" }).trim();

const ensureCheckout = (): void => {
  const isCurrent =
    existsSync(join(CHECKOUT_DIRECTORY, ".git")) && git("rev-parse", "HEAD") === SOURCE.revision;
  if (isCurrent) return;
  rmSync(CHECKOUT_DIRECTORY, { recursive: true, force: true });
  mkdirSync(CHECKOUT_DIRECTORY, { recursive: true });
  git("init", "--quiet");
  git("remote", "add", "origin", SOURCE.repository);
  git("sparse-checkout", "set", SOURCE.fixtures, SOURCE.runtime);
  git("fetch", "--quiet", "--depth", "1", "--filter=blob:none", "origin", SOURCE.revision);
  git("checkout", "--quiet", "FETCH_HEAD");
};

const getParseError = (file: string, code: string): string | null => {
  try {
    parseSync(code, {
      filename: file,
      babelrc: false,
      configFile: false,
      parserOpts: { plugins: ["typescript", "jsx"] },
    });
    return null;
  } catch (error) {
    return error instanceof Error ? (error.message.split("\n")[0] ?? "parse error") : "parse error";
  }
};

const readOutput = (expectation: string): string | null => {
  const evalOutput = expectation.split(EVAL_OUTPUT_SEPARATOR)[1]?.replace(/\s+$/, "");
  if (!evalOutput?.startsWith(OK_PREFIX)) return null;
  return evalOutput.slice(OK_PREFIX.length).split("\nlogs: [")[0] ?? "";
};

export const writeFixtureProject = (): Fixture[] => {
  ensureCheckout();
  const fixturesDirectory = join(CHECKOUT_DIRECTORY, SOURCE.fixtures);
  const sourceDirectory = join(PROJECT_DIRECTORY, "src");
  rmSync(PROJECT_DIRECTORY, { recursive: true, force: true });
  mkdirSync(sourceDirectory, { recursive: true });
  symlinkSync(join(PACKAGE_DIRECTORY, "node_modules"), join(PROJECT_DIRECTORY, "node_modules"));
  writeFileSync(join(PROJECT_DIRECTORY, "tsconfig.json"), JSON.stringify(PROJECT_TSCONFIG));
  writeFileSync(
    join(sourceDirectory, "shared-runtime.ts"),
    readFileSync(join(CHECKOUT_DIRECTORY, SOURCE.runtime), "utf8"),
  );
  const fileNames = readdirSync(fixturesDirectory);
  return fileNames
    .filter((fileName) => fileName.endsWith(".expect.md"))
    .flatMap((expectationName): Fixture[] => {
      const name = expectationName.slice(0, -".expect.md".length);
      const sourceName = fileNames.find(
        (fileName) =>
          fileName.startsWith(`${name}.`) &&
          fileName !== expectationName &&
          SOURCE_EXTENSIONS.has(extname(fileName)),
      );
      if (!sourceName) return [];
      const code = readFileSync(join(fixturesDirectory, sourceName), "utf8").replace(
        SHARED_RUNTIME_PATTERN,
        "$1./shared-runtime$1",
      );
      const output = readOutput(readFileSync(join(fixturesDirectory, expectationName), "utf8"));
      const file = join(sourceDirectory, `${name}${SOURCE_EXTENSIONS.get(extname(sourceName))}`);
      const error = getParseError(file, code);
      if (!error) writeFileSync(file, code);
      return [
        {
          name,
          file,
          entry: ENTRY_PATTERN.exec(code)?.[1] ?? null,
          output,
          isSequential: code.includes("sequentialRenders"),
          error,
        },
      ];
    });
};
