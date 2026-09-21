import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  getDependencyCycles,
  getModuleDependencies,
  type ModuleDependency,
} from "./helpers/module-dependencies.js";

const sourceDirectory = resolve(import.meta.dirname, "../src");

const getSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    return entry.isDirectory()
      ? getSourceFiles(entryPath)
      : entry.name.endsWith(".ts")
        ? [entryPath]
        : [];
  });

const dependencies = getSourceFiles(sourceDirectory).flatMap((filePath) =>
  getModuleDependencies(sourceDirectory, filePath, readFileSync(filePath, "utf8")),
);
const evaluationModules = new Set([
  "evaluate/abort-controller.ts",
  "evaluate/array-methods.ts",
  "evaluate/builtin-calls.ts",
  "evaluate/class-component.ts",
  "evaluate/dom-observers.ts",
  "evaluate/event-listeners.ts",
  "evaluate/function-constructor.ts",
  "evaluate/import-glob.ts",
  "evaluate/module-evaluator.ts",
  "evaluate/require-context.ts",
  "evaluate/resource-loading.ts",
  "evaluate/callbacks.ts",
  "evaluate/collection-values.ts",
  "evaluate/closure-inspection.ts",
  "evaluate/environment-reads.ts",
  "evaluate/json-values.ts",
  "evaluate/native-closures.ts",
  "evaluate/completion.ts",
  "evaluate/context.ts",
  "evaluate/loops.ts",
  "evaluate/language-intrinsics.ts",
  "evaluate/number-ranges.ts",
  "evaluate/prototype-owners.ts",
  "evaluate/method-signatures.ts",
  "evaluate/operators.ts",
  "evaluate/object-copy.ts",
  "evaluate/object-integrity.ts",
  "evaluate/own-enumeration.ts",
  "evaluate/property-descriptors.ts",
  "evaluate/react-calls.ts",
  "evaluate/react-children.ts",
  "evaluate/react-context.ts",
  "evaluate/react-elements.ts",
  "evaluate/react-hooks.ts",
  "evaluate/scope-journal.ts",
  "evaluate/string-methods.ts",
  "evaluate/value-distribution.ts",
  "evaluate/value-typeof.ts",
]);

const getViolations = (isViolation: (dependency: ModuleDependency) => boolean): string[] =>
  dependencies.filter(isViolation).map(({ source, target }) => `${source} -> ${target}`);

describe("engine dependency boundaries", () => {
  it("keeps evaluation independent of the capture and comparison harness", () => {
    expect(
      getViolations(
        ({ source, target }) => source.startsWith("evaluate/") && target.startsWith("harness/"),
      ),
    ).toEqual([]);
  });

  it("keeps symbolic foundations independent of evaluation and rendering", () => {
    expect(
      getViolations(
        ({ source, target }) =>
          source.startsWith("symbolic/") &&
          !target.startsWith("symbolic/") &&
          target !== "errors.ts",
      ),
    ).toEqual([]);
  });

  it("keeps source and module records independent of engine state", () => {
    expect(
      getViolations(
        ({ source, target }) =>
          (source === "parse/source-types.ts" ||
            source === "graph/module-types.ts" ||
            source === "parse/typescript-declarations.ts") &&
          !target.startsWith("parse/"),
      ),
    ).toEqual([]);
  });

  it("does not give evaluation subsystems access to their coordinators", () => {
    expect(
      getViolations(
        ({ source, target }) =>
          evaluationModules.has(source) &&
          (target === "index.ts" ||
            target === "evaluate/interpreter.ts" ||
            target === "evaluate/react-calls.ts" ||
            target === "evaluate/builtin-calls.ts" ||
            target.startsWith("materialize/") ||
            target.startsWith("render/")),
      ),
    ).toEqual([]);
  });

  it("keeps React children independent of array methods", () => {
    expect(
      getViolations(
        ({ source, target }) =>
          source === "evaluate/react-children.ts" && target === "evaluate/array-methods.ts",
      ),
    ).toEqual([]);
  });

  it("keeps element construction and provider lookup independent of evaluation state", () => {
    expect(
      getViolations(
        ({ source, target }) =>
          (source === "evaluate/react-elements.ts" || source === "evaluate/react-context.ts") &&
          (target === "evaluate/context.ts" ||
            target === "evaluate/hooks.ts" ||
            target === "evaluate/react-hooks.ts"),
      ),
    ).toEqual([]);
  });

  it("keeps the selected evaluation and symbolic contracts acyclic", () => {
    const modules = new Set([
      ...evaluationModules,
      ...dependencies
        .map(({ source }) => source)
        .filter((source) => source.startsWith("symbolic/")),
    ]);
    expect(
      getDependencyCycles(
        dependencies.filter(({ source, target }) => modules.has(source) && modules.has(target)),
      ),
    ).toEqual([]);
  });

  it("allows only the reviewed value/predicate runtime cycle across the entire engine", () => {
    expect(getDependencyCycles(dependencies.filter(({ isTypeOnly }) => !isTypeOnly))).toEqual([
      ["evaluate/predicates.ts", "evaluate/values.ts"],
    ]);
  });

  it("keeps React API recognition independent of evaluation", () => {
    expect(
      getViolations(
        ({ source, target }) => source === "react/react-api.ts" && target.startsWith("evaluate/"),
      ),
    ).toEqual([]);
  });

  it("rejects self imports", () => {
    expect(getViolations(({ source, target }) => source === target)).toEqual([]);
  });
});
