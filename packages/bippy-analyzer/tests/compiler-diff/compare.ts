import { resolve } from "node:path";
import { diffArrays, createTwoFilesPatch } from "diff";
import type { Node } from "typescript/unstable/ast";
import { isProjectSourceFile, withProject } from "../../src/core/entrypoint/analyze-project.js";
import { findReactFunctions } from "../../src/core/entrypoint/program.js";
import { printFunction } from "../../src/core/hir/print-hir.js";
import { ScopeManager } from "../../src/core/hir/scope.js";
import { runPortPipeline } from "./port.js";
import { compileWithUpstream, getFunctionKey } from "./upstream.js";

/**
 * - `match`, `mismatch`: both compilers produced HIR.
 * - `both-bailed`: upstream reported a compile error and our lowering returned one too.
 * - `port-bailed`: upstream compiled cleanly but our pipeline failed.
 * - `upstream-bailed`: upstream produced no HIR but ours did.
 * - `upstream-only`, `port-only`: only one side treats the function as a component or hook.
 */
export type FunctionStatus =
  | "match"
  | "mismatch"
  | "both-bailed"
  | "port-bailed"
  | "upstream-bailed"
  | "upstream-only"
  | "port-only";

export type DifferenceCategory =
  | "type"
  | "effect"
  | "mutable-range"
  | "reactive"
  | "reactive-scope"
  | "aliasing-effect"
  | "structure";

export interface FunctionComparison {
  file: string;
  name: string;
  key: string;
  status: FunctionStatus;
  categories: DifferenceCategory[];
  upstreamErrors: string[];
  portError: string | null;
  patch: string | null;
}

export interface CompareOptions {
  fileFilter: string | null;
  isTypeProviderEnabled: boolean;
}

const GENERATED_SHAPE_PATTERN = /<generated_\d+>/g;
const UPDATE_KIND_PATTERN = /\b(Prefix|Postfix)Update(?:Local)? /g;
const UNSUPPORTED_TS_NODE_PATTERN = /\bUnsupportedNode TS(?=[A-Z])/g;
const TYPE_PATTERN = /(?::  )?:T[A-Za-z]+(?:<<[^>]*>>|<[^>]*>)?(?:\(\))?/g;
const RANGE_PATTERN = /\[\d+:\d+\]/g;
const REACTIVE_PATTERN = /\{reactive\}/g;
const SCOPE_PATTERN = /_@\d+/g;
const EFFECT_PATTERN =
  /(?<=^|[\s(,{[])(?:<unknown>|freeze|read|capture|store|mutate-iterator\?|mutate\?|mutate) (?=[\w$]*\$\d)/g;
const ALIASING_EFFECT_PATTERN =
  /^\s+(?:Create|CreateFrom|CreateFunction|Assign|Alias|MaybeAlias|Capture|ImmutableCapture|Apply|Freeze|Mutate|MutateConditionally|MutateTransitive|MutateTransitiveConditionally|MutateFrozen|MutateGlobal|Impure|Render) /;

const COMPONENT_PATTERNS: Array<[DifferenceCategory, RegExp]> = [
  ["type", TYPE_PATTERN],
  ["effect", EFFECT_PATTERN],
  ["mutable-range", RANGE_PATTERN],
  ["reactive", REACTIVE_PATTERN],
  ["reactive-scope", SCOPE_PATTERN],
];

/**
 * Removes differences that carry no meaning:
 * - Generated shape ids come from a module-level counter that every compiled function and
 *   every lazily installed module type advances, so they depend on what compiled before.
 *   They are renamed in order of first appearance, which keeps which places share a shape.
 * - Upstream split `PrefixUpdate`/`PostfixUpdate` into `*Local` and `*Context` after the
 *   npm build we compare against. Before, context updates bailed out, so `*Local` is the
 *   only kind both sides print.
 * - An `UnsupportedNode` prints its AST node type. Babel prefixes TypeScript-only nodes with
 *   `TS`, as in `TSEnumDeclaration`, where TypeScript's `SyntaxKind` is `EnumDeclaration`.
 */
export const normalizeHir = (hir: string): string => {
  const shapeIds = new Map<string, string>();
  return hir
    .replace(GENERATED_SHAPE_PATTERN, (shapeId) => {
      const existing = shapeIds.get(shapeId);
      if (existing) return existing;
      const renamed = `<generated_#${shapeIds.size}>`;
      shapeIds.set(shapeId, renamed);
      return renamed;
    })
    .replace(UPDATE_KIND_PATTERN, "$1Update ")
    .replace(UNSUPPORTED_TS_NODE_PATTERN, "UnsupportedNode ");
};

const isAliasingEffectLine = (line: string): boolean => ALIASING_EFFECT_PATTERN.test(line);

const classifyLinePair = (upstreamLine: string, portLine: string): DifferenceCategory[] => {
  const categories = COMPONENT_PATTERNS.filter(
    ([, pattern]) =>
      (upstreamLine.match(pattern) ?? []).join() !== (portLine.match(pattern) ?? []).join(),
  ).map(([category]) => category);
  const strip = (line: string): string =>
    COMPONENT_PATTERNS.reduce((stripped, [, pattern]) => stripped.replace(pattern, ""), line);
  if (strip(upstreamLine) === strip(portLine)) return categories;
  return [...categories, isAliasingEffectLine(upstreamLine) ? "aliasing-effect" : "structure"];
};

/**
 * Pairs replaced lines of one kind, instructions or aliasing effects, when both sides have
 * as many. Otherwise the lines were added or removed: a structural or effect difference.
 */
const classifyLines = (
  upstreamLines: string[],
  portLines: string[],
  unpairedCategory: DifferenceCategory,
): DifferenceCategory[] => {
  if (upstreamLines.length === 0 && portLines.length === 0) return [];
  if (upstreamLines.length !== portLines.length) return [unpairedCategory];
  return upstreamLines.flatMap((line, lineIndex) =>
    classifyLinePair(line, portLines[lineIndex] ?? ""),
  );
};

/**
 * Names what differs between two printed functions: types, place effects, mutable ranges,
 * reactivity, scope assignment, aliasing effects, or the instructions themselves.
 */
export const classifyDifferences = (upstream: string, port: string): DifferenceCategory[] => {
  const categories = new Set<DifferenceCategory>();
  const changes = diffArrays(upstream.split("\n"), port.split("\n"));
  for (let index = 0; index < changes.length; index++) {
    const change = changes[index];
    if (!change || (!change.added && !change.removed)) continue;
    const next = changes[index + 1];
    const isReplacement = change.removed && next?.added === true;
    if (isReplacement) index++;
    const upstreamLines = change.removed ? change.value : [];
    const portLines = isReplacement ? (next?.value ?? []) : change.added ? change.value : [];
    for (const category of [
      ...classifyLines(
        upstreamLines.filter((line) => !isAliasingEffectLine(line)),
        portLines.filter((line) => !isAliasingEffectLine(line)),
        "structure",
      ),
      ...classifyLines(
        upstreamLines.filter(isAliasingEffectLine),
        portLines.filter(isAliasingEffectLine),
        "aliasing-effect",
      ),
    ])
      categories.add(category);
  }
  return [...categories];
};

const getErrorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";

const getNodeEnd = (node: Node): { line: number; column: number } => {
  const sourceFile = node.getSourceFile();
  const end = node.getEnd();
  const lineStarts = sourceFile.getLineStarts();
  const lineIndex = lineStarts.findLastIndex((lineStart) => lineStart <= end);
  return { line: lineIndex + 1, column: end - (lineStarts[lineIndex] ?? 0) };
};

/**
 * Compiles every component and hook in a TypeScript project with both compilers and
 * compares their HIR after `InferReactivePlaces`.
 */
export const compareProject = (configPath: string, options: CompareOptions): FunctionComparison[] =>
  withProject(resolve(configPath), (project) => {
    const comparisons: FunctionComparison[] = [];
    const fileNames = project.program
      .getSourceFileNames()
      .filter(
        (fileName) =>
          isProjectSourceFile(fileName) &&
          (options.fileFilter === null || fileName.includes(options.fileFilter)),
      );
    for (const fileName of fileNames) {
      const sourceFile = project.program.getSourceFile(fileName);
      if (!sourceFile) continue;
      const upstreamFunctions = compileWithUpstream(fileName, sourceFile.text);
      const context = {
        sourceFile,
        checker: project.checker,
        scopes: new ScopeManager(sourceFile),
      };
      const portKeys = new Set<string>();
      for (const reactFunction of findReactFunctions(sourceFile)) {
        const key = getFunctionKey(getNodeEnd(reactFunction.node));
        portKeys.add(key);
        const upstreamFunction = upstreamFunctions.get(key);
        const portResult = (() => {
          try {
            const result = runPortPipeline(reactFunction, context, options.isTypeProviderEnabled);
            return result.isOk()
              ? { hir: normalizeHir(printFunction(result.unwrap())), error: null }
              : { hir: null, error: getErrorMessage(result.unwrapErr()) };
          } catch (error) {
            return { hir: null, error: `threw: ${getErrorMessage(error)}` };
          }
        })();
        const comparison = {
          file: fileName,
          name: reactFunction.name,
          key,
          categories: [],
          upstreamErrors: upstreamFunction?.errors ?? [],
          portError: portResult.error,
          patch: null,
        };
        if (!upstreamFunction) {
          comparisons.push({ ...comparison, status: "port-only" });
          continue;
        }
        if (upstreamFunction.hir === null || portResult.hir === null) {
          const status =
            portResult.hir !== null
              ? "upstream-bailed"
              : upstreamFunction.hir === null || upstreamFunction.errors.length > 0
                ? "both-bailed"
                : "port-bailed";
          comparisons.push({ ...comparison, status });
          continue;
        }
        const upstreamHir = normalizeHir(upstreamFunction.hir);
        if (upstreamHir === portResult.hir) {
          comparisons.push({ ...comparison, status: "match" });
          continue;
        }
        comparisons.push({
          ...comparison,
          status: "mismatch",
          categories: classifyDifferences(upstreamHir, portResult.hir),
          patch: createTwoFilesPatch("upstream", "port", upstreamHir, portResult.hir, "", "", {
            context: 3,
          }),
        });
      }
      for (const [key, upstreamFunction] of upstreamFunctions) {
        if (portKeys.has(key) || upstreamFunction.hir === null) continue;
        comparisons.push({
          file: fileName,
          name: upstreamFunction.name ?? "<anonymous>",
          key,
          status: "upstream-only",
          categories: [],
          upstreamErrors: upstreamFunction.errors,
          portError: null,
          patch: null,
        });
      }
    }
    return comparisons;
  });
