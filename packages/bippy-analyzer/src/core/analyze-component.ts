import type { SourceFile } from "typescript/unstable/ast";
import type { Checker } from "typescript/unstable/sync";
import type { CompiledFile, CompiledFunction } from "./compile.js";
import { DomainResolver, addComparedSamples } from "./infer-domains.js";
import { collectHandlers } from "./collect-handlers.js";
import { Interpreter } from "./interpret.js";
import type { Bailout, ComponentAnalysis } from "./types.js";

interface FileContext {
  sourceFile: SourceFile;
  checker: Checker;
  compiled: CompiledFile;
  exportNames: Map<string, string>;
  displayNames: Map<string, string | null>;
}

/**
 * Lowers one component and runs our analysis passes on its HIR: the symbolic render tree,
 * its bindings and their domains, and its handlers.
 */
export const analyzeComponent = (
  reactFunction: CompiledFunction,
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
  const hir = reactFunction.hir;
  if (hir === null) {
    const loc = reactFunction.loc;
    return {
      ...base,
      loc,
      isAsync: false,
      bindings: [],
      propsSample: null,
      placeDomains: new Map(),
      render: { kind: "Unknown", reason: "compiler-error", loc },
      branchGuards: new WeakMap(),
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
    new DomainResolver(checker, sourceFile),
    context.compiled.compileModuleFunction,
  );
  const render = interpreter.evaluateComponent(hir);
  addComparedSamples(render);
  const handlers = collectHandlers(render, interpreter, sourceFile);
  const { bindings } = interpreter;
  return {
    ...base,
    loc: hir.loc,
    isAsync: hir.async,
    bindings,
    propsSample: interpreter.propsSample,
    placeDomains: interpreter.placeDomains,
    render,
    branchGuards: interpreter.branchGuards,
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
