import type {
  ContextDefinition,
  ElementOwner,
  FunctionLikeNode,
  ModuleRecord,
  RenderEnvironment,
  Scope,
  StaticValue,
  SuperBinding,
} from "../types.js";
import type { HookFrame } from "./hooks.js";
import type { StatementOutcome } from "./interpreter.js";
import type { AsyncCall } from "./promises.js";

/** The value the nearest provider of a context supplies at the position being evaluated, or null without one. */
export interface ContextReader {
  (context: ContextDefinition): StaticValue | null;
}

export const NO_PROVIDERS: ContextReader = () => null;

export interface CallFrame {
  node: FunctionLikeNode;
  scope: Scope;
  args: StaticValue[];
  thisValue: StaticValue | null;
  /** `Interpreter.changeCount` when the activation began. */
  changeCount: number;
  /** `EvaluationContext.forkDepth` at the call site. */
  forkDepth: number;
  /** The callee's own properties when the activation began. */
  properties: Map<string, StaticValue>;
}

interface OutcomeHandler {
  (outcome: StatementOutcome): StatementOutcome;
}

/**
 * Where a statement list of an async body can suspend on a pending `await`:
 * `outcomeHandlers` are the enclosing `try` statements (innermost last) that
 * the outcome of the resumed rest of the body still has to pass through before
 * it settles `call`. Null where a statement's outcome is consumed by code that
 * is not in continuation style (loops, forked paths, `switch` cases), so an
 * `await` there evaluates to an unknown value instead.
 */
export interface SuspensionPoint {
  call: AsyncCall;
  outcomeHandlers: OutcomeHandler[];
}

/**
 * Steps left to one entry into the interpreter (a component render, a module
 * initialization, an effect or event callback); shared by every context
 * derived from the entry's root context, so the whole entry is bounded together.
 */
export interface StepBudget {
  remaining: number;
}

export interface EvaluationContext {
  module: ModuleRecord;
  scope: Scope;
  budget: StepBudget;
  thisValue: StaticValue | null;
  superBinding: SuperBinding | null;
  readContext: ContextReader;
  callStack: CallFrame[];
  uncertainDepth: number;
  forkDepth: number;
  environment: RenderEnvironment | null;
  hooks: HookFrame | null;
  suspension: SuspensionPoint | null;
  /** The component render evaluating, recorded on the elements it creates. */
  owner: ElementOwner | null;
}

export const withScope = (context: EvaluationContext, scope: Scope): EvaluationContext => ({
  ...context,
  scope,
});

export const withoutSuspension = (context: EvaluationContext): EvaluationContext =>
  context.suspension ? { ...context, suspension: null } : context;

export const withOutcomeHandler = (
  context: EvaluationContext,
  handler: OutcomeHandler,
): EvaluationContext =>
  context.suspension
    ? {
        ...context,
        suspension: {
          call: context.suspension.call,
          outcomeHandlers: [...context.suspension.outcomeHandlers, handler],
        },
      }
    : context;
