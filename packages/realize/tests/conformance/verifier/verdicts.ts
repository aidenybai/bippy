import { z } from "zod";
import type { ComponentAnalysis, Sample } from "../../../src/core/types";
import type { ComponentModel } from "../../../src/core/model/types";
import type { Observation } from "./driver";
import { getCaptureFailure } from "./reasons";
import type { MountFailure } from "./reasons";

interface RenderCounterexample {
  props: Record<string, Sample>;
  path: string[];
  edges: string[];
  values: string[];
}

interface TransitionCounterexample {
  path: string[];
  action: string;
  handlers: string[];
}

interface DomainCounterexample {
  path: string[];
  variable: string;
  value: string;
  domain: string[];
}

type VerdictOutcome =
  | { status: "verified" | "not-exported"; error: null; mountFailure: null }
  | { status: "mount-failed"; error: string; mountFailure: MountFailure };

interface VerdictFields {
  name: string;
  file: string;
  isTruncated: boolean;
  observationCount: number;
  renderErrorCount: number;
  viewCount: number;
  coveredViews: string[];
  checkedTransitionCount: number;
  branchEdgeCount: number;
  coveredBranchEdgeCount: number;
  unreachableEdgesTaken: string[];
  renderCounterexamples: RenderCounterexample[];
  transitionCounterexamples: TransitionCounterexample[];
  domainCounterexamples: DomainCounterexample[];
  warningCount: number;
  coveredWarningCount: number;
  refutedWarnings: string[];
  unwarnedMutations: string[];
  durationMs: number;
}

export type ComponentVerdict = VerdictFields & VerdictOutcome;

type MountFailedVerdict = Extract<ComponentVerdict, { status: "mount-failed" }>;

export const isMountFailedVerdict = (verdict: ComponentVerdict): verdict is MountFailedVerdict =>
  verdict.status === "mount-failed";

export const VERIFICATION_SUMMARY_SCHEMA = z.object({
  verifiedCount: z.number(),
  unmountableCount: z.number(),
  notExportedCount: z.number(),
  counterexampleCount: z.number(),
  viewCount: z.number(),
  coveredViewCount: z.number(),
  branchEdgeCount: z.number(),
  coveredBranchEdgeCount: z.number(),
  warningCount: z.number(),
  coveredWarningCount: z.number(),
  unwarnedMutationCount: z.number(),
  mountFailureCounts: z.record(z.string(), z.number()),
  durationMs: z.number(),
});

export type VerificationSummary = z.infer<typeof VERIFICATION_SUMMARY_SCHEMA>;

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
  branchEdgeCount: 0,
  coveredBranchEdgeCount: 0,
  unreachableEdgesTaken: [],
  renderCounterexamples: [],
  transitionCounterexamples: [],
  domainCounterexamples: [],
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
