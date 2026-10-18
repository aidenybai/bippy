import { readFileSync } from "node:fs";
import { analyzeProject, serializeProjectAnalysis } from "bippy-analyzer";
import type { AbstractValue, ComponentAnalysis, StateReport } from "bippy-analyzer";

export interface AnalyzerJsonReport extends Omit<StateReport, "places"> {
  places: Record<string, AbstractValue[]>;
}

export interface AnalyzerJsonComponent {
  analysis: ComponentAnalysis;
  report: AnalyzerJsonReport;
}

export type AnalyzerSource =
  | { kind: "project"; tsconfig: string; fileFilter: string | null }
  | { kind: "json"; path: string };

const outputsBySource = new Map<string, AnalyzerJsonComponent[]>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const resolveReferences = (root: unknown): unknown => {
  const byId = new Map<unknown, unknown>();
  const resolve = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(resolve);
    if (!isRecord(value)) return value;
    if ("$ref" in value) return byId.get(value.$ref);
    if ("$id" in value && Array.isArray(value.items)) {
      const items: unknown[] = [];
      byId.set(value.$id, items);
      for (const item of value.items) items.push(resolve(item));
      return items;
    }
    const object: Record<string, unknown> = {};
    if ("$id" in value) byId.set(value.$id, object);
    for (const [key, child] of Object.entries(value))
      if (key !== "$id") object[key] = resolve(child);
    return object;
  };
  return resolve(root);
};

const assertComponents: (value: unknown) => asserts value is AnalyzerJsonComponent[] = (value) => {
  if (!Array.isArray(value)) throw new Error("Analyzer output is not a component list");
  for (const component of value)
    if (!isRecord(component) || !isRecord(component.analysis) || !isRecord(component.report))
      throw new Error("Analyzer output has a malformed component");
};

export const deserializeAnalyzerOutput = (text: string): AnalyzerJsonComponent[] => {
  const components = resolveReferences(JSON.parse(text));
  assertComponents(components);
  return components;
};

const getSourceKey = (source: AnalyzerSource): string =>
  source.kind === "json"
    ? `json:${source.path}`
    : `project:${source.tsconfig}:${source.fileFilter ?? ""}`;

const readAnalyzerOutput = (source: AnalyzerSource): string =>
  source.kind === "json"
    ? readFileSync(source.path, "utf8")
    : serializeProjectAnalysis(analyzeProject(source.tsconfig, source.fileFilter));

export const loadAnalyzerOutput = (source: AnalyzerSource): AnalyzerJsonComponent[] => {
  const key = getSourceKey(source);
  const cached = outputsBySource.get(key);
  if (cached) return cached;
  const components = deserializeAnalyzerOutput(readAnalyzerOutput(source));
  outputsBySource.set(key, components);
  return components;
};
