import type {
  ContextDefinition,
  FunctionLikeNode,
  ModuleRecord,
  RenderEnvironment,
  Scope,
  StaticValue,
} from "../types.js";
import type { HookFrame } from "./hooks.js";

/** The value the nearest provider of a context supplies at the position being evaluated, or null without one. */
export type ContextReader = (context: ContextDefinition) => StaticValue | null;

export const NO_PROVIDERS: ContextReader = () => null;

export interface CallFrame {
  node: FunctionLikeNode;
  scope: Scope;
  args: StaticValue[];
}

export interface EvaluationContext {
  module: ModuleRecord;
  scope: Scope;
  thisValue: StaticValue | null;
  readContext: ContextReader;
  callStack: CallFrame[];
  uncertainDepth: number;
  forkDepth: number;
  environment: RenderEnvironment | null;
  hooks: HookFrame | null;
}

export const withScope = (context: EvaluationContext, scope: Scope): EvaluationContext => ({
  ...context,
  scope,
});
