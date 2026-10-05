import { NO_PROVIDERS, type EvaluationContext } from "../../src/evaluate/context.js";
import { createHookFrame, type HookFrame } from "../../src/evaluate/hooks.js";
import { createScope } from "../../src/evaluate/scope.js";
import { objectValue } from "../../src/evaluate/values.js";
import { createModuleRecord } from "../../src/graph/module-record.js";
import { parseSourceText } from "../../src/parse/parse-source-file.js";
import type { StaticFunctionValue } from "../../src/types.js";

interface HookEvaluationContext extends EvaluationContext {
  hooks: HookFrame;
}

export const createEvaluationContext = (): HookEvaluationContext => ({
  module: createModuleRecord(parseSourceText("/component.tsx", "() => 1", "tsx")),
  scope: createScope(null),
  budget: { remaining: 1000 },
  thisValue: null,
  superBinding: null,
  readContext: NO_PROVIDERS,
  callStack: [],
  uncertainDepth: 0,
  forkDepth: 0,
  environment: null,
  hooks: createHookFrame(),
  suspension: null,
  owner: null,
});

export const createCallbackValue = (context: EvaluationContext): StaticFunctionValue => {
  const statement = context.module.file.program.body[0];
  if (
    statement?.type !== "ExpressionStatement" ||
    statement.expression.type !== "ArrowFunctionExpression"
  ) {
    throw new Error("Expected an arrow function fixture");
  }
  return {
    kind: "function",
    node: statement.expression,
    scope: context.scope,
    module: context.module,
    thisValue: null,
    superBinding: null,
    name: "callback",
    properties: objectValue(),
  };
};
