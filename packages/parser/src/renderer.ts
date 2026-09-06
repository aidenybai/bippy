import { createInterpreter } from "./analyze/index.js";
import type { Diagnostic, Interpreter, InterpreterOptions } from "./analyze/interpreter.js";
import { object, type ObjectValue, type StaticValue } from "./analyze/values.js";
import { type BuildOptions, buildComponentTree, buildStaticTree } from "./fiber/build.js";
import type { StaticRoot } from "./fiber/types.js";
import { createLinker, type Linker } from "./link/linker.js";
import { DEFAULT_EXPORT_NAME } from "./module/types.js";
import { createProject, type Project, type ProjectOptions } from "./project/project.js";
import { snapshotStaticFiber } from "./snapshot/from-static.js";
import type { FiberSnapshot } from "./snapshot/types.js";

export interface StaticRendererOptions extends ProjectOptions {
  interpreter?: InterpreterOptions;
  build?: BuildOptions;
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

  const collect = (build: () => StaticRoot): StaticRenderResult => {
    const firstDiagnostic = interpreter.diagnostics.length;
    const root = build();
    return {
      root,
      snapshot: snapshotStaticFiber(root.root),
      diagnostics: interpreter.diagnostics.slice(firstDiagnostic),
    };
  };

  const getExportValue = (filePath: string, exportName = DEFAULT_EXPORT_NAME): StaticValue => {
    const module = project.getModule(filePath);
    if (!module) throw new Error(`cannot parse ${filePath}`);
    return interpreter.getModuleExport(module, exportName);
  };

  return {
    project,
    linker,
    interpreter,
    getExportValue,
    renderExport: (filePath, exportName = DEFAULT_EXPORT_NAME, props = object()) =>
      collect(() =>
        buildComponentTree(interpreter, getExportValue(filePath, exportName), props, options.build),
      ),
    renderValue: (value) => collect(() => buildStaticTree(interpreter, value, options.build)),
  };
};
