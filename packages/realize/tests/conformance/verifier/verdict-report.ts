import type { Sample } from "../../../src/core/types";
import type { MountFailure } from "./reasons";
import { isMountFailedVerdict } from "./verdicts";
import type { ComponentVerdict, VerificationSummary } from "./verdicts";

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

const formatPath = (path: string[]): string => path.join(" → ") || "mount";

export const formatCounterexamples = (verdict: ComponentVerdict): string[] => [
  ...verdict.renderCounterexamples.map(
    (counterexample) =>
      `no model state renders this after [${formatPath(counterexample.path)}] with ${formatProps(counterexample.props)}: ${[...counterexample.sides, ...counterexample.values].join(", ") || "nothing observed"}`,
  ),
  ...verdict.transitionCounterexamples.map(
    (counterexample) =>
      `no model transition explains ${counterexample.action} after [${formatPath(counterexample.path)}] (ran ${counterexample.handlers.join(", ")})`,
  ),
  ...verdict.valueCounterexamples.map(
    (counterexample) =>
      `${counterexample.variable} = ${counterexample.value} is outside the domain ${counterexample.domain.join(" | ")}`,
  ),
  ...verdict.reachedUnreachableSides.map((side) => `unreachable branch ran: ${side}`),
  ...verdict.refutedWarnings.map((warning) => `mutation warning refuted: ${warning}`),
];

export const countCounterexamples = (verdict: ComponentVerdict): number =>
  verdict.renderCounterexamples.length +
  verdict.transitionCounterexamples.length +
  verdict.valueCounterexamples.length +
  verdict.reachedUnreachableSides.length +
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
  const mountFailedVerdicts = verdicts.filter(isMountFailedVerdict);
  const mountFailureCounts: Partial<Record<MountFailure, number>> = {};
  for (const verdict of mountFailedVerdicts) {
    mountFailureCounts[verdict.mountFailure] = (mountFailureCounts[verdict.mountFailure] ?? 0) + 1;
  }
  return {
    verifiedCount: verifiedVerdicts.length,
    unmountableCount: mountFailedVerdicts.length,
    notExportedCount: verdicts.filter((verdict) => verdict.status === "not-exported").length,
    counterexampleCount: sum(verifiedVerdicts, countCounterexamples),
    viewCount: sum(verifiedVerdicts, (verdict) => verdict.viewCount),
    coveredViewCount: sum(verifiedVerdicts, (verdict) => verdict.coveredViews.length),
    branchSideCount: sum(verifiedVerdicts, (verdict) => verdict.branchSideCount),
    coveredBranchSideCount: sum(verifiedVerdicts, (verdict) => verdict.coveredBranchSideCount),
    warningCount: sum(verifiedVerdicts, (verdict) => verdict.warningCount),
    coveredWarningCount: sum(verifiedVerdicts, (verdict) => verdict.coveredWarningCount),
    unwarnedMutationCount: sum(verifiedVerdicts, (verdict) => verdict.unwarnedMutations.length),
    mountFailureCounts,
    durationMs,
  };
};
