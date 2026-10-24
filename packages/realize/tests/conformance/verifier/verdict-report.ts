import { formatStateLabel } from "../../../src/core/format";
import type { Sample } from "../../../src/core/types";
import type { MountFailure } from "./reasons";
import type { ComponentVerdict, VerificationSummary } from "./verdicts";

export const MAX_RENDERED_LENGTH = 300;

const MAX_PROPS_LENGTH = 160;

const formatSample = (sample: Sample): string => {
  switch (sample.kind) {
    case "Value":
      return JSON.stringify(sample.value);
    case "Array":
      return `[${sample.items.map(formatSample).join(", ")}]`;
    case "Object":
      return "{…}";
    case "Element":
      return "<span>";
    case "Promise":
      return `Promise(${formatSample(sample.value)})`;
    case "Date":
      return `Date(${sample.value})`;
    case "Set":
      return `Set(${sample.items.map(formatSample).join(", ")})`;
    case "Map":
      return "Map(…)";
    case "Function":
      return "fn";
    case "Undefined":
      return "undefined";
  }
};

const formatProps = (props: Record<string, Sample>): string =>
  Object.entries(props)
    .filter(([, sample]) => sample.kind !== "Undefined")
    .map(([name, sample]) => `${name}=${formatSample(sample)}`)
    .join(" ")
    .slice(0, MAX_PROPS_LENGTH) || "no props";

const formatStates = (stateIndices: number[]): string =>
  stateIndices.map(formatStateLabel).join("|");

export const formatCounterexamples = (verdict: ComponentVerdict): string[] => [
  ...verdict.stateCounterexamples.map(
    (counterexample) =>
      `unpredicted state after [${counterexample.path.join(" → ") || "mount"}] with ${formatProps(counterexample.props)}: ${counterexample.reason} (closest ${formatStates([counterexample.closestState])})`,
  ),
  ...verdict.transitionCounterexamples.map(
    (counterexample) =>
      `${counterexample.reason}: ${counterexample.action} went ${formatStates(counterexample.fromStates)} → ${formatStates(counterexample.toStates)}, predicted ${formatStates(counterexample.predictedStates) || "no change"}`,
  ),
  ...verdict.valueCounterexamples.map(
    (counterexample) =>
      `${counterexample.place} = ${counterexample.value}, predicted ${counterexample.predicted.join(" | ")}`,
  ),
  ...verdict.reachedUnreachableBranches.map((claim) => `unreachable branch was reached: ${claim}`),
  ...verdict.refutedWarnings.map((warning) => `mutation warning refuted: ${warning}`),
];

export const countCounterexamples = (verdict: ComponentVerdict): number =>
  verdict.stateCounterexamples.length +
  verdict.transitionCounterexamples.length +
  verdict.valueCounterexamples.length +
  verdict.reachedUnreachableBranches.length +
  verdict.refutedWarnings.length;

export const sum = <Item>(items: Item[], getValue: (item: Item) => number): number =>
  items.reduce((total, item) => total + getValue(item), 0);

export const formatMountFailures = (
  mountFailureCounts: VerificationSummary["mountFailureCounts"],
): string =>
  Object.entries(mountFailureCounts)
    .sort(([, left], [, right]) => (right ?? 0) - (left ?? 0))
    .map(([failure, count]) => `${failure} ${count}`)
    .join(", ");

export const summarizeVerdicts = (
  verdicts: ComponentVerdict[],
  durationMs: number,
): VerificationSummary => {
  const verifiedVerdicts = verdicts.filter((verdict) => verdict.status === "verified");
  const mountFailedVerdicts = verdicts.filter((verdict) => verdict.status === "mount-failed");
  const mountFailureCounts: Partial<Record<MountFailure, number>> = {};
  for (const verdict of mountFailedVerdicts) {
    const failure = verdict.mountFailure ?? "other";
    mountFailureCounts[failure] = (mountFailureCounts[failure] ?? 0) + 1;
  }
  return {
    verifiedCount: verifiedVerdicts.length,
    unmountableCount: mountFailedVerdicts.length,
    notExportedCount: verdicts.filter((verdict) => verdict.status === "not-exported").length,
    counterexampleCount: sum(verifiedVerdicts, countCounterexamples),
    predictedStateCount: sum(verifiedVerdicts, (verdict) => verdict.predictedStateCount),
    coveredStateCount: sum(verifiedVerdicts, (verdict) => verdict.coveredStateIndices.length),
    branchSideCount: sum(verifiedVerdicts, (verdict) => verdict.branchSideCount),
    coveredBranchSideCount: sum(verifiedVerdicts, (verdict) => verdict.coveredBranchSideCount),
    warningCount: sum(verifiedVerdicts, (verdict) => verdict.warningCount),
    coveredWarningCount: sum(verifiedVerdicts, (verdict) => verdict.coveredWarningCount),
    unwarnedMutationCount: sum(verifiedVerdicts, (verdict) => verdict.unwarnedMutations.length),
    mountFailureCounts,
    durationMs,
  };
};
