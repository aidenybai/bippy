import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { analyzeProject } from "../core/analyze-project";
import { ConfigError } from "../core/config-error";
import { serializeProjectAnalysis } from "../core/serialize";
import { createTracer, NO_TRACER } from "../core/tracer";
import { DEFAULT_MAX_STATES, formatMermaid } from "./mermaid";
import { DEFAULT_RENDER_DEPTH, formatRenderTree } from "./render-tree";
import type { ProjectAnalysis } from "../core/types";
import { parsePositiveInteger } from "./parse-positive-integer";

interface AnalyzeCliOptions {
  component?: string[];
  file?: string;
  depth: number;
  states: number;
  json: boolean;
  trace?: string;
}

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
  const stateCount = components.reduce((total, { report }) => total + report.states.length, 0);
  const bailoutCounts = formatBailoutCounts(
    components.flatMap(({ analysis }) => analysis.bailouts.map((bailout) => bailout.reason)),
  );
  return [
    `${components.length} components · ${stateCount} states · ${fileCount} files · ${elapsedMs} ms`,
    ...(bailoutCounts.length > 0 ? [`bailouts: ${bailoutCounts.join(", ")}`] : []),
    ...(unparsedFiles.length > 0 ? [`could not parse: ${unparsedFiles.join(", ")}`] : []),
  ];
};

const runAnalyze = (tsconfig: string, options: AnalyzeCliOptions): void => {
  const startTime = performance.now();
  const configPath = resolve(tsconfig);
  const rootDirectory = dirname(configPath);
  const tracer = options.trace ? createTracer(rootDirectory) : NO_TRACER;
  const {
    components: allComponents,
    fileCount,
    unparsedFiles,
  } = analyzeProject(configPath, options.file ?? null, tracer);
  if (options.file && allComponents.length === 0)
    throw new ConfigError(`No component is in a file matching ${options.file}`);
  const componentNames = options.component;
  const unmatchedNames = (componentNames ?? []).filter(
    (name) => !allComponents.some(({ analysis }) => analysis.name === name),
  );
  if (unmatchedNames.length > 0)
    throw new ConfigError(`No component named ${unmatchedNames.join(", ")}`);
  const components = componentNames
    ? allComponents.filter(({ analysis }) => componentNames.includes(analysis.name))
    : allComponents;
  const output = tracer.span("output", options.json ? "json" : "mermaid", () =>
    options.json
      ? serializeProjectAnalysis({ components, fileCount, unparsedFiles })
      : components
          .flatMap((component) => [
            formatRenderTree(component, { rootDirectory, maxDepth: options.depth }),
            formatMermaid(component, { rootDirectory, maxStates: options.states }),
          ])
          .join("\n\n"),
  );
  console.log(output);
  if (options.trace) writeFileSync(options.trace, JSON.stringify({ traceEvents: tracer.events }));
  if (options.json) return;
  const elapsedMs = Math.round(performance.now() - startTime);
  for (const line of formatTotals({ components, fileCount, unparsedFiles }, elapsedMs))
    console.error(line);
};

new Command()
  .name("analyze")
  .description(
    "Draw what each React component can render and every state it can be in, from source, without running it, as Mermaid diagrams.",
  )
  .argument("[tsconfig]", "path to the project's tsconfig.json", "tsconfig.json")
  .option("-c, --component <names...>", "only show these components")
  .option(
    "-f, --file <filter>",
    "only list states for components in files whose path contains this text; the whole project is still compiled, and instances come only from parents in those files",
  )
  .option(
    "-d, --depth <n>",
    "maximum render tree depth",
    parsePositiveInteger,
    DEFAULT_RENDER_DEPTH,
  )
  .option(
    "-s, --states <n>",
    "maximum states drawn per region",
    parsePositiveInteger,
    DEFAULT_MAX_STATES,
  )
  .option("--json", "print the analyses as JSON instead", false)
  .option("--trace <file>", "write the time and memory of each phase as a Chrome trace")
  .action((tsconfig: string, options: AnalyzeCliOptions) => {
    try {
      runAnalyze(tsconfig, options);
    } catch (error) {
      if (!(error instanceof ConfigError)) throw error;
      console.error(error.message);
      process.exitCode = 1;
    }
  })
  .parse();
