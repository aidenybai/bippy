import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource } from "../../src/react-compiler/HIR/HIR";
import { analyzeFixture, getComponent } from "./helpers";

describe("a handler that mutates state after a guarded mutation", () => {
  const project = analyzeFixture("conformance-repros", "mutation-sites");

  it.each([
    ["GuardedFirstMutation", [10, 11]],
    ["GuardedUpdaterMutation", [29, 30]],
    ["GuardedPendingMutation", [48, 49]],
  ])("%s warns at the guarded push and at the reverse that always runs", (name, lines) => {
    const { warnings } = getComponent(project, name).analysis;
    expect(
      warnings.map(({ loc }) => (loc === GeneratedSource ? null : loc.start.line)).toSorted(),
    ).toEqual(lines);
  });
});
