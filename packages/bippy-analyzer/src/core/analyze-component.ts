import type { SourceFile } from "typescript/unstable/ast";
import type { Checker } from "typescript/unstable/sync";
import { getSourceLocation } from "../compiler/hir/hir.js";
import type { HIRFunction } from "../compiler/hir/hir.js";
import type { ScopeManager } from "../compiler/hir/scope.js";
import { DomainResolver, addComparedSamples } from "./infer-domains.js";
import { collectHandlers } from "./collect-handlers.js";
import { Interpreter } from "./interpret.js";
import type { ModuleFunctionLoader } from "./interpret.js";
import type { Bailout, ComponentAnalysis } from "./types.js";
import { runPipeline } from "../compiler/pipeline.js";
import { findModuleFunction } from "../compiler/program.js";
import type { ReactFunction } from "../compiler/program.js";

interface FileContext {
  sourceFile: SourceFile;
  checker: Checker;
  scopes: ScopeManager;
  exportNames: Map<string, string>;
  displayNames: Map<string, string | null>;
}

const createModuleFunctionLoader = (context: FileContext): ModuleFunctionLoader => {
  const loaded = new Map<string, HIRFunction | null>();
  return (name) => {
    if (!loaded.has(name)) {
      const node = findModuleFunction(context.sourceFile, name);
      const result = node ? runPipeline({ name, node, fnType: "Other" }, context) : null;
      loaded.set(name, result?.isOk() ? result.unwrap() : null);
    }
    return loaded.get(name) ?? null;
  };
};

/**
 * Lowers one component and runs our analysis passes on its HIR: the symbolic render tree,
 * its bindings and their domains, and its handlers.
 */
export const analyzeComponent = (
  reactFunction: ReactFunction,
  context: FileContext,
): ComponentAnalysis => {
  const { sourceFile, checker, exportNames, displayNames } = context;
  const base = {
    name: reactFunction.name,
    exportName: exportNames.get(reactFunction.name) ?? null,
    runtimeName: displayNames.has(reactFunction.name)
      ? (displayNames.get(reactFunction.name) ?? null)
      : reactFunction.name,
    file: sourceFile.fileName,
    declaration: `${sourceFile.path}#${reactFunction.name}`,
  };
  const result = runPipeline(reactFunction, context);
  if (result.isErr()) {
    const error = result.unwrapErr();
    const loc = getSourceLocation(reactFunction.node);
    return {
      ...base,
      loc,
      bindings: [],
      placeDomains: new Map(),
      render: { kind: "Unknown", reason: "compiler-error", loc },
      handlers: [],
      renders: [],
      bailouts: [
        {
          reason: "compiler-error",
          message: error.details.map((detail) => detail.reason).join("; "),
          loc,
        },
      ],
      warnings: [],
    };
  }
  const hir = result.unwrap();
  const interpreter = new Interpreter(
    new DomainResolver(checker, sourceFile),
    createModuleFunctionLoader(context),
  );
  const render = interpreter.evaluateComponent(hir);
  addComparedSamples(render);
  const handlers = collectHandlers(render, interpreter, sourceFile);
  const { bindings } = interpreter;
  return {
    ...base,
    loc: hir.loc,
    bindings,
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
