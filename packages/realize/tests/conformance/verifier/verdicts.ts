import type { ComponentAnalysis, Sample, StateReport } from "../../../src/core/types";
import type { Observation } from "./driver";
import { getCaptureFailure } from "./reasons";
import type { MountFailure } from "./reasons";

type ComponentStatus = "verified" | "not-exported" | "mount-failed";

interface StateCounterexample {
  props: Record<string, Sample>;
  path: string[];
  rendered: string;
  closestState: number;
  reason: string;
}

export interface TransitionCounterexample {
  path: string[];
  action: string;
  fromStates: number[];
  toStates: number[];
  predictedStates: number[];
  reason: "unpredicted-target" | "unmodeled-handler" | "unpredicted-effect";
}

interface ValueCounterexample {
  path: string[];
  place: string;
  value: string;
  predicted: string[];
}

export interface ComponentVerdict {
  name: string;
  file: string;
  status: ComponentStatus;
  error: string | null;
  mountFailure: MountFailure | null;
  observationCount: number;
  renderErrorCount: number;
  predictedStateCount: number;
  coveredStateIndices: number[];
  stateCounterexamples: StateCounterexample[];
  coveredTransitionCount: number;
  transitionCounterexamples: TransitionCounterexample[];
  branchSideCount: number;
  coveredBranchSideCount: number;
  unreachableClaimCount: number;
  reachedUnreachableBranches: string[];
  valueCounterexamples: ValueCounterexample[];
  warningCount: number;
  coveredWarningCount: number;
  refutedWarnings: string[];
  unwarnedMutations: string[];
}

export interface VerificationSummary {
  verifiedCount: number;
  unmountableCount: number;
  notExportedCount: number;
  counterexampleCount: number;
  predictedStateCount: number;
  coveredStateCount: number;
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
  report: StateReport,
): ComponentVerdict => ({
  name: analysis.name,
  file: analysis.file,
  status: analysis.exportName ? "verified" : "not-exported",
  error: null,
  mountFailure: null,
  observationCount: 0,
  renderErrorCount: 0,
  predictedStateCount: report.states.length,
  coveredStateIndices: [],
  stateCounterexamples: [],
  coveredTransitionCount: 0,
  transitionCounterexamples: [],
  branchSideCount: 0,
  coveredBranchSideCount: 0,
  unreachableClaimCount: report.unreachableBranches.length,
  reachedUnreachableBranches: [],
  valueCounterexamples: [],
  warningCount: analysis.warnings.length,
  coveredWarningCount: 0,
  refutedWarnings: [],
  unwarnedMutations: [],
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
