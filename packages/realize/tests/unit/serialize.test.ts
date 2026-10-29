import { describe, expect, it } from "vite-plus/test";
import { serializeProjectAnalysis } from "../../src/core/project/serialize";
import { analyzeFixture } from "./helpers";

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

const countSelfReferences = (text: string): number =>
  [...text.matchAll(/"\$id":\s*(\d+),\s*"items":\s*\{\s*"\$ref":\s*(\d+)/g)].filter(
    ([, id, ref]) => id === ref,
  ).length;

describe("serializeProjectAnalysis", () => {
  const project = analyzeFixture("symbolic-tree", "dashboard");
  const text = serializeProjectAnalysis(project);

  it("writes a shared array once, with its items", () => {
    expect(countSelfReferences(text)).toBe(0);
  });

  it("round-trips the values a consumer needs", () => {
    const components = resolveReferences(JSON.parse(text));
    const dashboard = (Array.isArray(components) ? components : []).find(
      (component) =>
        isRecord(component) &&
        isRecord(component.analysis) &&
        component.analysis.name === "Dashboard",
    );
    const analysis =
      isRecord(dashboard) && isRecord(dashboard.analysis) ? dashboard.analysis : null;
    const bindings = Array.isArray(analysis?.bindings) ? analysis.bindings : [];
    const status = bindings.find((binding) => isRecord(binding) && binding.name === "status");
    const domain = isRecord(status) && isRecord(status.domain) ? status.domain : null;
    expect(domain?.kind).toBe("Cases");
    expect(Array.isArray(domain?.cases) ? domain.cases.length : 0).toBe(3);
  });
});
