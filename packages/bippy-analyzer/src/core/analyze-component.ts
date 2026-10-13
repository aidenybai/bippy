import type { SourceFile } from "typescript/unstable/ast";
import type { CompiledFile, CompiledFunction } from "./compile";
import { addComparedSamples } from "./infer-domains";
import type { DomainResolver } from "./infer-domains";
import { collectHandlers } from "./collect-handlers";
import { Interpreter } from "./interpret";
import type { ProjectHookLoader } from "./interpret";
import type { Bailout, ComponentAnalysis, ContextModels, StoreModel } from "./types";

interface FileContext {
  sourceFile: SourceFile;
  resolver: DomainResolver;
  compiled: CompiledFile;
  loadProjectHook: ProjectHookLoader;
  contextModels: ContextModels;
  storeModels: Map<string, StoreModel>;
  exportNames: Map<string, string>;
  displayNames: Map<string, string | null>;
}

export const analyzeComponent = (
  reactFunction: CompiledFunction,
  context: FileContext,
): ComponentAnalysis => {
  const { sourceFile, exportNames, displayNames } = context;
  const base = {
    name: reactFunction.name,
    exportName: exportNames.get(reactFunction.name) ?? null,
    runtimeName: displayNames.has(reactFunction.name)
      ? (displayNames.get(reactFunction.name) ?? null)
      : reactFunction.name,
    file: sourceFile.fileName,
    declaration: `${sourceFile.path}#${reactFunction.name}`,
  };
  const hir = reactFunction.hir;
  if (hir === null) {
    const loc = reactFunction.loc;
    return {
      ...base,
      loc,
      isAsync: false,
      bindings: [],
      propsSample: null,
      providedContexts: [],
      contextSamples: new Map(),
      untypedContexts: new Map(),
      placeDomains: new Map(),
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
    context.resolver,
    context.compiled.compileModuleFunction,
    context.loadProjectHook,
    context.contextModels,
    context.storeModels,
  );
  const render = interpreter.evaluateComponent(hir);
  addComparedSamples(render);
  const handlers = collectHandlers(render, interpreter);
  const { bindings } = interpreter;
  return {
    ...base,
    loc: hir.loc,
    isAsync: hir.async,
    bindings,
    propsSample: interpreter.propsSample,
    providedContexts: interpreter.providedContexts,
    contextSamples: interpreter.contextSamples,
    untypedContexts: interpreter.untypedContexts,
    placeDomains: interpreter.placeDomains,
    render,
    handlers,
    renders: [...interpreter.renderedComponents],
    bailouts: [
      ...interpreter.bailouts,
      ...bindings.flatMap((binding): Bailout[] =>
        binding.domain.kind === "Unknown"
          ? [{ reason: `untyped-${binding.kind}`, message: binding.name, loc: binding.loc }]
          : [],
      ),
    ],
    warnings: interpreter.warnings,
  };
};
