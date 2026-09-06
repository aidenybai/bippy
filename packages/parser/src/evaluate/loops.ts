import type {
  DoWhileStatement,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  ForStatementLeft,
  Statement,
  WhileStatement,
} from "oxc-parser";
import type { SourceLocation, StaticValue } from "../types.js";
import type { EvaluationContext } from "./context.js";
import { withScope } from "./context.js";
import {
  COMPLETES,
  type Interpreter,
  mergeOutcomes,
  returnOutcome,
  type StatementOutcome,
} from "./interpreter.js";
import { createScope } from "./scope.js";
import {
  getKnownObjectKeys,
  getTruthiness,
  isKnownList,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

export type LoopStatement =
  | ForOfStatement
  | ForInStatement
  | ForStatement
  | WhileStatement
  | DoWhileStatement;

/** Upper bound on concretely unrolled iterations before the tail becomes uncertain. */
const MAX_UNROLLED_ITERATIONS = 256;

type UnrollResult =
  | { kind: "exact"; outcome: StatementOutcome }
  | { kind: "partial"; outcomes: StatementOutcome[] };

const exactCompletion = (outcomes: StatementOutcome[]): UnrollResult => ({
  kind: "exact",
  outcome: mergeOutcomes([...outcomes, COMPLETES], "return inside a loop", null),
});

const bindLoopLeft = (
  interpreter: Interpreter,
  left: ForStatementLeft,
  value: StaticValue,
  context: EvaluationContext,
): void => {
  if (left.type === "VariableDeclaration") {
    for (const declarator of left.declarations)
      interpreter.bindPattern(declarator.id, value, context.scope, context);
    return;
  }
  interpreter.assignTarget(left, value, context);
};

const iterationValues = (
  interpreter: Interpreter,
  statement: ForOfStatement | ForInStatement,
  context: EvaluationContext,
): StaticValue[] | null => {
  const right = interpreter.evaluateExpression(statement.right, context);
  if (statement.type === "ForOfStatement") {
    if (isKnownList(right)) return right.items;
    if (right.kind === "primitive" && typeof right.value === "string")
      return [...right.value].map(primitiveValue);
    return null;
  }
  if (right.kind !== "object") return null;
  const keys = getKnownObjectKeys(right);
  return keys ? keys.map(primitiveValue) : null;
};

const runBody = (
  interpreter: Interpreter,
  body: Statement,
  context: EvaluationContext,
): StatementOutcome => interpreter.evaluateBlock([body], context, true);

/**
 * Runs one concrete iteration. A definite `continue` or completion moves on, a
 * definite `break` ends the loop, a definite return ends the function; anything
 * that only happens on some paths leaves the remaining iterations uncertain.
 */
const runIteration = (
  interpreter: Interpreter,
  body: Statement,
  context: EvaluationContext,
  outcomes: StatementOutcome[],
): "next" | UnrollResult => {
  const outcome = runBody(interpreter, body, context);
  const isDefinite = !outcome.mayComplete && outcome.returned === null;
  if (outcome.jump === "continue" && isDefinite) return "next";
  if (outcome.jump === "break" && isDefinite) return exactCompletion(outcomes);
  if (outcome.jump === null) {
    if (outcome.returned === null) return "next";
    if (!outcome.mayComplete) {
      return {
        kind: "exact",
        outcome: mergeOutcomes([...outcomes, outcome], "return inside a loop", null),
      };
    }
  }
  if (outcome.returned) outcomes.push(returnOutcome(outcome.returned));
  return { kind: "partial", outcomes };
};

const unrollForEach = (
  interpreter: Interpreter,
  statement: ForOfStatement | ForInStatement,
  context: EvaluationContext,
): UnrollResult | null => {
  const values = iterationValues(interpreter, statement, context);
  if (!values || values.length > MAX_UNROLLED_ITERATIONS) return null;
  const outcomes: StatementOutcome[] = [];
  for (const value of values) {
    const iterationContext = withScope(context, createScope(context.scope));
    bindLoopLeft(interpreter, statement.left, value, iterationContext);
    const step = runIteration(interpreter, statement.body, iterationContext, outcomes);
    if (step !== "next") return step;
  }
  return exactCompletion(outcomes);
};

const unrollConditional = (
  interpreter: Interpreter,
  statement: ForStatement | WhileStatement | DoWhileStatement,
  context: EvaluationContext,
): UnrollResult | null => {
  const loopContext = withScope(context, createScope(context.scope));
  if (statement.type === "ForStatement" && statement.init) {
    if (statement.init.type === "VariableDeclaration") {
      for (const declarator of statement.init.declarations) {
        const value = declarator.init
          ? interpreter.evaluateExpression(declarator.init, loopContext)
          : unknownValue("uninitialized loop variable");
        interpreter.bindPattern(declarator.id, value, loopContext.scope, loopContext);
      }
    } else {
      interpreter.evaluateExpression(statement.init, loopContext);
    }
  }
  const test = statement.test;
  if (!test) return null;
  const outcomes: StatementOutcome[] = [];
  let skipFirstTest = statement.type === "DoWhileStatement";
  for (let iteration = 0; iteration < MAX_UNROLLED_ITERATIONS; iteration++) {
    if (!skipFirstTest) {
      const truthiness = getTruthiness(interpreter.evaluateExpression(test, loopContext));
      if (truthiness === null)
        return outcomes.length > 0 || iteration > 0 ? { kind: "partial", outcomes } : null;
      if (truthiness === false) return exactCompletion(outcomes);
    }
    skipFirstTest = false;
    const step = runIteration(interpreter, statement.body, loopContext, outcomes);
    if (step !== "next") return step;
    if (statement.type === "ForStatement" && statement.update)
      interpreter.evaluateExpression(statement.update, loopContext);
  }
  return { kind: "partial", outcomes };
};

/**
 * Evaluates the body once with every loop-controlled binding unknown. Used when
 * the iteration count is not statically known; assignments inside become
 * branches and pushed items become repeats via `uncertainDepth`.
 */
const evaluateUncertainTail = (
  interpreter: Interpreter,
  statement: LoopStatement,
  context: EvaluationContext,
): StatementOutcome => {
  const loopContext: EvaluationContext = {
    ...context,
    scope: createScope(context.scope),
    uncertainDepth: context.uncertainDepth + 1,
  };
  if (statement.type === "ForOfStatement" || statement.type === "ForInStatement") {
    if (statement.left.type === "VariableDeclaration") {
      const value =
        statement.type === "ForInStatement"
          ? unknownPrimitiveValue("string", "loop key")
          : unknownValue("loop variable");
      for (const declarator of statement.left.declarations) {
        interpreter.bindPattern(declarator.id, value, loopContext.scope, loopContext);
      }
    }
  } else if (statement.type === "ForStatement" && statement.init?.type === "VariableDeclaration") {
    for (const declarator of statement.init.declarations) {
      interpreter.bindPattern(
        declarator.id,
        unknownPrimitiveValue("number", "loop counter"),
        loopContext.scope,
        loopContext,
      );
    }
  }
  const outcome = runBody(interpreter, statement.body, loopContext);
  return { returned: outcome.returned, mayComplete: true, jump: null };
};

/**
 * Loops are unrolled while their iteration count is statically known (a known
 * list, a known key set, or a counter whose test stays decidable) and every
 * `break`/`continue` is definite. Once that stops being true the remaining
 * iterations collapse into a single uncertain evaluation.
 */
export const evaluateLoop = (
  interpreter: Interpreter,
  statement: LoopStatement,
  context: EvaluationContext,
  location: SourceLocation,
): StatementOutcome => {
  const unrolled =
    statement.type === "ForOfStatement" || statement.type === "ForInStatement"
      ? unrollForEach(interpreter, statement, context)
      : unrollConditional(interpreter, statement, context);
  if (unrolled?.kind === "exact") return unrolled.outcome;
  const tail = evaluateUncertainTail(interpreter, statement, context);
  return mergeOutcomes([...(unrolled?.outcomes ?? []), tail], "return inside a loop", location);
};
