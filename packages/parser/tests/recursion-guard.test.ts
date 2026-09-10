import { describe, expect, it } from "vite-plus/test";
import {
  describeComponentRun,
  listComponentFixtures,
  runComponentFixture,
} from "./helpers/component-runner.js";

const LIMIT_DIAGNOSTICS = new Set(["max-call-depth", "budget-exhausted"]);

const collectLimitDiagnostics = async (name: string): Promise<string[]> => {
  const fixture = listComponentFixtures().find((candidate) => candidate.name === name);
  if (!fixture) throw new Error(`missing ${name} fixture`);
  const run = await runComponentFixture(fixture);
  expect(run.comparison.report.status, describeComponentRun(fixture, run)).toBe("exact");
  return run.staticResult.diagnostics
    .filter((diagnostic) => LIMIT_DIAGNOSTICS.has(diagnostic.code))
    .map((diagnostic) => diagnostic.code);
};

/**
 * Recursion is cut only once a frame is provably the same call again: same
 * callee, equivalent arguments and receiver, and no write since the earlier
 * frame to anything that existed before it. Each fixture must therefore settle
 * through the recursion guard, never by running into the call-depth budget.
 */
describe("recursion guard", () => {
  it("keeps recursing while an accumulator grows", async () => {
    expect(await collectLimitDiagnostics("recursion-accumulator.tsx")).toEqual([]);
  });

  it("keeps recursing over genuinely different mutable receivers", async () => {
    expect(await collectLimitDiagnostics("recursion-linked-receiver.tsx")).toEqual([]);
  });

  it("reaches a fixpoint on a structurally equal receiver recreated per level", async () => {
    expect(await collectLimitDiagnostics("recursion-fresh-receiver.tsx")).toEqual([]);
  });

  it("follows mutual recursion through this-methods", async () => {
    expect(await collectLimitDiagnostics("recursion-mutual-methods.tsx")).toEqual([]);
  });
});
