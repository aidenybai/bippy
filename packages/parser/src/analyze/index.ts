import type { Span } from "@oxc-project/types";
import type { Linker } from "../link/linker.js";
import type { SourceLocation } from "../module/location.js";
import type { ParsedModule } from "../module/types.js";
import type { Project } from "../project/project.js";
import { callFunction } from "./calls.js";
import { EMPTY_CONTEXTS } from "./contexts.js";
import { evaluateChain, evaluateExpression } from "./expressions.js";
import {
  type Diagnostic,
  type EvaluationContext,
  getSourcePreview,
  type Interpreter,
  type InterpreterOptions,
} from "./interpreter.js";
import { evaluateStatements } from "./statements.js";
import {
  getModuleExport,
  getModuleScope,
  resolveModuleBinding,
  valueFromSymbol,
} from "./symbols.js";

export const DEFAULT_MAX_CALL_DEPTH = 24;

/**
 * Wires the evaluator modules into one interpreter. Every module receives the
 * interpreter back so recursion (expressions → calls → statements →
 * expressions) goes through this object rather than import cycles.
 */
export const createInterpreter = (
  project: Project,
  linker: Linker,
  options: InterpreterOptions = {},
): Interpreter => {
  const diagnostics: Diagnostic[] = [];
  const getLocation = (module: ParsedModule, span: Span): SourceLocation => ({
    filePath: module.filePath,
    ...module.lineIndex.getPosition(span.start),
  });
  const interpreter: Interpreter = {
    project,
    linker,
    maxCallDepth: options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH,
    diagnostics,
    moduleScopes: new WeakMap(),
    valueCache: new Map(),
    evaluateExpression: (expression, context) => evaluateExpression(interpreter, expression, context),
    evaluateChain: (chain, span, context) => evaluateChain(interpreter, chain, span, context),
    evaluateStatements: (statements, context) => evaluateStatements(interpreter, statements, context),
    callFunction: (fn, callArguments, context) => callFunction(interpreter, fn, callArguments, context),
    getModuleScope: (module) => getModuleScope(interpreter, module),
    resolveModuleBinding: (module, name) => resolveModuleBinding(interpreter, module, name),
    getModuleExport: (module, exportedName) => getModuleExport(interpreter, module, exportedName),
    valueFromSymbol: (symbol) => valueFromSymbol(interpreter, symbol),
    createModuleContext: (module): EvaluationContext => ({
      module,
      scope: getModuleScope(interpreter, module),
      owner: null,
      hooks: null,
      thisValue: null,
      contexts: EMPTY_CONTEXTS,
      callDepth: 0,
      undecided: null,
    }),
    getLocation,
    getSource: getSourcePreview,
    report: (code, message, module, span) => {
      diagnostics.push({ code, message, location: span ? getLocation(module, span) : null });
    },
  };
  return interpreter;
};

export * from "./contexts.js";
export * from "./hooks.js";
export * from "./interpreter.js";
export * from "./jsx.js";
export * from "./naming.js";
export * from "./scope.js";
export * from "./values.js";
