import { dirname, resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { analyzeProject } from "../core/analyze-project";
import { ConfigError } from "../core/config-error";
import { serializeProjectAnalysis } from "../core/serialize";
import { DEFAULT_MAX_STATES, formatMermaid } from "./mermaid";
import { DEFAULT_RENDER_DEPTH, formatRenderTree } from "./render-tree";
import type { AnalyzedComponent } from "../core/types";

interface AnalyzeCliOptions {
  component?: string[];
  file?: string;
  depth: number;
  states: number;
  json: boolean;
}

const parsePositiveInteger = (value: string): number => {
  const integer = Number(value);
  if (!Number.isInteger(integer) || integer < 1)
    throw new InvalidArgumentError("Expected a positive integer.");
  return integer;
};

const formatBailoutCounts = (reasons: string[]): string[] => {
  const countsByReason = new Map<string, number>();
  for (const reason of reasons) countsByReason.set(reason, (countsByReason.get(reason) ?? 0) + 1);
  return [...countsByReason]
    .sort((left, right) => right[1] - left[1])
    .map(([reason, count]) => `${reason} ${count}`);
};

const formatTotals = (
  components: AnalyzedComponent[],
  fileCount: number,
  elapsedMs: number,
): string[] => {
  const stateCount = components.reduce((total, { report }) => total + report.states.length, 0);
  const bailoutCounts = formatBailoutCounts(
    components.flatMap(({ analysis }) => analysis.bailouts.map((bailout) => bailout.reason)),
  );
  return [
    `${components.length} components · ${stateCount} states · ${fileCount} files · ${elapsedMs} ms`,
    ...(bailoutCounts.length > 0 ? [`bailouts: ${bailoutCounts.join(", ")}`] : []),
  ];
};

const runAnalyze = (tsconfig: string, options: AnalyzeCliOptions): void => {
  const startTime = performance.now();
  const configPath = resolve(tsconfig);
  const { components: allComponents, fileCount } = analyzeProject(configPath, options.file ?? null);
  const componentNames = options.component;
  const components = componentNames
    ? allComponents.filter(({ analysis }) => componentNames.includes(analysis.name))
    : allComponents;
  if (options.json) {
    console.log(serializeProjectAnalysis({ components, fileCount }));
    return;
  }
  const rootDirectory = dirname(configPath);
  const diagrams = components.flatMap((component) => [
    formatRenderTree(component, { rootDirectory, maxDepth: options.depth }),
    formatMermaid(component, { rootDirectory, maxStates: options.states }),
  ]);
  console.log(diagrams.join("\n\n"));
  const elapsedMs = Math.round(performance.now() - startTime);
  for (const line of formatTotals(components, fileCount, elapsedMs)) console.error(line);
};

new Command()
  .name("analyze")
  .description(
    "Draw what each React component can render and every state it can be in, from source, without running it, as Mermaid diagrams.",
  )
  .argument("[tsconfig]", "path to the project's tsconfig.json", "tsconfig.json")
  .option("-c, --component <names...>", "only show these components")
  .option("-f, --file <filter>", "only analyze files whose path contains this text")
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
