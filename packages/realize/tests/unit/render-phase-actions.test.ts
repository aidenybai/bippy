import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource } from "../../src/react-compiler/HIR/HIR";
import { getBranchId } from "../conformance/verifier/branch-counters";
import { checkComponent } from "../conformance/verifier/check";
import type { Observation } from "../conformance/verifier/driver";
import type { Action, Capture } from "../conformance/verifier/types";
import { formatCounterexamples } from "../conformance/verifier/verdict-report";
import { analyzeFixture, getComponent, getHandlerCounterId } from "./helpers";

describe("render-phase actions", async () => {
  const copied = getComponent(
    await analyzeFixture("conformance-repros", "render-phase-updates"),
    "CopiedDuringRender",
  );
  const setCounterId = getHandlerCounterId(copied, "() => setSource(true)");
  const copyBranch = copied.model.branches.find((branch) => branch.label === "copy");
  if (!copyBranch || copyBranch.loc === GeneratedSource) throw new Error("No branch tests copy");
  const copyBranchId = getBranchId(copyBranch.file, copyBranch.loc);

  const capture = (source: boolean, copy: boolean, handlerCalls: string[]): Capture => ({
    shapes: [{ kind: "element", tag: "div", children: [] }],
    stateValues: [source, copy],
    branchHits: [{ id: copyBranchId, isConsequent: copy }],
    handlerCalls,
    mutationHits: [],
    mutatedOrigins: [],
    error: null,
    errorDepth: null,
    failure: null,
  });

  const clickSet: Action = { key: "set", kind: "click", tag: "button", label: "set" };

  it("lets a render-phase update follow the handler that triggered it", async () => {
    const mounted = capture(false, false, []);
    const observations: Observation[] = [
      { props: {}, path: [], action: null, before: null, after: mounted },
      {
        props: {},
        path: [clickSet.key],
        action: clickSet,
        before: mounted,
        after: capture(true, true, [setCounterId]),
      },
    ];
    const verdict = await checkComponent(copied.analysis, copied.model, observations);
    expect(formatCounterexamples(verdict)).toEqual([]);
    expect(verdict.checkedTransitionCount).toBe(1);
  });
});
