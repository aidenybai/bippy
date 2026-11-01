import type { ComponentAnalysis, Sample } from "../../../src/core/types";
import type { ComponentModel } from "../../../src/core/model/types";
import type { Observation } from "./driver";
import { getCaptureFailure } from "./reasons";
import type { MountFailure } from "./reasons";

interface RenderCounterexample {
  props: Record<string, Sample>;
  path: string[];
  sides: string[];
  values: string[];
}

interface TransitionCounterexample {
  path: string[];
  action: string;
  handlers: string[];
}

interface ValueCounterexample {
  path: string[];
  variable: string;
  value: string;
  domain: string[];
}

type VerdictOutcome =
  | { status: "verified" | "not-exported"; error: null; mountFailure: null }
  | { status: "mount-failed"; error: string; mountFailure: MountFailure };

interface VerdictCounts {
  name: string;
  file: string;
  isTruncated: boolean;
  observationCount: number;
  renderErrorCount: number;
  viewCount: number;
  coveredViews: string[];
  checkedTransitionCount: number;
  branchSideCount: number;
  coveredBranchSideCount: number;
  reachedUnreachableSides: string[];
  renderCounterexamples: RenderCounterexample[];
  transitionCounterexamples: TransitionCounterexample[];
  valueCounterexamples: ValueCounterexample[];
  warningCount: number;
  coveredWarningCount: number;
  refutedWarnings: string[];
  unwarnedMutations: string[];
  durationMs: number;
}

export type ComponentVerdict = VerdictCounts & VerdictOutcome;

type MountFailedVerdict = Extract<ComponentVerdict, { status: "mount-failed" }>;

export const isMountFailedVerdict = (verdict: ComponentVerdict): verdict is MountFailedVerdict =>
  verdict.status === "mount-failed";

export interface VerificationSummary {
  verifiedCount: number;
  unmountableCount: number;
  notExportedCount: number;
  counterexampleCount: number;
  viewCount: number;
  coveredViewCount: number;
  branchSideCount: number;
  coveredBranchSideCount: number;
  warningCount: number;
  coveredWarningCount: number;
  unwarnedMutationCount: number;
  mountFailureCounts: Partial<Record<MountFailure, number>>;
  durationMs: number;
}

export const createEmptyVerdict = (
  analysis: ComponentAnalysis,
  model: ComponentModel,
): ComponentVerdict => ({
  name: analysis.name,
  file: analysis.file,
  status: analysis.exportName ? "verified" : "not-exported",
  error: null,
  mountFailure: null,
  isTruncated: model.stateSpace.isTruncated,
  observationCount: 0,
  renderErrorCount: 0,
  viewCount: model.stateSpace.reachableViews.length,
  coveredViews: [],
  checkedTransitionCount: 0,
  branchSideCount: 0,
  coveredBranchSideCount: 0,
  reachedUnreachableSides: [],
  renderCounterexamples: [],
  transitionCounterexamples: [],
  valueCounterexamples: [],
  warningCount: analysis.warnings.length,
  coveredWarningCount: 0,
  refutedWarnings: [],
  unwarnedMutations: [],
  durationMs: 0,
});

export const getMountFailedVerdict = (
  verdict: ComponentVerdict,
  observations: Observation[],
): ComponentVerdict | null => {
  const isNothingMounted = observations.every(
    (observation) => observation.after.error && observation.after.shapes.length === 0,
  );
  if (!isNothingMounted) return null;
  const firstCapture = observations[0]?.after;
  return {
    ...verdict,
    status: "mount-failed",
    error: firstCapture?.error ?? "nothing was mounted",
    mountFailure: firstCapture ? getCaptureFailure(firstCapture) : "did-not-render",
  };
};
