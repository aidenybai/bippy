import { relative } from "node:path";
import { GeneratedSource } from "../react-compiler/HIR/HIR";
import type { AnalyzedComponent, ClaimOutcome, Region, StateReport } from "../core/types";
import { formatLine, formatStateLabel } from "../core/format";
import { describeState, type StateDescriber } from "./describe-state";
import { createSourceReader } from "./source-text";
import { collectTriggerLabels } from "./trigger-labels";
import { unescapeQuotedLiterals } from "./text";

export const DEFAULT_MAX_STATES = 32;

export interface MermaidOptions {
  rootDirectory: string;
  maxStates: number;
}

interface DiagramContext {
  report: StateReport;
  triggerLabelsByHandler: Map<string, string>;
  listedStates: Set<number>;
  describer: StateDescriber;
}

interface RegionEdges extends Map<string, Map<number, Set<number>>> {}

const INDENT = "  ";
const REGION_SEPARATOR = "--";
const MIN_FAN_OUT_STATES = 3;

const escapeText = (text: string): string =>
  unescapeQuotedLiterals(text)
    .replaceAll(/\s*\n\s*/g, " ")
    .replaceAll(";", "#59;")
    .replaceAll(":", "#58;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;");

const indent = (line: string): string => `${INDENT}${line}`;

const getMoreId = (regionIndex: number): string => `more${regionIndex + 1}`;

const getHubId = (regionIndex: number, hubIndex: number): string =>
  `any${regionIndex + 1}_${hubIndex + 1}`;

const getTransitionLabel = (handlerId: string, isAsync: boolean, context: DiagramContext): string =>
  escapeText(
    `${context.triggerLabelsByHandler.get(handlerId) ?? handlerId}${isAsync ? " (async)" : ""}`,
  );

const getMoreLabel = (region: Region, listedCount: number): string | null => {
  const hiddenCount = region.states.length - listedCount;
  if (hiddenCount > 0)
    return `… ${hiddenCount} more states${region.isTruncated ? ", and more not listed" : ""}`;
  return region.isTruncated ? "… more states not listed" : null;
};

const collectRegionEdges = (listed: number[], context: DiagramContext): RegionEdges => {
  const edges: RegionEdges = new Map();
  for (const stateIndex of listed) {
    for (const transition of context.report.states[stateIndex]?.transitions ?? []) {
      const label = getTransitionLabel(transition.handlerId, transition.isAsync, context);
      const sources = edges.get(label) ?? new Map<number, Set<number>>();
      const targets = sources.get(stateIndex) ?? new Set<number>();
      for (const target of transition.targets) if (target !== stateIndex) targets.add(target);
      sources.set(stateIndex, targets);
      edges.set(label, sources);
    }
  }
  return edges;
};

const isCompleteFanOut = (sources: Map<number, Set<number>>, listed: number[]): boolean =>
  listed.length >= MIN_FAN_OUT_STATES &&
  listed.every((source) =>
    listed.every((target) => target === source || sources.get(source)?.has(target)),
  );

const getFanOutLabels = (edges: RegionEdges, listed: number[]): string[] =>
  [...edges].filter(([, sources]) => isCompleteFanOut(sources, listed)).map(([label]) => label);

const formatFanOutLines = (labels: string[], listed: number[], regionIndex: number): string[] =>
  labels.flatMap((label, hubIndex) => {
    const hubId = getHubId(regionIndex, hubIndex);
    return [
      `${hubId}: ${label} · from any state`,
      ...listed.map((stateIndex) => `${hubId} --> ${formatStateLabel(stateIndex)}`),
    ];
  });

const formatEdgeLines = (
  edges: RegionEdges,
  fanOutLabels: Set<string>,
  regionIndex: number,
  context: DiagramContext,
): string[] => {
  const lines: string[] = [];
  for (const [label, sources] of edges) {
    for (const [source, targets] of sources) {
      for (const target of targets) {
        const isListed = context.listedStates.has(target);
        if (isListed && fanOutLabels.has(label)) continue;
        const targetId = isListed ? formatStateLabel(target) : getMoreId(regionIndex);
        lines.push(`${formatStateLabel(source)} --> ${targetId}: ${label}`);
      }
    }
  }
  return [...new Set(lines)];
};

const formatRegionLines = (
  region: Region,
  regionIndex: number,
  hasRegions: boolean,
  context: DiagramContext,
): string[] => {
  const listed = region.states.filter((stateIndex) => context.listedStates.has(stateIndex));
  const lines = hasRegions ? [`%% ${region.placeNames.join(", ")}`] : [];
  for (const stateIndex of listed) {
    const state = context.report.states[stateIndex];
    if (!state) continue;
    const description = escapeText(describeState(state, hasRegions, context.describer));
    lines.push(`${formatStateLabel(stateIndex)}: ${description}`);
  }
  const moreLabel = getMoreLabel(region, listed.length);
  if (moreLabel) lines.push(`${getMoreId(regionIndex)}: ${moreLabel}`);
  for (const stateIndex of region.possibleFirstRenderStates)
    if (context.listedStates.has(stateIndex)) lines.push(`[*] --> ${formatStateLabel(stateIndex)}`);
  const edges = collectRegionEdges(listed, context);
  const fanOutLabels = getFanOutLabels(edges, listed);
  lines.push(...formatFanOutLines(fanOutLabels, listed, regionIndex));
  lines.push(...formatEdgeLines(edges, new Set(fanOutLabels), regionIndex, context));
  return lines;
};

const formatGroupLines = (title: string, id: string, entries: string[]): string[] =>
  entries.length === 0
    ? []
    : [
        `state "${title}" as ${id} {`,
        ...entries.map((entry, index) => indent(`${id}${index + 1}: ${escapeText(entry)}`)),
        "}",
      ];

const formatClaimOutcome = (outcome: ClaimOutcome, context: DiagramContext): string => {
  const { claim } = outcome;
  const where = outcome.stateIndex === null ? "" : ` in S${outcome.stateIndex + 1}`;
  const path =
    outcome.path.length === 0
      ? ""
      : ` after ${outcome.path.map((handlerId) => context.triggerLabelsByHandler.get(handlerId) ?? handlerId).join(", ")}`;
  const reason = outcome.reason === null ? "" : ` · ${outcome.reason}`;
  return `${outcome.verdict} ${claim.description} ${formatLine(claim.loc)}${where}${path}${reason}`.trim();
};

const formatClaimLines = (component: AnalyzedComponent, context: DiagramContext): string[] => {
  const { analysis, report } = component;
  return [
    ...formatGroupLines(
      "claims",
      "claims",
      report.claimOutcomes.map((outcome) => formatClaimOutcome(outcome, context)),
    ),
    ...formatGroupLines(
      "unreachable branches",
      "unreachable",
      report.unreachableBranches.map((unreachableBranch) =>
        `${unreachableBranch.description} ${formatLine(unreachableBranch.branch.loc)}`.trim(),
      ),
    ),
    ...formatGroupLines(
      "warnings",
      "warnings",
      analysis.warnings.map(
        (warning) => `${warning.kind} ${formatLine(warning.loc)} ${warning.message}`,
      ),
    ),
    ...formatGroupLines(
      "bailouts",
      "bailouts",
      analysis.bailouts.map(
        (bailout) => `${bailout.reason} ${formatLine(bailout.loc)} ${bailout.message}`,
      ),
    ),
  ];
};

const formatStateLines = (component: AnalyzedComponent, context: DiagramContext): string[] => {
  const { analysis, report } = component;
  if (report.regions.length <= 1)
    return report.regions.flatMap((region, regionIndex) =>
      formatRegionLines(region, regionIndex, false, context),
    );
  const regionLines = report.regions.map((region, regionIndex) =>
    formatRegionLines(region, regionIndex, true, context),
  );
  return [
    `state "${analysis.name}" as regions {`,
    ...regionLines.flatMap((lines, regionIndex) =>
      [...(regionIndex > 0 ? [REGION_SEPARATOR] : []), ...lines].map(indent),
    ),
    "}",
  ];
};

const createDiagramContext = (
  component: AnalyzedComponent,
  options: MermaidOptions,
): DiagramContext => {
  const sourceReader = createSourceReader();
  return {
    report: component.report,
    triggerLabelsByHandler: collectTriggerLabels(component, sourceReader),
    listedStates: new Set(
      component.report.regions.flatMap((region) => region.states.slice(0, options.maxStates)),
    ),
    describer: { file: component.analysis.file, sourceReader },
  };
};

export const formatMermaid = (component: AnalyzedComponent, options: MermaidOptions): string => {
  const { analysis } = component;
  const context = createDiagramContext(component, options);
  const lineSuffix = analysis.loc === GeneratedSource ? "" : `:${analysis.loc.start.line}`;
  const location = `${relative(options.rootDirectory, analysis.file)}${lineSuffix}`;
  return [
    "---",
    `title: ${analysis.name} ${location}`,
    "---",
    "stateDiagram-v2",
    indent("direction LR"),
    ...formatStateLines(component, context).map(indent),
    ...formatClaimLines(component, context).map(indent),
  ].join("\n");
};
