import { createInterpreter } from "./analyze/index.js";
import type { Diagnostic, Interpreter, InterpreterOptions } from "./analyze/interpreter.js";
import { findMountPoints, type MountPoint } from "./analyze/mount.js";
import { object, type ObjectValue, type StaticValue } from "./analyze/values.js";
import { type BuildOptions, buildComponentTree, buildStaticTree } from "./fiber/build.js";
import type { StaticRoot } from "./fiber/types.js";
import { createLinker, type Linker } from "./link/linker.js";
import { DEFAULT_EXPORT_NAME, type ParsedModule } from "./module/types.js";
import { createProject, type Project, type ProjectOptions } from "./project/project.js";
import { snapshotStaticFiber } from "./snapshot/from-static.js";
import type { FiberSnapshot } from "./snapshot/types.js";

export interface StaticRendererOptions extends ProjectOptions {
  interpreter?: InterpreterOptions;
  build?: BuildOptions;
  /** Wall-clock budget per render; exceeding it throws `AnalysisTimeoutError`. */
  timeBudgetMs?: number;
}

export interface StaticRenderResult {
  root: StaticRoot;
  snapshot: FiberSnapshot;
  /** Diagnostics reported while evaluating this render. */
  diagnostics: Diagnostic[];
}

export interface StaticRenderer {
  project: Project;
  linker: Linker;
  interpreter: Interpreter;
  getExportValue: (filePath: string, exportName?: string) => StaticValue;
  /** Where a module hands elements to react-dom, e.g. `createRoot(el).render(<App />)`. */
  findMountPoints: (filePath: string) => MountPoint[];
  /** Tree for `root.render(<Export {...props} />)`. */
  renderExport: (filePath: string, exportName?: string, props?: ObjectValue) => StaticRenderResult;
  /** Tree for `root.render(value)`, where `value` is an element or children value. */
  renderValue: (value: StaticValue) => StaticRenderResult;
}

/** Project, linker, interpreter and fiber builder wired together. */
export const createStaticRenderer = (options: StaticRendererOptions): StaticRenderer => {
  const project = createProject(options);
  const linker = createLinker(project);
  const interpreter = createInterpreter(project, linker, options.interpreter);

  /** Runs one analysis step under the time budget, if any. */
  const budgeted = <Result>(step: () => Result): Result => {
    interpreter.setTimeBudget(options.timeBudgetMs ?? null);
    try {
      return step();
    } finally {
      interpreter.setTimeBudget(null);
    }
  };

  const collect = (build: () => StaticRoot): StaticRenderResult => {
    const firstDiagnostic = interpreter.diagnostics.length;
    const root = budgeted(build);
    return {
      root,
      snapshot: snapshotStaticFiber(root.root),
      diagnostics: interpreter.diagnostics.slice(firstDiagnostic),
    };
  };

  const getModule = (filePath: string): ParsedModule => {
    const module = project.getModule(filePath);
    if (!module) throw new Error(`cannot parse ${filePath}`);
    return module;
  };

  const getExportValue = (filePath: string, exportName = DEFAULT_EXPORT_NAME): StaticValue =>
    interpreter.getModuleExport(getModule(filePath), exportName);

  return {
    project,
    linker,
    interpreter,
    getExportValue: (filePath, exportName) => budgeted(() => getExportValue(filePath, exportName)),
    findMountPoints: (filePath) =>
      budgeted(() => findMountPoints(interpreter, getModule(filePath))),
    renderExport: (filePath, exportName = DEFAULT_EXPORT_NAME, props = object()) =>
      collect(() =>
        buildComponentTree(interpreter, getExportValue(filePath, exportName), props, options.build),
      ),
    renderValue: (value) => collect(() => buildStaticTree(interpreter, value, options.build)),
  };
};
