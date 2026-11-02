import { dirname, resolve } from "node:path";
import { Command } from "commander";
import { analyzeProject } from "../core/project/analyze-project";
import { ConfigError } from "../core/project/config-error";
import { serializeProjectAnalysis } from "../core/project/serialize";
import { formatTla } from "../core/model/tla";
import { formatMermaid } from "./mermaid";
import type { AnalyzedComponent, ProjectAnalysis } from "../core/types";

interface AnalyzeCliOptions {
  component?: string[];
  file?: string;
  json: boolean;
  tla: boolean;
}

const formatBailoutCounts = (reasons: string[]): string[] => {
  const countsByReason = new Map<string, number>();
  for (const reason of reasons) countsByReason.set(reason, (countsByReason.get(reason) ?? 0) + 1);
  return [...countsByReason]
    .sort((left, right) => right[1] - left[1])
    .map(([reason, count]) => `${reason} ${count}`);
};

const formatTotals = (project: ProjectAnalysis, elapsedMs: number): string[] => {
  const stateCount = project.components.reduce(
    (total, component) => total + component.model.stateSpace.stateCount,
    0,
  );
  const findingCount = project.components.reduce(
    (total, component) => total + component.model.findings.length,
    0,
  );
  const bailoutCounts = formatBailoutCounts(
    project.components.flatMap((component) =>
      component.analysis.bailouts.map((bailout) => bailout.reason),
    ),
  );
  return [
    `${project.components.length} components · ${stateCount} states · ${findingCount} findings · ${project.fileCount} files · ${elapsedMs} ms`,
    ...(bailoutCounts.length > 0 ? [`bailouts: ${bailoutCounts.join(", ")}`] : []),
    ...(project.unparsedFiles.length > 0
      ? [`could not parse: ${project.unparsedFiles.join(", ")}`]
      : []),
  ];
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
  return components.map((component) => formatMermaid(component, { rootDirectory })).join("\n\n");
};

const runAnalyze = async (tsconfig: string, options: AnalyzeCliOptions): Promise<void> => {
  const startTime = performance.now();
  const configPath = resolve(tsconfig);
  const rootDirectory = dirname(configPath);
  const analysis = await analyzeProject(configPath, options.file ?? null);
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
  console.log(formatOutput(components, analysis, options, rootDirectory));
  if (options.json || options.tla) return;
  const elapsedMs = Math.round(performance.now() - startTime);
  for (const line of formatTotals({ ...analysis, components }, elapsedMs)) console.error(line);
};

new Command()
  .name("analyze")
  .description(
    "Derive a state chart for each React component from source, without running it. Prints Mermaid, JSON or TLA+.",
  )
  .argument("[tsconfig]", "path to the project's tsconfig.json", "tsconfig.json")
  .option("-c, --component <names...>", "only show these components")
  .option(
    "-f, --file <filter>",
    "only model components in files whose path contains this text; the whole project is still compiled",
  )
  .option("--json", "print the analyses as JSON instead", false)
  .option("--tla", "print each component as a TLA+ module instead", false)
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
