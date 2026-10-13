import { readFileSync } from "node:fs";
import type { Binding, ComponentAnalysis, Warning } from "../../../src/core/types";
import { formatLine } from "../../../src/core/format";
import { GeneratedSource } from "../../../src/react-compiler/HIR/HIR";
import type { SourceLocation } from "../../../src/react-compiler/HIR/HIR";
import type { Observation } from "./driver";
import type { Probe } from "./server";

interface WarningScore {
  coveredWarnings: number;
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

export const createMutationProbe = (
  file: string,
  sourceText: string,
  loc: SourceLocation,
): Probe | null => {
  if (loc === GeneratedSource) return null;
  const text = sourceText.slice(loc.start.index, loc.end.index);
  if (!PLACE_PATTERN.test(text) || !MEMBER_ACCESS_PATTERN.test(sourceText.slice(loc.end.index)))
    return null;
  return {
    id: `mutation:${file}:${loc.start.index}`,
    file,
    start: loc.start.index,
    end: loc.end.index,
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

const createSourceReader = (): ((file: string) => string) => {
  const sources = new Map<string, string>();
  return (file) => {
    const source = sources.get(file) ?? readFileSync(file, "utf8");
    sources.set(file, source);
    return source;
  };
};

const getProbedWarnings = (
  analysis: ComponentAnalysis,
  stateBindings: Binding[] | null,
): ProbedWarning[] => {
  const readSource = createSourceReader();
  return analysis.warnings.map((warning) => {
    const sourceText = readSource(warning.file);
    const probe = createMutationProbe(warning.file, sourceText, warning.loc);
    const placeText = probe ? sourceText.slice(probe.start, probe.end) : null;
    return {
      warning,
      probe,
      isOwner: getOwnerPredicate(warning, analysis.bindings, stateBindings, placeText),
    };
  });
};

export const collectMutationProbes = (analysis: ComponentAnalysis): Probe[] => {
  const readSource = createSourceReader();
  return analysis.warnings.flatMap(
    (warning) => createMutationProbe(warning.file, readSource(warning.file), warning.loc) ?? [],
  );
};

const formatWarning = (warning: Warning): string =>
  `${[warning.kind, formatLine(warning.loc)].filter(Boolean).join(" ")}: ${warning.message}`;

const formatOwner = (owner: string, stateBindings: Binding[] | null): string => {
  const [kind, name] = owner.split(":");
  if (kind === "prop") return `prop ${name}`;
  const binding = stateBindings?.[Number(name)];
  return binding ? `state ${binding.name}` : `state hook ${name}`;
};

// Unwarned mutations aren't refutations: the analyzer only warns on mutations it can prove.
export const scoreWarnings = (
  analysis: ComponentAnalysis,
  observations: Observation[],
  stateBindings: Binding[] | null,
): WarningScore => {
  const probedWarnings = getProbedWarnings(analysis, stateBindings);
  const score: WarningScore = { coveredWarnings: 0, refutedWarnings: [], unwarnedMutations: [] };
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
    if (isWitnessed) score.coveredWarnings++;
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
