import { readFileSync } from "node:fs";
import type { SourceLocation } from "../../src/core/hir/hir.js";
import type { Binding, ComponentAnalysis, Warning } from "../../src/core/inference/types.js";
import type { Observation } from "./driver.js";
import type { Probe } from "./server.js";

interface WarningScore {
  witnessedWarnings: number;
  refutedWarnings: string[];
  unwarnedMutations: string[];
}

interface ProbedWarning {
  warning: Warning;
  probe: Probe | null;
  isOwner: (owner: string | null) => boolean;
}

const PLACE_PATTERN = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;
const MEMBER_ACCESS_PATTERN = /^!?(\?\.|\.|\[)/;

/**
 * Probes the place a warning says is mutated, when it is a plain reference read for a
 * member access like `tags.push(…)`, so the page can watch that exact object.
 */
export const createMutationProbe = (
  file: string,
  sourceText: string,
  loc: SourceLocation,
): Probe | null => {
  if (typeof loc === "symbol") return null;
  const text = sourceText.slice(loc.start, loc.end);
  if (!PLACE_PATTERN.test(text) || !MEMBER_ACCESS_PATTERN.test(sourceText.slice(loc.end)))
    return null;
  return {
    id: `mutation:${file}:${loc.start}`,
    file,
    start: loc.start,
    end: loc.end,
    mode: "mutation",
  };
};

const getOwnerPredicate = (
  warning: Warning,
  bindings: Binding[],
  stateBindings: Binding[] | null,
  placeText: string | null,
): ((owner: string | null) => boolean) => {
  const rootName = placeText?.split(".")[0];
  if (warning.kind === "prop-mutation") {
    const propName = bindings.find(
      (binding) => binding.kind === "prop" && binding.name === rootName,
    )?.propName;
    return (owner) =>
      propName ? owner === `prop:${propName}` : Boolean(owner?.startsWith("prop:"));
  }
  const hookIndex = stateBindings?.findIndex((binding) => binding.name === rootName) ?? -1;
  return (owner) =>
    hookIndex >= 0 ? owner === `state:${hookIndex}` : Boolean(owner?.startsWith("state:"));
};

const getProbedWarnings = (
  analysis: ComponentAnalysis,
  stateBindings: Binding[] | null,
): ProbedWarning[] => {
  if (analysis.warnings.length === 0) return [];
  const sourceText = readFileSync(analysis.file, "utf8");
  return analysis.warnings.map((warning) => {
    const probe = createMutationProbe(analysis.file, sourceText, warning.loc);
    const placeText = probe ? sourceText.slice(probe.start, probe.end) : null;
    return {
      warning,
      probe,
      isOwner: getOwnerPredicate(warning, analysis.bindings, stateBindings, placeText),
    };
  });
};

export const collectMutationProbes = (analysis: ComponentAnalysis): Probe[] =>
  getProbedWarnings(analysis, null).flatMap((probed) => (probed.probe ? [probed.probe] : []));

const formatWarning = (warning: Warning): string =>
  typeof warning.loc === "symbol"
    ? `${warning.kind}: ${warning.message}`
    : `${warning.kind} L${warning.loc.line}: ${warning.message}`;

const formatOwner = (owner: string, stateBindings: Binding[] | null): string => {
  const [kind, name] = owner.split(":");
  if (kind === "prop") return `prop ${name}`;
  const binding = stateBindings?.[Number(name)];
  return binding ? `state ${binding.name}` : `state hook ${name}`;
};

/**
 * Checks each mutation warning against what the page saw. A warning is witnessed when its
 * probed object was written (and, for a lost update, React didn't re-render), refuted when
 * the probed code ran on the right owner but never mutated it. Runtime mutations of state
 * or props that no warning covers are listed as unwarned, which isn't a wrong claim since
 * the analyzer only reports mutations it can prove.
 */
export const scoreWarnings = (
  analysis: ComponentAnalysis,
  observations: Observation[],
  stateBindings: Binding[] | null,
): WarningScore => {
  const probedWarnings = getProbedWarnings(analysis, stateBindings);
  const score: WarningScore = { witnessedWarnings: 0, refutedWarnings: [], unwarnedMutations: [] };
  for (const probed of probedWarnings) {
    if (!probed.probe) continue;
    const probeId = probed.probe.id;
    const hits = observations.flatMap((observation) =>
      observation.after.mutationHits.filter(
        (hit) => hit.id === probeId && probed.isOwner(hit.owner),
      ),
    );
    if (hits.length === 0) continue;
    const isWitnessed = hits.some((hit) =>
      probed.warning.kind === "lost-update" ? hit.isLost : hit.isWritten,
    );
    if (isWitnessed) score.witnessedWarnings++;
    else score.refutedWarnings.push(formatWarning(probed.warning));
  }
  const unwarned = new Map<string, string>();
  for (const observation of observations) {
    for (const owner of observation.after.mutatedOwners) {
      const isWarned =
        observation.after.mutationHits.some((hit) => hit.owner === owner && hit.isWritten) ||
        probedWarnings.some((probed) => !probed.probe && probed.isOwner(owner));
      const description = formatOwner(owner, stateBindings);
      if (!isWarned && !unwarned.has(description))
        unwarned.set(
          description,
          `${description} after [${observation.path.join(" → ") || "mount"}]`,
        );
    }
  }
  score.unwarnedMutations = [...unwarned.values()];
  return score;
};
