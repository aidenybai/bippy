import { describe, expect, it } from "vite-plus/test";
import { enumerateStaticStates } from "../src/harness/compare-render.js";
import { listComponentFixtures, runComponentFixture } from "./helpers/component-runner.js";
import { getConcretePatternText } from "./helpers/concrete-pattern-text.js";

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
    expect(
      [...new Set(model.states.flatMap((state) => getConcretePatternText(state.tree)))].sort(),
    ).toEqual(expectedTexts);
    expect(result.comparison.report.status).toBe("exact");
    expect(result.comparison.stateReplay?.mismatched).toEqual([]);
  });
});
