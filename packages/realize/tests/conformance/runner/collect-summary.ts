import { z } from "zod";
import { VERIFICATION_SUMMARY_SCHEMA } from "../verifier/verdicts";

const COLLECT_SUMMARY_SCHEMA = z.object({
  fileCount: z.number(),
  componentCount: z.number(),
  stateCount: z.number(),
  handlerCount: z.number(),
  unreachableBranchCount: z.number(),
  truncatedComponentCount: z.number(),
  bindingCount: z.number(),
  untypedBindingCount: z.number(),
  unresolvedTypeBindingCount: z.number(),
  bailoutCountsByReason: z.record(z.string(), z.number()),
  durationMs: z.number(),
  verification: VERIFICATION_SUMMARY_SCHEMA.nullable(),
});

export type CollectSummary = z.infer<typeof COLLECT_SUMMARY_SCHEMA>;

export const parseCollectSummary = (text: string): CollectSummary =>
  COLLECT_SUMMARY_SCHEMA.parse(JSON.parse(text));
