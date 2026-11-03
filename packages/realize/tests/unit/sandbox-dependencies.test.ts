import { globSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { join } from "node:path";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vite-plus/test";
import { getAnalyzerPackageJson } from "../conformance/runner/vercel-environment";

const PACKAGE_DIRECTORY = join(import.meta.dirname, "../..");

const getPackageName = (specifier: string): string =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");

const getRuntimeImports = (file: string): string[] =>
  parse(readFileSync(file, "utf8"), {
    sourceType: "module",
    plugins: ["typescript"],
  }).program.body.flatMap((statement) => {
    const isRuntimeImport =
      (statement.type === "ImportDeclaration" && statement.importKind !== "type") ||
      ((statement.type === "ExportNamedDeclaration" || statement.type === "ExportAllDeclaration") &&
        statement.exportKind !== "type");
    return isRuntimeImport && statement.source ? [statement.source.value] : [];
  });

describe("sandbox dependencies", () => {
  const dependencies = Object.keys(JSON.parse(getAnalyzerPackageJson()).dependencies);

  it("installs every package the analyzer imports at runtime", () => {
    const packageNames = new Set(
      globSync("src/**/*.ts", { cwd: PACKAGE_DIRECTORY })
        .flatMap((file) => getRuntimeImports(join(PACKAGE_DIRECTORY, file)))
        .filter((specifier) => !specifier.startsWith(".") && !isBuiltin(specifier))
        .map(getPackageName),
    );
    expect([...packageNames].filter((name) => !dependencies.includes(name))).toEqual([]);
  });

  it("installs tsx to run the collector, and no workspace packages", () => {
    expect(dependencies).toContain("tsx");
    expect(dependencies).not.toContain("bippy");
  });
});
