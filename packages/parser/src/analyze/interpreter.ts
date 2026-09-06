import type { Expression, Span, Statement } from "@oxc-project/types";
import type { StaticFiber } from "../fiber/types.js";
import type { LinkedSymbol, Linker } from "../link/linker.js";
import type { FunctionLike } from "../module/ast.js";
import type { SourceLocation } from "../module/location.js";
import type { ParsedModule } from "../module/types.js";
import type { Project } from "../project/project.js";
import type { ProvidedContexts } from "./contexts.js";
import type { HookCall } from "./hooks.js";
import type { Scope } from "./scope.js";
import { type FunctionValue, type StaticValue, unknown } from "./values.js";

export interface EvaluationContext {
  module: ParsedModule;
  scope: Scope;
  /** Fiber whose render is executing; stamped on the elements it creates. */
  owner: StaticFiber | null;
  /** Hook calls recorded for the component render in progress, if any. */
  hooks: HookCall[] | null;
  /** `this` inside class component methods. */
  thisValue: StaticValue | null;
  /** Context values provided by the fibers above the render in progress. */
  contexts: ProvidedContexts;
  callDepth: number;
  /** How many times each function on the call stack is executing, to bound recursion. */
  activeCalls: ReadonlyMap<FunctionLike, number>;
  /** Innermost branch or loop whose direction is not known statically, if any. */
  undecided: UndecidedFrame | null;
}

/**
 * Control flow the analysis could not decide. Side effects performed under
 * it on values created outside it (`items.push(x)` inside `if (flag)`) must
 * stay conditional; `depth` tells the two apart.
 */
export interface UndecidedFrame {
  test: string;
  depth: number;
}

export const enterUndecided = (
  context: EvaluationContext,
  test: string,
  scope: Scope,
): EvaluationContext => ({
  ...context,
  scope,
  undecided: { test, depth: getUndecidedDepth(context) + 1 },
});

export const getUndecidedDepth = (context: EvaluationContext): number =>
  context.undecided?.depth ?? 0;

/** Whether a side effect happening now on a value created at `createdAtDepth` is conditional. */
export const isEffectUndecided = (context: EvaluationContext, createdAtDepth: number): boolean =>
  context.undecided !== null && context.undecided.depth > createdAtDepth;

/**
 * How a statement list finished. A `partial` completion returned on some
 * paths only; it becomes a value once the rest of the enclosing sequence has
 * been evaluated and its result is passed to `complete`. A `throw` leaves
 * the render path: React shows an error boundary instead of a value.
 */
export type Completion =
  | { kind: "normal" }
  | { kind: "break" }
  | { kind: "continue" }
  | { kind: "throw" }
  | { kind: "return"; value: StaticValue }
  | { kind: "partial"; complete: (restValue: StaticValue) => StaticValue };

export type JumpKind = Extract<Completion, { kind: "break" | "continue" }>["kind"];

export type DiagnosticCode =
  | "unresolved-reference"
  | "unsupported-syntax"
  | "call-depth"
  | "external-call";

export interface Diagnostic {
  code: DiagnosticCode;
  message: string;
  location: SourceLocation | null;
}

export interface InterpreterOptions {
  /** Nested call depth after which calls evaluate to an unknown value. */
  maxCallDepth?: number;
}

/** Thrown from evaluation once the render's time budget is spent. */
export class AnalysisTimeoutError extends Error {
  constructor(budgetMs: number) {
    super(`analysis exceeded its ${budgetMs}ms budget`);
    this.name = "AnalysisTimeoutError";
  }
}

export interface Interpreter {
  project: Project;
  linker: Linker;
  maxCallDepth: number;
  diagnostics: Diagnostic[];
  /** Makes evaluation throw `AnalysisTimeoutError` after `budgetMs`; `null` removes the limit. */
  setTimeBudget: (budgetMs: number | null) => void;
  moduleScopes: WeakMap<ParsedModule, Scope>;
  /** Evaluated export expressions keyed by module path and node offset. */
  valueCache: Map<string, StaticValue>;
  evaluateExpression: (expression: Expression, context: EvaluationContext) => StaticValue;
  /** Resolves an identifier chain such as `["Dialog", "Trigger"]` in a scope. */
  evaluateChain: (chain: string[], span: Span, context: EvaluationContext) => StaticValue;
  evaluateStatements: (statements: Statement[], context: EvaluationContext) => Completion;
  callFunction: (
    fn: FunctionValue,
    callArguments: StaticValue[],
    context: EvaluationContext,
  ) => StaticValue;
  getModuleScope: (module: ParsedModule) => Scope;
  /** Value of a top-level binding, or `null` when the module has no such binding. */
  resolveModuleBinding: (module: ParsedModule, name: string) => StaticValue | null;
  getModuleExport: (module: ParsedModule, exportedName: string) => StaticValue;
  valueFromSymbol: (symbol: LinkedSymbol) => StaticValue;
  createModuleContext: (module: ParsedModule) => EvaluationContext;
  getLocation: (module: ParsedModule, span: Span) => SourceLocation;
  /** Source text of a span, whitespace-collapsed and truncated for display. */
  getSource: (module: ParsedModule, span: Span) => string;
  report: (code: DiagnosticCode, message: string, module: ParsedModule, span: Span | null) => void;
}

export const NORMAL_COMPLETION: Completion = { kind: "normal" };
export const BREAK_COMPLETION: Completion = { kind: "break" };
export const CONTINUE_COMPLETION: Completion = { kind: "continue" };
export const THROW_COMPLETION: Completion = { kind: "throw" };

export const returnCompletion = (value: StaticValue): Completion => ({ kind: "return", value });

/** Value a function body evaluates to; falling off the end yields `undefined`. */
export const getReturnValue = (completion: Completion, fallthrough: StaticValue): StaticValue => {
  switch (completion.kind) {
    case "return":
      return completion.value;
    case "partial":
      return completion.complete(fallthrough);
    case "throw":
      return unknown("thrown error");
    default:
      return fallthrough;
  }
};

export const MAX_SOURCE_PREVIEW_LENGTH = 72;

export const getSourcePreview = (module: ParsedModule, span: Span): string => {
  const collapsed = module.sourceText.slice(span.start, span.end).replace(/\s+/g, " ").trim();
  return collapsed.length > MAX_SOURCE_PREVIEW_LENGTH
    ? `${collapsed.slice(0, MAX_SOURCE_PREVIEW_LENGTH - 1)}…`
    : collapsed;
};
