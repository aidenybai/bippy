import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export interface ApiCoverageGroup {
  entry: string;
  exports: string[];
  tests: string[];
}

export interface UpstreamPort {
  upstream: string;
  local: string;
  scope: "complete-development-suite" | "selected-cases";
  titles?: string[];
}

interface UpstreamDefinition {
  disabled: boolean;
  title: string;
  local?: string;
}

export interface UpstreamTestFile {
  definitions: UpstreamDefinition[];
  path: string;
}

interface DevtoolsInventory {
  revision: string;
  testFiles: UpstreamTestFile[];
}

export interface UpstreamManifest {
  repository: string;
  revision: string;
  sources: Record<string, string>;
  ports: UpstreamPort[];
  devtools: DevtoolsInventory;
}

export interface TestDefinition {
  kind: string;
  title: string;
  modifiers: string[];
}

export const conformanceDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const repositoryDirectory = resolve(conformanceDirectory, "../..");
export const devtoolsDirectory = resolve(
  repositoryDirectory,
  "packages/conformance/fixtures/react-devtools-headless",
);
export const upstreamManifestPath = resolve(conformanceDirectory, "upstream.json");

const testModifiers = new Set([
  "skip",
  "only",
  "todo",
  "each",
  "for",
  "skipIf",
  "runIf",
  "concurrent",
  "sequential",
  "fails",
]);

export const getTestDefinitions = (path: string, requireStaticTitles = false): TestDefinition[] => {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const definitions: TestDefinition[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      !(ts.isCallExpression(node.parent) && node.parent.expression === node)
    ) {
      let expression = node.expression;
      const modifiers: string[] = [];
      while (ts.isPropertyAccessExpression(expression) || ts.isCallExpression(expression)) {
        if (ts.isPropertyAccessExpression(expression)) modifiers.push(expression.name.text);
        expression = expression.expression;
      }
      if (
        ts.isIdentifier(expression) &&
        ["it", "test", "describe"].includes(expression.text) &&
        modifiers.every((modifier) => testModifiers.has(modifier))
      ) {
        const title = node.arguments[0];
        if (title && ts.isStringLiteralLike(title)) {
          definitions.push({ kind: expression.text, title: title.text, modifiers });
        } else if (requireStaticTitles && expression.text !== "describe") {
          throw new Error(`Cannot inventory a dynamic test definition in ${path}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return definitions;
};

export const getTestTitles = (path: string): string[] =>
  getTestDefinitions(path)
    .filter((definition) => definition.kind !== "describe")
    .map((definition) => definition.title);

export const readUpstreamManifest = (): UpstreamManifest =>
  JSON.parse(readFileSync(upstreamManifestPath, "utf8"));

export const getPortTitles = (manifest: UpstreamManifest, port: UpstreamPort): string[] => {
  if (port.scope === "selected-cases") {
    if (!port.titles?.length) throw new Error(`Missing selected cases: ${port.upstream}`);
    return port.titles;
  }
  const testFile = manifest.devtools.testFiles.find((testFile) => testFile.path === port.upstream);
  if (!testFile) throw new Error(`Missing upstream definitions: ${port.upstream}`);
  return testFile.definitions.map((definition) => definition.title);
};

export const readApiCoverage = (): ApiCoverageGroup[] =>
  JSON.parse(readFileSync(resolve(conformanceDirectory, "api-coverage.json"), "utf8"));

export const getExpectedExports = (entry: string): string[] =>
  readApiCoverage()
    .filter((group) => group.entry === entry)
    .flatMap((group) => group.exports)
    .sort();
