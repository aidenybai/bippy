import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { analyzeProject } from "../core/project/analyze-project";
import { ConfigError } from "../core/project/config-error";
import { serializeProjectAnalysis } from "../core/project/serialize";
import { createTracer, NO_TRACER } from "../core/project/tracer";
import { checkInvariant, type InvariantResult } from "../core/model/check-invariant";
import { getViewLabel } from "../core/model/explore";
import { formatTla } from "../core/model/tla";
import type { InvariantDefinition } from "../core/model/tla";
import type { TraceStep } from "../core/model/types";
import { formatMermaid } from "./mermaid";
import { DEFAULT_RENDER_DEPTH, formatRenderTree } from "./render-tree";
import type { AnalyzedComponent, ProjectAnalysis } from "../core/types";
import { parsePositiveInteger } from "./parse-positive-integer";

interface AnalyzeCliOptions {
  component?: string[];
  file?: string;
  depth: number;
  json: boolean;
  tla: boolean;
  invariant?: string[];
  trace?: string;
}

const INVARIANT_PATTERN = /^\s*([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.+)$/s;

const parseInvariant = (text: string): InvariantDefinition => {
  const match = INVARIANT_PATTERN.exec(text);
  if (!match) throw new ConfigError(`Write an invariant as "Name: expression", not ${text}`);
  return { name: match[1], expression: match[2] };
};

const formatBailoutCounts = (reasons: string[]): string[] => {
  const countsByReason = new Map<string, number>();
  for (const reason of reasons) countsByReason.set(reason, (countsByReason.get(reason) ?? 0) + 1);
  return [...countsByReason]
    .sort((left, right) => right[1] - left[1])
    .map(([reason, count]) => `${reason} ${count}`);
};

const formatTotals = (
  { components, fileCount, unparsedFiles }: ProjectAnalysis,
  elapsedMs: number,
): string[] => {
  const stateCount = components.reduce(
    (total, { model }) => total + model.stateSpace.stateCount,
    0,
  );
  const findingCount = components.reduce((total, { model }) => total + model.findings.length, 0);
  const bailoutCounts = formatBailoutCounts(
    components.flatMap(({ analysis }) => analysis.bailouts.map((bailout) => bailout.reason)),
  );
  return [
    `${components.length} components · ${stateCount} states · ${findingCount} findings · ${fileCount} files · ${elapsedMs} ms`,
    ...(bailoutCounts.length > 0 ? [`bailouts: ${bailoutCounts.join(", ")}`] : []),
    ...(unparsedFiles.length > 0 ? [`could not parse: ${unparsedFiles.join(", ")}`] : []),
  ];
};

const formatTraceStep = (step: TraceStep, index: number): string => {
  const state = Object.entries(step.state)
    .map(([variable, value]) => `${variable}=${value}`)
    .join(", ");
  const head = index === 0 ? "start" : (step.action ?? "step");
  return `  ${index + 1}. ${head}: ${state} → ${step.view}`;
};

const formatInvariantResult = (component: AnalyzedComponent, result: InvariantResult): string => {
  const title = `${component.analysis.name} ${result.name}`;
  switch (result.status) {
    case "holds":
      return `${title}: holds`;
    case "violated":
      return [`${title}: violated`, ...result.trace.map(formatTraceStep)].join("\n");
    case "error":
      return `${title}: error, ${result.message}`;
  }
};

const checkInvariants = async (
  components: AnalyzedComponent[],
  invariants: InvariantDefinition[],
): Promise<string> => {
  const lines: string[] = [];
  for (const component of components)
    for (const invariant of invariants) {
      const result = await checkInvariant(
        component.analysis.name,
        component.model,
        invariant,
        (state) => getViewLabel(component.model.views, state),
      );
      lines.push(formatInvariantResult(component, result));
    }
  return lines.join("\n");
};

const formatOutput = (
  components: AnalyzedComponent[],
  analysis: ProjectAnalysis,
  options: AnalyzeCliOptions,
  rootDirectory: string,
): string => {
  if (options.json) return serializeProjectAnalysis({ ...analysis, components });
  if (options.tla)
    return components
      .map((component) => formatTla(component.analysis.name, component.model))
      .join("\n\n");
  return components
    .flatMap((component) => [
      formatRenderTree(component, { rootDirectory, maxDepth: options.depth }),
      formatMermaid(component, { rootDirectory }),
    ])
    .join("\n\n");
};

const runAnalyze = async (tsconfig: string, options: AnalyzeCliOptions): Promise<void> => {
  const startTime = performance.now();
  const configPath = resolve(tsconfig);
  const rootDirectory = dirname(configPath);
  const tracer = options.trace ? createTracer(rootDirectory) : NO_TRACER;
  const invariants = (options.invariant ?? []).map(parseInvariant);
  const analysis = analyzeProject(configPath, options.file ?? null, tracer);
  if (options.file && analysis.components.length === 0)
    throw new ConfigError(`No component is in a file matching ${options.file}`);
  const componentNames = options.component;
  const unmatchedNames = (componentNames ?? []).filter(
    (name) => !analysis.components.some((component) => component.analysis.name === name),
  );
  if (unmatchedNames.length > 0)
    throw new ConfigError(`No component named ${unmatchedNames.join(", ")}`);
  const components = componentNames
    ? analysis.components.filter((component) => componentNames.includes(component.analysis.name))
    : analysis.components;
  const output =
    invariants.length > 0
      ? await checkInvariants(components, invariants)
      : tracer.span("output", "output", () =>
          formatOutput(components, analysis, options, rootDirectory),
        );
  console.log(output);
  if (options.trace) writeFileSync(options.trace, JSON.stringify({ traceEvents: tracer.events }));
  if (options.json || options.tla) return;
  const elapsedMs = Math.round(performance.now() - startTime);
  for (const line of formatTotals({ ...analysis, components }, elapsedMs)) console.error(line);
};

new Command()
  .name("analyze")
  .description(
    "Derive a state chart for each React component from source, without running it. Prints Mermaid, JSON or TLA+, and checks invariants with tla-ts.",
  )
  .argument("[tsconfig]", "path to the project's tsconfig.json", "tsconfig.json")
  .option("-c, --component <names...>", "only show these components")
  .option(
    "-f, --file <filter>",
    "only model components in files whose path contains this text; the whole project is still compiled",
  )
  .option(
    "-d, --depth <n>",
    "maximum render tree depth",
    parsePositiveInteger,
    DEFAULT_RENDER_DEPTH,
  )
  .option("--json", "print the analyses as JSON instead", false)
  .option("--tla", "print each component as a TLA+ module instead", false)
  .option(
    "-i, --invariant <invariants...>",
    'check invariants written as "Name: TLA+ expression" over the variables and view',
  )
  .option("--trace <file>", "write the time and memory of each phase as a Chrome trace")
  .action(async (tsconfig: string, options: AnalyzeCliOptions) => {
    try {
      await runAnalyze(tsconfig, options);
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      console.error(error.message);
      process.exitCode = 1;
    }
  })
  .parseAsync();
