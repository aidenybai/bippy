import { z } from "zod";
import type { BailoutReason } from "../../../src/core/types";
import type { VerificationSummary } from "../verifier/verdicts";

export interface CollectSummary {
  fileCount: number;
  componentCount: number;
  stateCount: number;
  handlerCount: number;
  unreachableBranchCount: number;
  truncatedComponentCount: number;
  bindingCount: number;
  untypedBindingCount: number;
  unresolvedTypeBindingCount: number;
  bailoutCountsByReason: Partial<Record<BailoutReason, number>>;
  durationMs: number;
  verification: VerificationSummary | null;
}

const COUNTS_SCHEMA = z.record(z.string(), z.number());

const VERIFICATION_SUMMARY_SCHEMA: z.ZodType<VerificationSummary> = z.object({
  verifiedCount: z.number(),
  unmountableCount: z.number(),
  notExportedCount: z.number(),
  counterexampleCount: z.number(),
  predictedStateCount: z.number(),
  coveredStateCount: z.number(),
  branchSideCount: z.number(),
  coveredBranchSideCount: z.number(),
  warningCount: z.number(),
  coveredWarningCount: z.number(),
  unwarnedMutationCount: z.number(),
  mountFailureCounts: COUNTS_SCHEMA,
  durationMs: z.number(),
});

const COLLECT_SUMMARY_SCHEMA: z.ZodType<CollectSummary> = z.object({
  fileCount: z.number(),
  componentCount: z.number(),
  stateCount: z.number(),
  handlerCount: z.number(),
  unreachableBranchCount: z.number(),
  truncatedComponentCount: z.number(),
  bindingCount: z.number(),
  untypedBindingCount: z.number(),
  unresolvedTypeBindingCount: z.number(),
  bailoutCountsByReason: COUNTS_SCHEMA,
  durationMs: z.number(),
  verification: VERIFICATION_SUMMARY_SCHEMA.nullable(),
});

export const parseCollectSummary = (text: string): CollectSummary =>
  COLLECT_SUMMARY_SCHEMA.parse(JSON.parse(text));
