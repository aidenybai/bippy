import { readFileSync } from "node:fs";
import type { Binding, ComponentAnalysis, Warning } from "../../../src/core/types";
import { formatLine } from "../../../src/core/values/format";
import { GeneratedSource } from "../../../src/react-compiler/HIR/HIR";
import type { SourceLocation } from "../../../src/react-compiler/HIR/HIR";
import type { Observation } from "./driver";
import type { ComponentVerdict } from "./verdicts";
import { getPropOrigin, getStateOrigin, parseOrigin } from "./types";
import type { Counter } from "./types";

interface OriginPredicate {
  (origin: string | null): boolean;
}

interface WarningScore extends Pick<
  ComponentVerdict,
  "coveredWarningCount" | "refutedWarnings" | "unwarnedMutations"
> {}

interface InstrumentedWarning {
  warning: Warning;
  counter: Counter | null;
  isOrigin: OriginPredicate;
}

const PLACE_PATTERN = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;
const MEMBER_ACCESS_PATTERN = /^!?(\?\.|\.|\[)/;

export const createMutationCounter = (
  file: string,
  sourceText: string,
  loc: SourceLocation,
): Counter | null => {
  if (loc === GeneratedSource) return null;
  const text = sourceText.slice(loc.start.index, loc.end.index);
  if (!PLACE_PATTERN.test(text) || !MEMBER_ACCESS_PATTERN.test(sourceText.slice(loc.end.index)))
    return null;
  return {
    id: `mutation:${file}:${loc.start.index}`,
    file,
    start: loc.start.index,
    end: loc.end.index,
    kind: "mutation",
  };
};

const getOriginPredicate = (
  warning: Warning,
  bindings: Binding[],
  stateBindings: Binding[] | null,
  placeText: string | null,
): OriginPredicate => {
  const rootName = placeText?.split(".")[0];
  if (warning.kind === "prop-mutation") {
    const propName = bindings.find(
      (binding) => binding.kind === "prop" && binding.name === rootName,
    )?.propName;
    return (origin) =>
      propName
        ? origin === getPropOrigin(propName)
        : origin !== null && parseOrigin(origin).kind === "prop";
  }
  const hookIndex = stateBindings?.findIndex((binding) => binding.name === rootName) ?? -1;
  return (origin) =>
    hookIndex >= 0
      ? origin === getStateOrigin(hookIndex)
      : origin !== null && parseOrigin(origin).kind === "state";
};

const createSourceReader = (): ((file: string) => string) => {
  const sources = new Map<string, string>();
  return (file) => {
    const source = sources.get(file) ?? readFileSync(file, "utf8");
    sources.set(file, source);
    return source;
  };
};

const getInstrumentedWarnings = (
  analysis: ComponentAnalysis,
  stateBindings: Binding[] | null,
): InstrumentedWarning[] => {
  const readSource = createSourceReader();
  return analysis.warnings.map((warning) => {
    const sourceText = readSource(warning.file);
    const counter = createMutationCounter(warning.file, sourceText, warning.loc);
    const placeText = counter ? sourceText.slice(counter.start, counter.end) : null;
    return {
      warning,
      counter,
      isOrigin: getOriginPredicate(warning, analysis.bindings, stateBindings, placeText),
    };
  });
};

export const collectMutationCounters = (analysis: ComponentAnalysis): Counter[] =>
  getInstrumentedWarnings(analysis, null).flatMap((instrumented) => instrumented.counter ?? []);

const formatWarning = (warning: Warning): string =>
  `${[warning.kind, formatLine(warning.loc)].filter(Boolean).join(" ")}: ${warning.message}`;

const formatOrigin = (origin: string, stateBindings: Binding[] | null): string => {
  const { kind, name } = parseOrigin(origin);
  if (kind === "prop") return `prop ${name}`;
  const binding = stateBindings?.[Number(name)];
  return binding ? `state ${binding.name}` : `state hook ${name}`;
};

const isWarningWitnessed = (
  instrumented: InstrumentedWarning,
  observations: Observation[],
): boolean | null => {
  const counterId = instrumented.counter?.id;
  if (counterId === undefined) return null;
  const hits = observations.flatMap((observation) =>
    observation.after.mutationHits.filter(
      (hit) => hit.id === counterId && instrumented.isOrigin(hit.origin),
    ),
  );
  if (hits.length === 0) return null;
  return hits.some((hit) =>
    instrumented.warning.kind === "lost-update" ? hit.isLost : hit.isWritten,
  );
};

const collectUnwarnedMutations = (
  observations: Observation[],
  instrumentedWarnings: InstrumentedWarning[],
  stateBindings: Binding[] | null,
): string[] => {
  const unwarned = new Map<string, string>();
  for (const observation of observations) {
    for (const origin of observation.after.mutatedOrigins) {
      const isWarned =
        observation.after.mutationHits.some((hit) => hit.origin === origin && hit.isWritten) ||
        instrumentedWarnings.some(
          (instrumented) => !instrumented.counter && instrumented.isOrigin(origin),
        );
      const description = formatOrigin(origin, stateBindings);
      if (!isWarned && !unwarned.has(description))
        unwarned.set(
          description,
          `${description} after [${observation.path.join(" → ") || "mount"}]`,
        );
    }
  }
  return [...unwarned.values()];
};

export const checkWarnings = (
  analysis: ComponentAnalysis,
  observations: Observation[],
  stateBindings: Binding[] | null,
): WarningScore => {
  const instrumentedWarnings = getInstrumentedWarnings(analysis, stateBindings);
  let coveredWarningCount = 0;
  const refutedWarnings: string[] = [];
  for (const instrumented of instrumentedWarnings) {
    const isWitnessed = isWarningWitnessed(instrumented, observations);
    if (isWitnessed === true) coveredWarningCount++;
    if (isWitnessed === false) refutedWarnings.push(formatWarning(instrumented.warning));
  }
  return {
    coveredWarningCount,
    refutedWarnings,
    unwarnedMutations: collectUnwarnedMutations(observations, instrumentedWarnings, stateBindings),
  };
};
