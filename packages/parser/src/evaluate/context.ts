import type {
  ContextDefinition,
  FunctionLikeNode,
  ModuleRecord,
  Scope,
  StaticValue,
} from "../types.js";

export interface ContextFrame {
  context: ContextDefinition;
  value: StaticValue;
  parent: ContextFrame | null;
}

export interface EvaluationContext {
  module: ModuleRecord;
  scope: Scope;
  thisValue: StaticValue | null;
  contextFrame: ContextFrame | null;
  callStack: FunctionLikeNode[];
  uncertainDepth: number;
  forkDepth: number;
}

export const withScope = (context: EvaluationContext, scope: Scope): EvaluationContext => ({
  ...context,
  scope,
});

export const lookupContextValue = (
  frame: ContextFrame | null,
  context: ContextDefinition,
): StaticValue | null => {
  let current = frame;
  while (current) {
    if (current.context === context) return current.value;
    current = current.parent;
  }
  return null;
};
