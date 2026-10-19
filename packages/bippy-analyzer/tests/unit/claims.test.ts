import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture } from "./helpers";

describe("claims", () => {
  const project = analyzeFixture("symbolic-tree", "claims.tsx");
  const profile = project.components.find((component) => component.analysis.name === "Profile");
  const outcomes = profile?.report.claimOutcomes ?? [];
  const find = (description: string) =>
    outcomes.find((outcome) => outcome.claim.description === description);

  it("finds the casts, the non-null assertion, the invariant and the typed states", () => {
    expect(outcomes.map((outcome) => outcome.claim.description).sort()).toEqual(
      [
        '"done" as "idle" | "saving"',
        'invariant(mode === "view" || user !== null)',
        'status stays within "idle" | "saving"',
        'step as "a" | "b"',
        'step stays within "a" | "b" | "c"',
        "user as User",
        "user!",
      ].sort(),
    );
  });

  it("proves a cast from the values the state can reach", () => {
    expect(find('step as "a" | "b"')).toMatchObject({ verdict: "holds", reason: null });
    expect(find('step stays within "a" | "b" | "c"')).toMatchObject({ verdict: "holds" });
  });

  it("cannot prove a cast in a state that does not guard it, and says how to get there", () => {
    expect(find("user as User")).toMatchObject({
      verdict: "unproven",
      reason: "user = null",
      stateIndex: 0,
      path: ["t1"],
    });
  });

  it("cannot prove a non-null assertion in a handler", () => {
    expect(find("user!")).toMatchObject({
      verdict: "unproven",
      reason: "user = null",
      stateIndex: null,
    });
  });

  it("breaks a cast to a literal the value cannot be", () => {
    expect(find('"done" as "idle" | "saving"')).toMatchObject({
      verdict: "broken",
      reason: '"done" = "done"',
    });
  });

  it("cannot prove an invariant over props, with the values that break it", () => {
    expect(find('invariant(mode === "view" || user !== null)')).toMatchObject({
      verdict: "unproven",
      stateIndex: null,
      reason: 'mode = "edit", user = null',
    });
  });

  it("breaks a state's type when a handler sets a value outside it", () => {
    expect(find('status stays within "idle" | "saving"')).toMatchObject({
      verdict: "broken",
      reason: 'set to "done"',
      stateIndex: 1,
    });
  });
});
