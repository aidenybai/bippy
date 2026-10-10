#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import picocolors from "picocolors";
import { analyzeProject, toJson } from "./analyze.ts";
import { formatComponent, formatHierarchy } from "./print.ts";
import type { View } from "./print.ts";

interface CliOptions {
  component?: string[];
  file?: string;
  view: View[];
  hierarchy: boolean;
  depth: number;
  attributes: boolean;
  json: boolean;
  color: boolean;
}

const ALL_VIEWS: View[] = ["data", "render", "states", "bailouts"];
const DEFAULT_VIEWS: View[] = ALL_VIEWS;

const isView = (value: string): value is View => ALL_VIEWS.some((view) => view === value);

const parseViews = (value: string): View[] => {
  if (value === "all") return ALL_VIEWS;
  const views = value.split(",").map((view) => view.trim());
  const invalid = views.filter((view) => !isView(view));
  if (invalid.length > 0)
    throw new InvalidArgumentError(
      `Unknown view: ${invalid.join(", ")}. Use ${ALL_VIEWS.join(", ")} or all.`,
    );
  return views.filter(isView);
};

const parseDepth = (value: string): number => {
  const depth = Number(value);
  if (!Number.isInteger(depth) || depth < 1)
    throw new InvalidArgumentError("Depth must be a positive integer.");
  return depth;
};

const run = (tsconfig: string, options: CliOptions): void => {
  const startTime = performance.now();
  const configPath = resolve(tsconfig);
  const rootDirectory = dirname(configPath);
  const { components: allComponents, fileCount } = analyzeProject(configPath, options.file);
  const components = options.component
    ? allComponents.filter(({ model }) => options.component?.includes(model.name))
    : allComponents;

  if (options.json) {
    console.log(toJson(components));
    return;
  }

  const colors = picocolors.createColors(options.color && picocolors.isColorSupported);
  const printOptions = {
    views: new Set(options.view),
    colors,
    rootDirectory,
    maxDepth: options.depth,
    isShowingAttributes: options.attributes,
    effects: new Map<string, string>(),
    triggers: new Map<string, string>(),
  };

  if (options.hierarchy) console.log(`${formatHierarchy(components, printOptions)}\n`);
  if (!options.hierarchy || options.component) {
    for (const component of components)
      console.log(`${formatComponent(component, printOptions)}\n`);
  }

  const stateCount = components.reduce((total, { report }) => total + report.states.length, 0);
  const bailoutCounts = new Map<string, number>();
  for (const { model } of components) {
    for (const bailout of model.bailouts)
      bailoutCounts.set(bailout.reason, (bailoutCounts.get(bailout.reason) ?? 0) + 1);
  }
  const elapsed = Math.round(performance.now() - startTime);
  console.log(
    colors.dim(
      `${components.length} components · ${stateCount} states · ${fileCount} files · ${elapsed} ms`,
    ),
  );
  const bailouts = [...bailoutCounts]
    .sort((left, right) => right[1] - left[1])
    .map(([reason, count]) => `${reason} ${count}`);
  if (bailouts.length > 0) console.log(colors.dim(`bailouts: ${bailouts.join(", ")}`));
};

new Command()
  .name("symbolic-tree")
  .description("Map every state a React app can be in, from source, without running it.")
  .argument("[tsconfig]", "path to the project's tsconfig.json", "tsconfig.json")
  .option("-c, --component <names...>", "only show these components")
  .option("-f, --file <filter>", "only analyze files whose path contains this text")
  .option(
    "-v, --view <views>",
    `sections to show: ${ALL_VIEWS.join(", ")} (default: all)`,
    parseViews,
    DEFAULT_VIEWS,
  )
  .option("-H, --hierarchy", "show the component tree (parent → child)", false)
  .option("-d, --depth <n>", "maximum render tree depth", parseDepth, 12)
  .option("-a, --attributes", "show every JSX attribute, not only event handlers", false)
  .option("--json", "print the models as JSON", false)
  .option("--no-color", "disable colors")
  .action(run)
  .parse();
