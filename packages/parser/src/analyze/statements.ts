import type {
  ForStatementLeft,
  IfStatement,
  Statement,
  SwitchStatement,
  TryStatement,
  VariableDeclarator,
} from "@oxc-project/types";
import { getIterationItem } from "./access.js";
import { classifyClass } from "./components.js";
import {
  BREAK_COMPLETION,
  type Completion,
  type EvaluationContext,
  type Interpreter,
  NORMAL_COMPLETION,
  returnCompletion,
} from "./interpreter.js";
import { assignToTarget, bindPattern } from "./patterns.js";
import {
  createScope,
  declareVariable,
  forkScope,
  mergeBranchScopes,
  type Scope,
} from "./scope.js";
import {
  conditional,
  getTruthiness,
  nameValue,
  type StaticValue,
  UNDEFINED,
  unknown,
} from "./values.js";

interface Arm {
  test: string;
  scope: Scope;
  completion: Completion;
}

/** Outcome of a control-flow statement whose direction is unknown statically. */
interface ArmSet {
  kind: "arms";
  arms: Arm[];
  /** The `else` / `default` / `catch` arm; `null` when the statement may be skipped entirely. */
  fallback: Arm | null;
}

const toStatements = (statement: Statement): Statement[] =>
  statement.type === "BlockStatement" ? statement.body : [statement];

const evaluateInScope = (
  interpreter: Interpreter,
  statements: Statement[],
  scope: Scope,
  context: EvaluationContext,
): Completion => interpreter.evaluateStatements(statements, { ...context, scope });

const evaluateArm = (
  interpreter: Interpreter,
  test: string,
  statements: Statement[],
  context: EvaluationContext,
): Arm => {
  const scope = forkScope(context.scope);
  return { test, scope, completion: evaluateInScope(interpreter, statements, scope, context) };
};

/** `break` ends a switch case or loop iteration, not the enclosing function. */
const withoutBreak = (arm: Arm): Arm =>
  arm.completion.kind === "break" ? { ...arm, completion: NORMAL_COMPLETION } : arm;

const hoistFunctionDeclarations = (statements: Statement[], context: EvaluationContext): void => {
  for (const statement of statements) {
    if (statement.type !== "FunctionDeclaration" || !statement.id) continue;
    declareVariable(context.scope, statement.id.name, {
      kind: "function",
      fn: statement,
      module: context.module,
      scope: context.scope,
      thisValue: null,
      name: statement.id.name,
    });
  }
};

const evaluateIf = (
  interpreter: Interpreter,
  statement: IfStatement,
  context: EvaluationContext,
): Completion | ArmSet => {
  const truthiness = getTruthiness(interpreter.evaluateExpression(statement.test, context));
  if (truthiness === true) {
    return evaluateInScope(interpreter, toStatements(statement.consequent), createScope(context.scope), context);
  }
  if (truthiness === false) {
    return statement.alternate
      ? evaluateInScope(interpreter, toStatements(statement.alternate), createScope(context.scope), context)
      : NORMAL_COMPLETION;
  }
  const test = interpreter.getSource(context.module, statement.test);
  return {
    kind: "arms",
    arms: [evaluateArm(interpreter, test, toStatements(statement.consequent), context)],
    fallback: statement.alternate
      ? evaluateArm(interpreter, `!(${test})`, toStatements(statement.alternate), context)
      : null,
  };
};

interface CaseGroup {
  tests: string[];
  isDefault: boolean;
  statements: Statement[];
}

/** Cases with empty bodies fall through into the next non-empty case. */
const groupSwitchCases = (
  interpreter: Interpreter,
  statement: SwitchStatement,
  context: EvaluationContext,
): CaseGroup[] => {
  const groups: CaseGroup[] = [];
  let pending: CaseGroup = { tests: [], isDefault: false, statements: [] };
  for (const switchCase of statement.cases) {
    if (switchCase.test) pending.tests.push(interpreter.getSource(context.module, switchCase.test));
    else pending.isDefault = true;
    if (switchCase.consequent.length === 0) continue;
    pending.statements = switchCase.consequent;
    groups.push(pending);
    pending = { tests: [], isDefault: false, statements: [] };
  }
  if (pending.tests.length > 0 || pending.isDefault) groups.push(pending);
  return groups;
};

const evaluateSwitch = (
  interpreter: Interpreter,
  statement: SwitchStatement,
  context: EvaluationContext,
): Completion | ArmSet => {
  const discriminant = interpreter.evaluateExpression(statement.discriminant, context);
  const testValues = statement.cases.map((switchCase) =>
    switchCase.test ? interpreter.evaluateExpression(switchCase.test, context) : null,
  );
  const isDecidable =
    discriminant.kind === "literal" &&
    testValues.every((testValue) => testValue === null || testValue.kind === "literal");
  if (isDecidable) {
    const matchIndex = testValues.findIndex(
      (testValue) => testValue?.kind === "literal" && testValue.value === discriminant.value,
    );
    const startIndex = matchIndex === -1 ? testValues.indexOf(null) : matchIndex;
    if (startIndex === -1) return NORMAL_COMPLETION;
    const statements = statement.cases.slice(startIndex).flatMap((switchCase) => switchCase.consequent);
    const completion = evaluateInScope(interpreter, statements, createScope(context.scope), context);
    return completion.kind === "break" ? NORMAL_COMPLETION : completion;
  }
  const discriminantSource = interpreter.getSource(context.module, statement.discriminant);
  const arms: Arm[] = [];
  let fallback: Arm | null = null;
  for (const group of groupSwitchCases(interpreter, statement, context)) {
    const test = group.tests.map((caseTest) => `${discriminantSource} === ${caseTest}`).join(" || ");
    const arm = withoutBreak(evaluateArm(interpreter, test || "default", group.statements, context));
    if (group.isDefault && group.tests.length === 0) fallback = arm;
    else arms.push(arm);
  }
  return { kind: "arms", arms, fallback };
};

const bindLoopVariable = (
  interpreter: Interpreter,
  left: ForStatementLeft,
  value: StaticValue,
  context: EvaluationContext,
): void => {
  if (left.type === "VariableDeclaration") {
    for (const declarator of left.declarations) bindPattern(interpreter, declarator.id, value, context);
    return;
  }
  assignToTarget(interpreter, left, value, context);
};

/** `for (let index = 0; …)` counters differ per iteration, so the body sees them as unknown. */
const forgetLoopCounters = (declarations: VariableDeclarator[], scope: Scope): void => {
  for (const declarator of declarations) {
    if (declarator.id.type !== "Identifier") continue;
    declareVariable(scope, declarator.id.name, unknown(`loop counter ${declarator.id.name}`));
  }
};

/** Loop bodies run once in a branch scope: zero iterations is always possible. */
const evaluateLoop = (
  interpreter: Interpreter,
  statement: Statement,
  context: EvaluationContext,
): ArmSet | null => {
  const scope = forkScope(context.scope);
  const loopContext: EvaluationContext = { ...context, scope, isInsideLoop: true };
  let body: Statement;
  switch (statement.type) {
    case "ForStatement":
      if (statement.init?.type === "VariableDeclaration") {
        evaluateStatement(interpreter, statement.init, loopContext);
        forgetLoopCounters(statement.init.declarations, scope);
      } else if (statement.init) interpreter.evaluateExpression(statement.init, loopContext);
      body = statement.body;
      break;
    case "ForOfStatement": {
      const iterable = interpreter.evaluateExpression(statement.right, loopContext);
      const description = interpreter.getSource(context.module, statement.right);
      bindLoopVariable(interpreter, statement.left, getIterationItem(iterable, description), loopContext);
      body = statement.body;
      break;
    }
    case "ForInStatement":
      bindLoopVariable(interpreter, statement.left, unknown("enumerated key"), loopContext);
      body = statement.body;
      break;
    case "WhileStatement":
    case "DoWhileStatement":
      body = statement.body;
      break;
    default:
      return null;
  }
  const header = interpreter.getSource(context.module, { start: statement.start, end: body.start });
  const completion = evaluateInScope(interpreter, toStatements(body), scope, loopContext);
  return { kind: "arms", arms: [withoutBreak({ test: header, scope, completion })], fallback: null };
};

const evaluateTry = (
  interpreter: Interpreter,
  statement: TryStatement,
  context: EvaluationContext,
): ArmSet => {
  const tryArm = evaluateArm(interpreter, "try", statement.block.body, context);
  let fallback: Arm | null = null;
  if (statement.handler) {
    const scope = forkScope(context.scope);
    const handlerContext = { ...context, scope };
    if (statement.handler.param) {
      bindPattern(interpreter, statement.handler.param, unknown("caught error"), handlerContext);
    }
    fallback = {
      test: "catch",
      scope,
      completion: interpreter.evaluateStatements(statement.handler.body.body, handlerContext),
    };
  }
  if (statement.finalizer) interpreter.evaluateStatements(statement.finalizer.body, context);
  return { kind: "arms", arms: [tryArm], fallback };
};

const evaluateStatement = (
  interpreter: Interpreter,
  statement: Statement,
  context: EvaluationContext,
): Completion | ArmSet => {
  switch (statement.type) {
    case "IfStatement":
      return evaluateIf(interpreter, statement, context);
    case "SwitchStatement":
      return evaluateSwitch(interpreter, statement, context);
    case "TryStatement":
      return evaluateTry(interpreter, statement, context);
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
      return evaluateLoop(interpreter, statement, context) ?? NORMAL_COMPLETION;
    case "LabeledStatement":
      return evaluateStatement(interpreter, statement.body, context);
    case "BlockStatement":
      return evaluateInScope(interpreter, statement.body, createScope(context.scope), context);
    case "VariableDeclaration":
      for (const declarator of statement.declarations) {
        const nameHint = declarator.id.type === "Identifier" ? declarator.id.name : null;
        const value = declarator.init
          ? nameValue(interpreter.evaluateExpression(declarator.init, context), nameHint)
          : UNDEFINED;
        bindPattern(interpreter, declarator.id, value, context);
      }
      return NORMAL_COMPLETION;
    case "ClassDeclaration":
      if (statement.id) {
        const classValue = classifyClass(
          interpreter,
          statement,
          context.module,
          context.scope,
          statement.id.name,
          context,
        );
        declareVariable(context.scope, statement.id.name, classValue);
      }
      return NORMAL_COMPLETION;
    case "ReturnStatement":
      return returnCompletion(
        statement.argument ? interpreter.evaluateExpression(statement.argument, context) : UNDEFINED,
      );
    case "ExpressionStatement":
      interpreter.evaluateExpression(statement.expression, context);
      return NORMAL_COMPLETION;
    case "ThrowStatement":
      return returnCompletion(
        unknown(`throw ${interpreter.getSource(context.module, statement.argument)}`),
      );
    case "BreakStatement":
    case "ContinueStatement":
      return BREAK_COMPLETION;
    default:
      return NORMAL_COMPLETION;
  }
};

const isReturning = (completion: Completion): boolean =>
  completion.kind === "return" || completion.kind === "partial";

const valueOf = (arm: Arm, restValue: StaticValue): StaticValue => {
  switch (arm.completion.kind) {
    case "return":
      return arm.completion.value;
    case "partial":
      return arm.completion.complete(restValue);
    default:
      return restValue;
  }
};

/**
 * Joins the arms of a branch. Every arm returning gives a conditional over
 * their values; otherwise the result stays partial and is completed with
 * whatever the statements after the branch evaluate to.
 */
const combineArms = (armSet: ArmSet, context: EvaluationContext): Completion => {
  const allArms = armSet.fallback ? [...armSet.arms, armSet.fallback] : armSet.arms;
  const returningArms = allArms.filter((arm) => isReturning(arm.completion));
  const continuingArms = armSet.arms.filter((arm) => !isReturning(arm.completion));
  const continuingFallback =
    armSet.fallback && !isReturning(armSet.fallback.completion) ? armSet.fallback.scope : null;
  mergeBranchScopes(context.scope, continuingArms, continuingFallback);
  if (returningArms.length === 0) {
    const allBreak = allArms.every((arm) => arm.completion.kind === "break");
    return allBreak && armSet.fallback ? BREAK_COMPLETION : NORMAL_COMPLETION;
  }
  const complete = (restValue: StaticValue): StaticValue => {
    let merged = armSet.fallback ? valueOf(armSet.fallback, restValue) : restValue;
    for (let index = armSet.arms.length - 1; index >= 0; index--) {
      const arm = armSet.arms[index];
      merged = conditional(arm.test, valueOf(arm, restValue), merged);
    }
    return merged;
  };
  const everyPathReturns =
    armSet.fallback !== null && allArms.every((arm) => arm.completion.kind === "return");
  return everyPathReturns ? returnCompletion(complete(UNDEFINED)) : { kind: "partial", complete };
};

/** Chains a partial completion with what the remaining statements produced. */
const continuePartial = (
  partial: (restValue: StaticValue) => StaticValue,
  rest: Completion,
): Completion => {
  switch (rest.kind) {
    case "return":
      return returnCompletion(partial(rest.value));
    case "partial":
      return { kind: "partial", complete: (restValue) => partial(rest.complete(restValue)) };
    default:
      return { kind: "partial", complete: partial };
  }
};

const evaluateSequence = (
  interpreter: Interpreter,
  statements: Statement[],
  startIndex: number,
  context: EvaluationContext,
): Completion => {
  for (let index = startIndex; index < statements.length; index++) {
    const outcome = evaluateStatement(interpreter, statements[index], context);
    const completion = outcome.kind === "arms" ? combineArms(outcome, context) : outcome;
    if (completion.kind === "normal") continue;
    if (completion.kind !== "partial") return completion;
    return continuePartial(
      completion.complete,
      evaluateSequence(interpreter, statements, index + 1, context),
    );
  }
  return NORMAL_COMPLETION;
};

export const evaluateStatements = (
  interpreter: Interpreter,
  statements: Statement[],
  context: EvaluationContext,
): Completion => {
  hoistFunctionDeclarations(statements, context);
  return evaluateSequence(interpreter, statements, 0, context);
};
