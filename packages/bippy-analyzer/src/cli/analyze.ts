import { dirname, resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import picocolors from "picocolors";
import { analyzeProject, serializeProjectAnalysis } from "../core/entrypoint/analyze-project.js";
import { ALL_VIEWS, DEFAULT_RENDER_DEPTH } from "./constants.js";
import { formatComponent, formatHierarchy } from "./print.js";
import type { AnalyzeCliOptions, View } from "./types.js";

const isView = (value: string): value is View => ALL_VIEWS.some((view) => view === value);

const parseViews = (value: string): View[] => {
  if (value === "all") return ALL_VIEWS;
  const views = value.split(",").map((view) => view.trim());
  const invalidViews = views.filter((view) => !isView(view));
  if (invalidViews.length > 0) {
    throw new InvalidArgumentError(
      `Unknown view: ${invalidViews.join(", ")}. Use ${ALL_VIEWS.join(", ")} or all.`,
    );
  }
  return views.filter(isView);
};

const parseDepth = (value: string): number => {
  const depth = Number(value);
  if (!Number.isInteger(depth) || depth < 1)
    throw new InvalidArgumentError("Depth must be a positive integer.");
  return depth;
};

const countBailouts = (reasons: string[]): string[] => {
  const counts = new Map<string, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts]
    .sort((left, right) => right[1] - left[1])
    .map(([reason, count]) => `${reason} ${count}`);
};

const run = (tsconfig: string, options: AnalyzeCliOptions): void => {
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

  const colors = picocolors.createColors(options.color && picocolors.isColorSupported);
  const printOptions = {
    views: new Set(options.view),
    colors,
    rootDirectory: dirname(configPath),
    maxDepth: options.depth,
    isShowingAttributes: options.attributes,
  };

  if (options.hierarchy) console.log(`${formatHierarchy(components, printOptions)}\n`);
  if (!options.hierarchy || options.component) {
    for (const component of components)
      console.log(`${formatComponent(component, printOptions)}\n`);
  }

  const stateCount = components.reduce((total, { report }) => total + report.states.length, 0);
  const elapsed = Math.round(performance.now() - startTime);
  console.log(
    colors.dim(
      `${components.length} components · ${stateCount} states · ${fileCount} files · ${elapsed} ms`,
    ),
  );
  const bailouts = countBailouts(
    components.flatMap(({ analysis }) => analysis.bailouts.map((bailout) => bailout.reason)),
  );
  if (bailouts.length > 0) console.log(colors.dim(`bailouts: ${bailouts.join(", ")}`));
};

new Command()
  .name("analyze")
  .description("List every state each React component can be in, from source, without running it.")
  .argument("[tsconfig]", "path to the project's tsconfig.json", "tsconfig.json")
  .option("-c, --component <names...>", "only show these components")
  .option("-f, --file <filter>", "only analyze files whose path contains this text")
  .option(
    "-v, --view <views>",
    `sections to show: ${ALL_VIEWS.join(", ")} (default: all)`,
    parseViews,
    ALL_VIEWS,
  )
  .option("-H, --hierarchy", "show the component tree (parent → child)", false)
  .option("-d, --depth <n>", "maximum render tree depth", parseDepth, DEFAULT_RENDER_DEPTH)
  .option("-a, --attributes", "show every JSX attribute, not only event handlers", false)
  .option("--json", "print the analyses as JSON", false)
  .option("--no-color", "disable colors")
  .action(run)
  .parse();
