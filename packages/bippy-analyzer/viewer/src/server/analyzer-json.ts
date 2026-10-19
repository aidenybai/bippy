import { analyzeProject, serializeProjectAnalysis } from "../../../src/index";
import type { AbstractValue, ComponentAnalysis, StateReport } from "../../../src/index";

export interface AnalyzerJsonReport extends Omit<StateReport, "places"> {
  places: Record<string, AbstractValue[]>;
}

export interface AnalyzerJsonComponent {
  analysis: ComponentAnalysis;
  report: AnalyzerJsonReport;
}

export interface AnalyzerSource {
  tsconfig: string;
  fileFilter: string | null;
}

const textsBySource = new Map<string, string>();
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
  `${source.tsconfig}:${source.fileFilter ?? ""}`;

export const loadAnalyzerText = (source: AnalyzerSource): string => {
  const key = getSourceKey(source);
  const cached = textsBySource.get(key);
  if (cached !== undefined) return cached;
  const text = serializeProjectAnalysis(analyzeProject(source.tsconfig, source.fileFilter));
  textsBySource.set(key, text);
  return text;
};

export const loadAnalyzerOutput = (source: AnalyzerSource): AnalyzerJsonComponent[] => {
  const key = getSourceKey(source);
  const cached = outputsBySource.get(key);
  if (cached) return cached;
  const components = deserializeAnalyzerOutput(loadAnalyzerText(source));
  outputsBySource.set(key, components);
  return components;
};
