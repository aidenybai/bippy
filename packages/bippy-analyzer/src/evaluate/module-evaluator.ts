import type { ModuleGraph } from "../graph/module-graph.js";
import type { ModuleRecord } from "../graph/module-types.js";
import type { SourceLocation } from "../parse/source-types.js";
import type { RenderEnvironment, StaticValue } from "../types.js";
import type { EvaluationContext } from "./context.js";

export interface ModuleEvaluationGraph extends Pick<
  ModuleGraph,
  "addVirtualModule" | "resolveImportedModule"
> {
  readonly resolver: Pick<ModuleGraph["resolver"], "rootDirectory" | "extensions">;
}

export interface ModuleEvaluator {
  readonly graph: ModuleEvaluationGraph;
  evaluateModuleExport: (
    module: ModuleRecord,
    exportedName: string,
    environment?: RenderEnvironment | null,
  ) => StaticValue;
  importModule: (
    specifier: string,
    context: EvaluationContext,
    location: SourceLocation | null,
    isRequire: boolean,
  ) => StaticValue;
  getProperty: (
    receiver: StaticValue,
    key: string,
    context: EvaluationContext,
    location: SourceLocation | null,
  ) => StaticValue;
}
