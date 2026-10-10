#!/usr/bin/env node
import { dirname, resolve, sep } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import picocolors from "picocolors";
import { API } from "typescript/unstable/sync";
import { extractComponents } from "./extract.ts";
import type { Attribute, ComponentModel, RenderNode } from "./model.ts";
import { formatComponent, formatHierarchy } from "./print.ts";
import type { AnalyzedComponent, View } from "./print.ts";
import { enumerateStates } from "./states.ts";

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

interface ComponentUsage {
  tag: string;
  attributes: Attribute[];
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

const collectUsages = (render: RenderNode, usages: ComponentUsage[]): void => {
  if (render.kind === "element") {
    if (render.isComponent) usages.push({ tag: render.tag, attributes: render.attributes });
    for (const child of render.children) collectUsages(child, usages);
  }
  if (render.kind === "branch") {
    collectUsages(render.whenTrue, usages);
    collectUsages(render.whenFalse, usages);
  }
  if (render.kind === "list") collectUsages(render.item, usages);
};

const narrowPropsFromCallSites = (models: ComponentModel[]): void => {
  const usages: ComponentUsage[] = [];
  for (const model of models) collectUsages(model.render, usages);
  for (const model of models) {
    const componentUsages = usages.filter((usage) => usage.tag === model.name);
    if (componentUsages.length === 0) continue;
    for (const slot of model.slots) {
      if (slot.source !== "prop" || slot.domain.kind !== "unknown") continue;
      const literals = componentUsages.map(
        (usage) => usage.attributes.find((attribute) => attribute.name === slot.name)?.literal,
      );
      if (literals.some((literal) => literal === undefined)) continue;
      slot.domain = {
        kind: "cases",
        cases: [...new Set(literals.filter((literal) => literal !== undefined))],
        origin: "call-sites",
      };
      model.atoms.set(slot.name, slot.domain);
    }
  }
};

const analyzeProject = (
  configPath: string,
  fileFilter: string | undefined,
): { components: AnalyzedComponent[]; fileCount: number } => {
  const api = new API({ cwd: dirname(configPath) });
  try {
    const project = api.updateSnapshot({ openProjects: [configPath] }).getProjects()[0];
    if (!project) throw new Error(`No TypeScript project found for ${configPath}`);
    const fileNames = project.program
      .getSourceFileNames()
      .filter(
        (fileName) =>
          !fileName.includes(`${sep}node_modules${sep}`) &&
          !fileName.endsWith(".d.ts") &&
          /\.[jt]sx?$/.test(fileName),
      );
    const models: ComponentModel[] = [];
    for (const fileName of fileNames) {
      const sourceFile = project.program.getSourceFile(fileName);
      if (sourceFile) models.push(...extractComponents(project.checker, sourceFile));
    }
    narrowPropsFromCallSites(models);
    for (const model of models) {
      for (const slot of model.slots) {
        if (slot.domain.kind === "unknown")
          model.bailouts.push({
            reason: `untyped-${slot.source}`,
            text: slot.name,
            line: model.line,
          });
      }
    }
    const components = models
      .filter((model) => !fileFilter || model.file.includes(fileFilter))
      .map((model) => ({ model, report: enumerateStates(model) }));
    return { components, fileCount: fileNames.length };
  } finally {
    api.close();
  }
};

const toJson = (components: AnalyzedComponent[]): string =>
  JSON.stringify(
    components.map(({ model, report }) => ({
      ...model,
      atoms: Object.fromEntries(model.atoms),
      states: report.states,
      deadBranches: report.deadBranches,
    })),
    null,
    2,
  );

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
