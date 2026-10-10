import { describe, expect, it } from "vite-plus/test";
import {
  MUTATION_GATE,
  instrumentForMutation,
} from "../../src/branch-coverage/mutation-runtime.js";

// Build the instrumented `classify` and run a "suite" under a given mutant by
// toggling the global the gate reads. This mirrors what a Playwright fixture
// does with `page.addInitScript("globalThis.__MUTANT = ...")`.
const harness = (source: string, fnName: string) => {
  const { code, mutants } = instrumentForMutation("m.ts", source);
  const make = () => new Function(`${MUTATION_GATE}\n${code}\nreturn ${fnName};`)();
  const runUnder = (
    mutantId: string | undefined,
    suite: (fn: (...args: unknown[]) => unknown) => void,
  ): boolean => {
    (globalThis as Record<string, unknown>).__MUTANT = mutantId;
    try {
      suite(make());
      return false; // suite passed -> mutant survived
    } catch {
      return true; // suite threw -> mutant killed
    } finally {
      delete (globalThis as Record<string, unknown>).__MUTANT;
    }
  };
  return { mutants, runUnder };
};

describe("runtime mutation substrate", () => {
  const SOURCE = `function classify(n) {
  if (n > 0) { return "pos"; }
  return "nonpos";
}`;

  it("instruments the decision and emits force-true/false mutants", () => {
    const { mutants } = harness(SOURCE, "classify");
    expect(mutants.map((m) => m.id).sort()).toEqual(["f0", "t0"]);
    expect(mutants[0]!.condition).toBe("n > 0");
  });

  it("baseline (no mutant) leaves behavior unchanged", () => {
    const { runUnder } = harness(SOURCE, "classify");
    const survived = runUnder(undefined, (classify) => {
      if (classify(5) !== "pos") throw new Error("fail");
    });
    expect(survived).toBe(false); // suite passes, nothing forced
  });

  // The suite only asserts the true path (classify(5) === "pos").
  const trueOnlySuite = (classify: (...args: unknown[]) => unknown) => {
    if (classify(5) !== "pos") throw new Error("fail");
  };

  it("kills the force-false mutant — the asserted branch notices", () => {
    const { runUnder } = harness(SOURCE, "classify");
    // forcing `n > 0` false makes classify(5) return "nonpos" -> assertion fails
    expect(runUnder("f0", trueOnlySuite)).toBe(true);
  });

  it("lets the force-true mutant survive — the else branch is never asserted", () => {
    const { runUnder } = harness(SOURCE, "classify");
    // forcing `n > 0` true is invisible to classify(5) (already true); the
    // unasserted else path is the proven gap, exactly a branch-gap signal.
    expect(runUnder("t0", trueOnlySuite)).toBe(false);
  });

  it("a thorough suite kills both mutants", () => {
    const { runUnder } = harness(SOURCE, "classify");
    const bothPaths = (classify: (...args: unknown[]) => unknown) => {
      if (classify(5) !== "pos") throw new Error("fail");
      if (classify(-1) !== "nonpos") throw new Error("fail");
    };
    expect(runUnder("t0", bothPaths)).toBe(true); // force-true breaks classify(-1)
    expect(runUnder("f0", bothPaths)).toBe(true); // force-false breaks classify(5)
  });
});
