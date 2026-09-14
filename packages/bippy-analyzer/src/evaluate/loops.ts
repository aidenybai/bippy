import type {
  DoWhileStatement,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  ForStatementLeft,
  Statement,
  WhileStatement,
} from "oxc-parser";
import type { SourceLocation, StaticOptionalValue, StaticValue } from "../types.js";
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
import { getThrowCertainty } from "./thrown.js";
import {
  UNDEFINED_VALUE,
  getOwnEnumerableEntries,
  getObjectProperty,
  getTruthiness,
  primitiveValue,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

type LoopStatement =
  | ForOfStatement
  | ForInStatement
  | ForStatement
  | WhileStatement
  | DoWhileStatement;

/**
 * Upper bound on concretely unrolled iterations of a conditional loop before the
 * tail becomes uncertain. Loops over a known iterable are bounded by the
 * iterable itself (and the step budget), so they unroll in full.
 */
const MAX_UNROLLED_ITERATIONS = 256;

type UnrollResult =
  | { kind: "exact"; outcome: StatementOutcome }
  | { kind: "partial"; outcomes: StatementOutcome[] };

const completeUnrolling = (
  outcomes: StatementOutcome[],
  location: SourceLocation,
): UnrollResult => ({
  kind: "exact",
  outcome: mergeOutcomes(outcomes, "return inside a loop", location),
});

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
      interpreter.bindDeclarator(left.kind, declarator.id, value, context);
    return;
  }
  interpreter.assignTarget(left, value, context);
};

const ENUMERATION_TRAPS = ["ownKeys", "getOwnPropertyDescriptor"];

/** `for..in` enumerates through a proxy's target unless its handler traps key enumeration. */
const getEnumerationTarget = (value: StaticValue): StaticValue => {
  if (value.kind !== "proxy") return value;
  const isTrapped = ENUMERATION_TRAPS.some((trap) => {
    const handler = getObjectProperty(value.handler, trap);
    return handler.kind !== "primitive" || handler.value !== undefined;
  });
  return isTrapped ? value : getEnumerationTarget(value.target);
};

/** The items a loop visits one by one; `isComplete` is false when an unknown number of items follows them. */
interface IterationItems {
  items: StaticValue[];
  isComplete: boolean;
}

const isPositionalItem = (item: StaticValue): boolean =>
  item.kind !== "repeat" && item.kind !== "branch";

const iterationValues = (
  interpreter: Interpreter,
  statement: ForOfStatement | ForInStatement,
  context: EvaluationContext,
): IterationItems | null => {
  const right = interpreter.evaluateExpression(statement.right, context);
  if (statement.type === "ForOfStatement") {
    const iterated = interpreter.resolveIterable(
      right,
      context,
      interpreter.locate(context.module, statement.right),
    );
    if (iterated.kind === "list") {
      const positionalCount = iterated.items.findIndex((item) => !isPositionalItem(item));
      return positionalCount === -1
        ? { items: iterated.items, isComplete: true }
        : { items: iterated.items.slice(0, positionalCount), isComplete: false };
    }
    if (right.kind === "primitive" && typeof right.value === "string")
      return { items: [...right.value].map(primitiveValue), isComplete: true };
    return null;
  }
  const enumerated = getEnumerationTarget(right);
  if (enumerated.kind === "primitive") {
    const keys = typeof enumerated.value === "string" ? Object.keys(enumerated.value) : [];
    return { items: keys.map(primitiveValue), isComplete: true };
  }
  if (enumerated.kind !== "object" && enumerated.kind !== "list") return null;
  const entries = getOwnEnumerableEntries(enumerated);
  return entries ? { items: entries.map(([key]) => primitiveValue(key)), isComplete: true } : null;
};

const runBody = (
  interpreter: Interpreter,
  body: Statement,
  context: EvaluationContext,
): StatementOutcome => interpreter.evaluateBlock([body], context, true);

/**
 * Runs one concrete iteration. A definite `continue` or completion moves on, a
 * definite `break` ends the loop, a definite return ends the function. A return
 * (or throw) on only some paths leaves the function on those paths while the
 * others carry on with the next iteration; only a `break` that may or may not
 * happen leaves the remaining iterations uncertain.
 */
const advanceIteration = (
  outcome: StatementOutcome,
  outcomes: StatementOutcome[],
): "next" | UnrollResult => {
  const isDefinite = !outcome.mayComplete && outcome.returned === null;
  if (outcome.jump === "break" && isDefinite) return exactCompletion(outcomes);
  if (outcome.returned !== null && !outcome.mayComplete && outcome.jump === null) {
    return {
      kind: "exact",
      outcome: mergeOutcomes([...outcomes, outcome], "return inside a loop", null),
    };
  }
  if (outcome.returned) outcomes.push(returnOutcome(outcome.returned));
  return outcome.jump === null || outcome.jump === "continue"
    ? "next"
    : { kind: "partial", outcomes };
};

const createForEachContext = (
  interpreter: Interpreter,
  statement: ForOfStatement | ForInStatement,
  value: StaticValue,
  context: EvaluationContext,
): EvaluationContext => {
  const iterationContext = withScope(context, createScope(context.scope));
  bindLoopLeft(interpreter, statement.left, value, iterationContext);
  return iterationContext;
};

const runForEachIteration = (
  interpreter: Interpreter,
  statement: ForOfStatement | ForInStatement,
  value: StaticValue,
  context: EvaluationContext,
): StatementOutcome =>
  runBody(
    interpreter,
    statement.body,
    createForEachContext(interpreter, statement, value, context),
  );

/** An item present on some paths only runs its iteration on those paths, so the loop may skip it. */
const runOptionalIteration = (
  interpreter: Interpreter,
  statement: ForOfStatement | ForInStatement,
  item: StaticOptionalValue,
  context: EvaluationContext,
): StatementOutcome => {
  const outcome = interpreter.runMaybe(
    context.scope,
    () => runForEachIteration(interpreter, statement, item.value, context),
    item.reason,
    item.location,
    !item.isAbsentPreferred,
    false,
    { predicate: item.predicate ?? undefined },
  );
  return { ...outcome, mayComplete: true };
};

const unrollForEach = (
  interpreter: Interpreter,
  statement: ForOfStatement | ForInStatement,
  context: EvaluationContext,
  location: SourceLocation,
): UnrollResult | null => {
  const iteration = iterationValues(interpreter, statement, context);
  if (!iteration) return null;
  const collectFrom = (start: number, iterationContext: EvaluationContext): UnrollResult => {
    const outcomes: StatementOutcome[] = [];
    for (let index = start; index < iteration.items.length; index++) {
      const item = iteration.items[index];
      const evaluation =
        item.kind === "optional"
          ? {
              outcome: runOptionalIteration(interpreter, statement, item, iterationContext),
              isContinued: false,
            }
          : interpreter.evaluateLoopBody(
              statement.body,
              createForEachContext(interpreter, statement, item, iterationContext),
              (pathContext) =>
                finishUnrolling(
                  interpreter,
                  statement,
                  collectFrom(index + 1, withScope(pathContext, iterationContext.scope)),
                  pathContext,
                  location,
                ),
            );
      if (evaluation.isContinued)
        return completeUnrolling([...outcomes, evaluation.outcome], location);
      const step = advanceIteration(evaluation.outcome, outcomes);
      if (step !== "next") return step;
    }
    return iteration.isComplete ? exactCompletion(outcomes) : { kind: "partial", outcomes };
  };
  return collectFrom(0, context);
};

const unrollConditional = (
  interpreter: Interpreter,
  statement: ForStatement | WhileStatement | DoWhileStatement,
  context: EvaluationContext,
  location: SourceLocation,
): UnrollResult | null => {
  const loopContext = withScope(context, createScope(context.scope));
  const test = statement.test;
  const resumeFrom = (
    iteration: number,
    iterationContext: EvaluationContext,
    completion: StaticValue = UNDEFINED_VALUE,
  ): StatementOutcome =>
    interpreter.continueStatementValue(
      completion,
      iterationContext,
      (_value, pathContext) =>
        finishUnrolling(
          interpreter,
          statement,
          collectFrom(iteration, pathContext),
          pathContext,
          location,
        ),
      location,
    );
  const collectFrom = (
    startIteration: number,
    iterationContext: EvaluationContext,
    completedTest: StaticValue | null = null,
  ): UnrollResult | null => {
    const outcomes: StatementOutcome[] = [];
    for (let iteration = startIteration; iteration < MAX_UNROLLED_ITERATIONS; iteration++) {
      if (test && (iteration !== 0 || statement.type !== "DoWhileStatement")) {
        const tested =
          iteration === startIteration && completedTest !== null
            ? completedTest
            : interpreter.evaluateExpression(test, iterationContext);
        if (getThrowCertainty(tested) !== "never") {
          return completeUnrolling(
            [
              ...outcomes,
              interpreter.continueStatementValue(
                tested,
                iterationContext,
                (value, pathContext) =>
                  finishUnrolling(
                    interpreter,
                    statement,
                    collectFrom(iteration, pathContext, value),
                    pathContext,
                    location,
                  ),
                location,
              ),
            ],
            location,
          );
        }
        const truthiness = getTruthiness(tested);
        if (truthiness === null)
          return outcomes.length > 0 || iteration > 0 ? { kind: "partial", outcomes } : null;
        if (truthiness === false) return exactCompletion(outcomes);
      }
      const evaluation = interpreter.evaluateLoopBody(
        statement.body,
        iterationContext,
        (pathContext) => {
          const updated =
            statement.type === "ForStatement" && statement.update
              ? interpreter.evaluateExpression(statement.update, pathContext)
              : UNDEFINED_VALUE;
          return resumeFrom(iteration + 1, pathContext, updated);
        },
      );
      if (evaluation.isContinued)
        return completeUnrolling([...outcomes, evaluation.outcome], location);
      const step = advanceIteration(evaluation.outcome, outcomes);
      if (step !== "next") return step;
      if (statement.type === "ForStatement" && statement.update) {
        const updated = interpreter.evaluateExpression(statement.update, iterationContext);
        if (getThrowCertainty(updated) !== "never")
          return completeUnrolling(
            [...outcomes, resumeFrom(iteration + 1, iterationContext, updated)],
            location,
          );
      }
    }
    return { kind: "partial", outcomes };
  };
  if (statement.type === "ForStatement" && statement.init) {
    const initialized =
      statement.init.type === "VariableDeclaration"
        ? interpreter.evaluateBlock([statement.init], loopContext, false, (pathContext) =>
            resumeFrom(0, pathContext),
          )
        : resumeFrom(0, loopContext, interpreter.evaluateExpression(statement.init, loopContext));
    return completeUnrolling([initialized], location);
  }
  return collectFrom(0, loopContext);
};

/**
 * Evaluates the body once with every loop-controlled binding unknown. Used when
 * the iteration count is not statically known: the body's effects are joined
 * with the state in which it never ran, so assignments become branches and
 * pushed items become repeats.
 */
const evaluateUncertainTail = (
  interpreter: Interpreter,
  statement: LoopStatement,
  context: EvaluationContext,
  location: SourceLocation,
): StatementOutcome => {
  const loopContext: EvaluationContext = {
    ...context,
    scope: createScope(context.scope),
  };
  if (statement.type === "ForOfStatement" || statement.type === "ForInStatement") {
    const value =
      statement.type === "ForInStatement"
        ? unknownPrimitiveValue("string", "loop key")
        : unknownValue("loop variable", location);
    bindLoopLeft(interpreter, statement.left, value, loopContext);
  } else if (statement.type === "ForStatement" && statement.init?.type === "VariableDeclaration") {
    for (const declarator of statement.init.declarations) {
      interpreter.bindDeclarator(
        statement.init.kind,
        declarator.id,
        declarator.init?.type === "Literal" && typeof declarator.init.value === "number"
          ? unknownPrimitiveValue("number", "loop counter")
          : unknownValue("loop variable", location),
        loopContext,
      );
    }
  }
  const test = "test" in statement ? statement.test : null;
  const whileTestHolds = <Result>(run: () => Result): Result =>
    test ? interpreter.runWhenTruthy(test, loopContext, run) : run();
  const runTailBody = (): StatementOutcome => runBody(interpreter, statement.body, loopContext);
  const outcome = interpreter.runMaybe(
    context.scope,
    () => whileTestHolds(runTailBody),
    "loop iterations are uncertain",
    location,
    true,
    true,
  );
  whileTestHolds(() => interpreter.widenLoopCarriedBindings(context.scope, runTailBody, location));
  return { ...outcome, mayComplete: true, jump: null };
};

const finishUnrolling = (
  interpreter: Interpreter,
  statement: LoopStatement,
  unrolled: UnrollResult | null,
  context: EvaluationContext,
  location: SourceLocation,
): StatementOutcome => {
  if (unrolled?.kind === "exact") return unrolled.outcome;
  const tail = evaluateUncertainTail(interpreter, statement, context, location);
  return mergeOutcomes([...(unrolled?.outcomes ?? []), tail], "return inside a loop", location);
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
      ? unrollForEach(interpreter, statement, context, location)
      : unrollConditional(interpreter, statement, context, location);
  return finishUnrolling(interpreter, statement, unrolled, context, location);
};
