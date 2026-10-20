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
      stateIndex: 1,
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

  it("narrows a claim by the guard before it", () => {
    const guarded = project.components.find(
      (component) => component.analysis.name === "GuardedCast",
    );
    const cast = guarded?.report.claimOutcomes.find((outcome) => outcome.claim.kind === "cast");
    expect(cast).toMatchObject({ verdict: "unproven", reason: "next = string" });
  });

  it("checks a claim in a handler only where the handler renders", () => {
    const hidden = project.components.find(
      (component) => component.analysis.name === "HiddenHandler",
    );
    const cast = hidden?.report.claimOutcomes.find((outcome) => outcome.claim.kind === "cast");
    expect(cast).toMatchObject({ verdict: "holds" });
  });

  it("lets a guard keep a typed state within its type", () => {
    const guarded = project.components.find(
      (component) => component.analysis.name === "GuardedWrite",
    );
    const state = guarded?.report.claimOutcomes.find((outcome) => outcome.claim.kind === "state");
    expect(state).toMatchObject({ verdict: "holds" });
  });

  it("drops the nullish side of a coalesced update", () => {
    const coalesced = project.components.find(
      (component) => component.analysis.name === "Coalesced",
    );
    const state = coalesced?.report.claimOutcomes.find((outcome) => outcome.claim.kind === "state");
    expect(state).toMatchObject({ verdict: "holds" });
  });

  it("treats the empty object type as a value that may equal a literal", () => {
    const empty = project.components.find(
      (component) => component.analysis.name === "EmptyObjectCast",
    );
    const cast = empty?.report.claimOutcomes.find((outcome) => outcome.claim.kind === "cast");
    expect(cast).toMatchObject({ verdict: "unproven", reason: "raw = undefined | {}" });
  });

  it("checks a claim in a callback it cannot place against every reachable value", () => {
    const opaque = project.components.find(
      (component) => component.analysis.name === "OpaqueCallback",
    );
    const assertion = opaque?.report.claimOutcomes.find(
      (outcome) => outcome.claim.kind === "non-null",
    );
    expect(assertion).toMatchObject({
      verdict: "unproven",
      stateIndex: null,
      reason: "user = null",
    });
  });

  it("names the value that breaks a claim the solver refutes outright", () => {
    const details = project.components.find(
      (component) => component.analysis.name === "ResourceDetails",
    );
    const assertion = details?.report.claimOutcomes.find(
      (outcome) => outcome.claim.kind === "non-null",
    );
    expect(assertion).toMatchObject({ verdict: "broken", reason: "user = null" });
  });

  it("judges a cast by the type the author cast from, not by an index the analysis widens", () => {
    const row = project.components.find((component) => component.analysis.name === "OptionRow");
    expect(row?.analysis.claims).toEqual([]);
  });

  it("breaks a state's type when a handler sets a value outside it", () => {
    expect(find('status stays within "idle" | "saving"')).toMatchObject({
      verdict: "broken",
      reason: 'set to "done"',
      stateIndex: 1,
    });
  });
});
