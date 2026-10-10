import type { SourceFile } from "typescript/unstable/ast";
import type { Checker } from "typescript/unstable/sync";
import type { HIRFunction } from "../hir/hir.js";
import type { ScopeManager } from "../hir/scope.js";
import { DomainResolver } from "../inference/infer-domains.js";
import { inferTransitions } from "../inference/infer-transitions.js";
import { SymbolicEvaluator } from "../inference/symbolic-evaluator.js";
import type { ModuleFunctionLoader } from "../inference/symbolic-evaluator.js";
import type { Bailout, ComponentAnalysis } from "../inference/types.js";
import { runPipeline } from "./pipeline.js";
import { findModuleFunction } from "./program.js";
import type { ReactFunction } from "./program.js";

interface FileContext {
  sourceFile: SourceFile;
  checker: Checker;
  scopes: ScopeManager;
  exportNames: Map<string, string>;
  displayNames: Map<string, string>;
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
 * its bindings and their domains, and its transitions.
 */
export const analyzeComponent = (
  reactFunction: ReactFunction,
  context: FileContext,
): ComponentAnalysis => {
  const { sourceFile, checker, exportNames, displayNames } = context;
  const base = {
    name: reactFunction.name,
    exportName: exportNames.get(reactFunction.name) ?? null,
    displayName: displayNames.get(reactFunction.name) ?? null,
    file: sourceFile.fileName,
  };
  const result = runPipeline(reactFunction, context);
  if (result.isErr()) {
    const error = result.unwrapErr();
    const loc = {
      filename: sourceFile.fileName,
      start: reactFunction.node.getStart(sourceFile),
      end: reactFunction.node.getEnd(),
      line: 0,
      column: 0,
    };
    return {
      ...base,
      loc,
      bindings: [],
      placeDomains: new Map(),
      render: { kind: "Unknown", reason: "compiler-error", loc },
      transitions: [],
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
  const evaluator = new SymbolicEvaluator(
    new DomainResolver(checker, sourceFile),
    createModuleFunctionLoader(context),
  );
  const render = evaluator.evaluateComponent(hir);
  const transitions = inferTransitions(render, evaluator, sourceFile);
  const { bindings } = evaluator;
  return {
    ...base,
    loc: hir.loc,
    bindings,
    placeDomains: evaluator.placeDomains,
    render,
    transitions,
    renders: [...evaluator.renderedComponents],
    bailouts: [
      ...evaluator.bailouts,
      ...bindings.flatMap((binding): Bailout[] =>
        binding.domain.kind === "Unknown"
          ? [{ reason: `untyped-${binding.kind}`, message: binding.name, loc: binding.loc }]
          : [],
      ),
    ],
    warnings: evaluator.warnings,
  };
};
