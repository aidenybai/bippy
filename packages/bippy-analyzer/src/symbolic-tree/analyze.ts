import { dirname, sep } from "node:path";
import { API } from "typescript/unstable/sync";
import { extractComponents } from "./extract.ts";
import type { Attribute, ComponentModel, RenderNode } from "./model.ts";
import type { AnalyzedComponent } from "./print.ts";
import { enumerateStates } from "./states.ts";

interface ComponentUsage {
  tag: string;
  attributes: Attribute[];
}

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

export const analyzeProject = (
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

export const toJson = (components: AnalyzedComponent[]): string =>
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
