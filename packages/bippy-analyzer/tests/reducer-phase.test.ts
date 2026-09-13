import { describe, expect, it } from "vite-plus/test";
import { enumerateStaticStates } from "../src/harness/compare-render.js";
import type { PatternNode } from "../src/harness/static-pattern.js";
import { listComponentFixtures, runComponentFixture } from "./helpers/component-runner.js";

const getTexts = (nodes: PatternNode[]): string[] =>
  nodes.flatMap((node) => {
    if (node.kind === "fiber") return getTexts(node.children);
    if (node.kind === "text" && node.text !== null) return [node.text];
    throw new Error(`Expected a concrete tree, received ${node.kind}`);
  });

describe("queued reducer phases", () => {
  it.each([
    { name: "reducer-guarded-actions.tsx", expectedTexts: ["0", "40", "500"] },
    { name: "reducer-guarded-throw.tsx", expectedTexts: ["0", "1", "guarded reducer failure"] },
  ])("preserves the concrete guarded outcomes of $name", async ({ name, expectedTexts }) => {
    const fixture = listComponentFixtures().find((candidate) => candidate.name === name);
    if (!fixture) throw new Error("Missing guarded reducer fixture");
    const result = await runComponentFixture(fixture);
    const model = enumerateStaticStates(result.staticResult);
    expect(model.omitted).toBeNull();
    expect([...new Set(model.states.flatMap((state) => getTexts(state.tree)))].sort()).toEqual(
      expectedTexts,
    );
    expect(result.comparison.report.status).toBe("exact");
    expect(result.comparison.stateReplay?.mismatched).toEqual([]);
  });
});
