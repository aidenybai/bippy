import type { SourceFile } from "typescript/unstable/ast";
import type { CompiledFile, CompiledFunction } from "./compile";
import { addComparedSamples } from "./infer-domains";
import type { DomainResolver } from "./infer-domains";
import { collectHandlers } from "./collect-handlers";
import { Interpreter } from "./interpret";
import { PlaceMap } from "./utils/place";
import { createDeclarationKey } from "./utils/declaration-key";
import type { ProjectHookLoader } from "./interpret";
import type { Bailout, ComponentAnalysis, ContextSetterFields, StoreActions } from "./types";

export interface FileContext {
  sourceFile: SourceFile;
  resolver: DomainResolver;
  compiled: CompiledFile;
  loadProjectHook: ProjectHookLoader;
  contextSetterFields: ContextSetterFields;
  actionsByStore: Map<string, StoreActions>;
  exportNames: Map<string, string>;
  displayNames: Map<string, string | null>;
}

export const analyzeComponent = (
  reactFunction: CompiledFunction,
  fileContext: FileContext,
): ComponentAnalysis => {
  const { sourceFile, exportNames, displayNames } = fileContext;
  const componentIdentity = {
    name: reactFunction.name,
    exportName: exportNames.get(reactFunction.name) ?? null,
    runtimeName: displayNames.has(reactFunction.name)
      ? (displayNames.get(reactFunction.name) ?? null)
      : reactFunction.name,
    file: sourceFile.fileName,
    declaration: createDeclarationKey(sourceFile.path, reactFunction.name),
  };
  const hir = reactFunction.hir;
  if (hir === null) {
    const loc = reactFunction.loc;
    return {
      ...componentIdentity,
      loc,
      isAsync: false,
      bindings: [],
      wholePropsSample: null,
      providedContexts: [],
      contextSamples: new Map(),
      untypedContextBindingIds: new Map(),
      placeDomains: new PlaceMap(),
      unionMemberValues: new PlaceMap(),
      render: { kind: "Unknown", reason: "compiler-error", loc },
      handlers: [],
      renders: [],
      bailouts: [
        {
          reason: "compiler-error",
          message: reactFunction.errors.join("; "),
          loc,
        },
      ],
      warnings: [],
    };
  }
  const interpreter = new Interpreter(
    fileContext.resolver,
    fileContext.compiled.loadModuleFunction,
    fileContext.loadProjectHook,
    fileContext.contextSetterFields,
    fileContext.actionsByStore,
  );
  const render = interpreter.evaluateComponent(hir);
  addComparedSamples(render);
  const handlers = collectHandlers(render, interpreter);
  const { bindings, placeDomains, unionMemberValues } = interpreter.bindingTable;
  return {
    ...componentIdentity,
    loc: hir.loc,
    isAsync: hir.async,
    bindings,
    wholePropsSample: interpreter.wholePropsSample,
    providedContexts: interpreter.providedContexts,
    contextSamples: interpreter.externalSources.contextSamples,
    untypedContextBindingIds: interpreter.externalSources.untypedContextBindingIds,
    placeDomains,
    unionMemberValues,
    render,
    handlers,
    renders: [...interpreter.renderedComponents],
    bailouts: [
      ...interpreter.diagnostics.bailouts,
      ...bindings.flatMap((binding): Bailout[] =>
        binding.domain.kind === "Unknown"
          ? [{ reason: `untyped-${binding.kind}`, message: binding.name, loc: binding.loc }]
          : [],
      ),
    ],
    warnings: interpreter.diagnostics.warnings,
  };
};
