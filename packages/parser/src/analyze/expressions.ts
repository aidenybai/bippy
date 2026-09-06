import type {
  AssignmentExpression,
  AssignmentOperator,
  Expression,
  LogicalExpression,
  LogicalOperator,
  MemberExpression,
  ObjectExpression,
  Span,
  TaggedTemplateExpression,
  TemplateLiteral,
} from "@oxc-project/types";
import {
  getMemberLinks,
  isAnonymousFunctionDefinition,
  isOptionalSpine,
  isStringLiteral,
  type MemberLink,
} from "../module/ast.js";
import { getProperty, normalizeExternal, spreadInto } from "./access.js";
import {
  getStandardGlobal,
  isGlobalChain,
  isKnownGlobal,
  readEnvironmentVariable,
} from "./globals.js";
import { evaluateCall } from "./calls.js";
import { classifyClass } from "./components.js";
import {
  enterUndecided,
  type EvaluationContext,
  getUndecidedDepth,
  type Interpreter,
} from "./interpreter.js";
import { evaluateJsxElement, evaluateJsxFragment } from "./jsx.js";
import {
  collectNarrowings,
  keepArms,
  keepFalsy,
  keepNonNullish,
  keepNullish,
  keepTruthy,
  narrowScope,
} from "./narrowing.js";
import { applyBinaryOperator, applyUnaryOperator, getBinaryOperator } from "./operators.js";
import { assignToTarget, getPropertyKeyName } from "./patterns.js";
import { lookupVariable } from "./scope.js";
import {
  array,
  conditional,
  type ExternalValue,
  FALSE,
  type FunctionValue,
  getTruthiness,
  isNullishValue,
  literal,
  mapConditional,
  mergeObjects,
  nameValue,
  object,
  readItem,
  regexp,
  type StaticValue,
  text,
  UNDEFINED,
  unknown,
} from "./values.js";

const GLOBAL_LITERALS: Record<string, StaticValue> = {
  undefined: UNDEFINED,
  NaN: literal(Number.NaN),
  Infinity: literal(Number.POSITIVE_INFINITY),
};

/** `React` used without an import: UMD globals and the classic JSX pragma. */
const REACT_GLOBAL: ExternalValue = {
  kind: "external",
  specifier: "react",
  packageName: "react",
  importedName: "*",
  memberPath: [],
  name: "React",
};

export const resolveIdentifier = (
  interpreter: Interpreter,
  name: string,
  span: Span,
  context: EvaluationContext,
): StaticValue => {
  const local = lookupVariable(context.scope, name);
  if (local !== undefined) return local;
  const moduleValue = interpreter.resolveModuleBinding(context.module, name);
  if (moduleValue) return moduleValue;
  const globalLiteral = GLOBAL_LITERALS[name];
  if (globalLiteral) return globalLiteral;
  if (name === "React") return REACT_GLOBAL;
  const standard = getStandardGlobal(name);
  if (standard) return standard;
  if (!isKnownGlobal(name)) {
    interpreter.report("unresolved-reference", `no binding for "${name}"`, context.module, span);
  }
  return unknown(`global ${name}`);
};

/**
 * Reads `key` off each possible target. Inside an optional chain a nullish
 * target short-circuits to `undefined` instead of failing the read.
 */
const accessMember = (
  interpreter: Interpreter,
  target: StaticValue,
  key: string,
  isShortCircuiting: boolean,
): StaticValue =>
  mapConditional(target, (arm) =>
    isShortCircuiting && isNullishValue(arm) ? UNDEFINED : getProperty(interpreter, arm, key),
  );

const accessLinks = (
  interpreter: Interpreter,
  links: MemberLink[],
  span: Span,
  context: EvaluationContext,
): StaticValue => {
  const chain = links.map((link) => link.name);
  const firstOptional = links.findIndex((link) => link.isOptional);
  const isEnvironmentRead =
    chain[0] === "process" &&
    chain[1] === "env" &&
    chain.length > 2 &&
    isGlobalChain(chain, context);
  let value = isEnvironmentRead
    ? readEnvironmentVariable(interpreter, chain[2])
    : resolveIdentifier(interpreter, chain[0], span, context);
  for (let index = isEnvironmentRead ? 3 : 1; index < chain.length; index++) {
    const isShortCircuiting = firstOptional !== -1 && index >= firstOptional;
    value = accessMember(interpreter, value, chain[index], isShortCircuiting);
  }
  return value;
};

export const evaluateChain = (
  interpreter: Interpreter,
  chain: string[],
  span: Span,
  context: EvaluationContext,
): StaticValue =>
  accessLinks(
    interpreter,
    chain.map((name) => ({ name, isOptional: false })),
    span,
    context,
  );

const evaluateMember = (
  interpreter: Interpreter,
  expression: MemberExpression,
  context: EvaluationContext,
): StaticValue => {
  const links = getMemberLinks(expression);
  if (links && links[0].name !== "this")
    return accessLinks(interpreter, links, expression, context);
  const target = interpreter.evaluateExpression(expression.object, context);
  const key = getPropertyKeyName(interpreter, expression.property, expression.computed, context);
  if (key !== null) return accessMember(interpreter, target, key, isOptionalSpine(expression));
  if (target.kind === "list") return target.item;
  if (target.kind === "array" && target.items.length === 1) return readItem(target.items[0]);
  return unknown(interpreter.getSource(context.module, expression));
};

/**
 * `a && b` with an undecidable `a` yields `b` or nothing: a falsy left
 * operand is assumed to be one React skips (`false`, `null`, `undefined`,
 * `""`) rather than a `0` that would render as text.
 */
/** The context for code that only runs once `test` had `outcome`. */
const enterOutcome = (
  interpreter: Interpreter,
  context: EvaluationContext,
  test: Expression,
  testSource: string,
  outcome: boolean,
): EvaluationContext => {
  const narrowings = collectNarrowings(test, outcome, (expression) =>
    interpreter.getSource(context.module, expression),
  );
  return enterUndecided(context, testSource, narrowScope(context.scope, narrowings));
};

const evaluateLogical = (
  interpreter: Interpreter,
  expression: LogicalExpression,
  context: EvaluationContext,
): StaticValue => {
  const left = interpreter.evaluateExpression(expression.left, context);
  const test = interpreter.getSource(context.module, expression.left);
  return applyLogicalOperator(expression.operator, left, test, () =>
    interpreter.evaluateExpression(
      expression.right,
      expression.operator === "??"
        ? enterUndecided(context, test, context.scope)
        : enterOutcome(interpreter, context, expression.left, test, expression.operator === "&&"),
    ),
  );
};

/**
 * Short-circuits when the left side decides; otherwise both sides remain
 * possible, and the arm that keeps the left side only keeps what the
 * operator lets through (`a || b` yields `a` only where `a` is truthy).
 */
const applyLogicalOperator = (
  operator: LogicalOperator,
  left: StaticValue,
  test: string,
  right: () => StaticValue,
): StaticValue => {
  const truthiness = getTruthiness(left);
  switch (operator) {
    case "&&": {
      if (truthiness === false) return left;
      if (truthiness === true) return right();
      /** An unknown that turned out falsy is modelled as `false`, the boolean case. */
      const falsyLeft = mapConditional(keepArms(left, keepFalsy) ?? FALSE, (arm) =>
        arm.kind === "literal" ? arm : FALSE,
      );
      return conditional(test, right(), falsyLeft);
    }
    case "||":
      if (truthiness === true) return left;
      if (truthiness === false) return right();
      return conditional(test, keepArms(left, keepTruthy) ?? left, right());
    case "??": {
      const nonNullish = keepArms(left, keepNonNullish);
      if (nonNullish === null) return right();
      if (keepArms(left, keepNullish) === null) return left;
      return conditional(`${test} != null`, nonNullish, right());
    }
  }
};

const LOGICAL_ASSIGNMENT_OPERATORS: Partial<Record<AssignmentOperator, LogicalOperator>> = {
  "&&=": "&&",
  "||=": "||",
  "??=": "??",
};

/** `x += y`, `x ||= y`: the current value combined with the right side. */
const evaluateCompoundAssignment = (
  interpreter: Interpreter,
  expression: AssignmentExpression,
  right: StaticValue,
  context: EvaluationContext,
): StaticValue => {
  const target = expression.left;
  const source = interpreter.getSource(context.module, expression);
  if (target.type === "ArrayPattern" || target.type === "ObjectPattern") return unknown(source);
  const current = interpreter.evaluateExpression(target, context);
  const logicalOperator = LOGICAL_ASSIGNMENT_OPERATORS[expression.operator];
  if (logicalOperator) {
    return applyLogicalOperator(
      logicalOperator,
      current,
      interpreter.getSource(context.module, target),
      () => right,
    );
  }
  const binaryOperator = getBinaryOperator(expression.operator);
  return binaryOperator
    ? applyBinaryOperator(binaryOperator, current, right, source)
    : unknown(source);
};

const evaluateTemplate = (
  interpreter: Interpreter,
  expression: TemplateLiteral,
  context: EvaluationContext,
): StaticValue => {
  let result = "";
  for (const [index, quasi] of expression.quasis.entries()) {
    result += quasi.value.cooked ?? quasi.value.raw;
    const inner = expression.expressions[index];
    if (!inner) continue;
    const value = interpreter.evaluateExpression(inner, context);
    if (value.kind !== "literal") return text(interpreter.getSource(context.module, expression));
    result += String(value.value);
  }
  return literal(result);
};

const evaluateTaggedTemplate = (
  interpreter: Interpreter,
  expression: TaggedTemplateExpression,
  context: EvaluationContext,
): StaticValue => {
  const tag = interpreter.evaluateExpression(expression.tag, context);
  const source = interpreter.getSource(context.module, expression);
  if (tag.kind !== "function") return unknown(source);
  const strings = array(
    expression.quasi.quasis.map((quasi) => literal(quasi.value.cooked ?? quasi.value.raw)),
  );
  const values = expression.quasi.expressions.map((inner) =>
    interpreter.evaluateExpression(inner, context),
  );
  return interpreter.callFunction(tag, [strings, ...values], context);
};

const evaluateObject = (
  interpreter: Interpreter,
  expression: ObjectExpression,
  context: EvaluationContext,
): StaticValue => {
  const result = object([], false, getUndecidedDepth(context));
  for (const property of expression.properties) {
    if (property.type === "SpreadElement") {
      const spread = interpreter.evaluateExpression(property.argument, context);
      if (spread.kind === "object") mergeObjects(result, spread);
      else if (spread.kind !== "literal") result.hasUnknownSpread = true;
      continue;
    }
    const key = getPropertyKeyName(interpreter, property.key, property.computed, context);
    if (key === null) {
      result.hasUnknownSpread = true;
      continue;
    }
    if (property.kind !== "init") {
      result.properties.set(key, unknown(`accessor ${key}`));
      continue;
    }
    let value = interpreter.evaluateExpression(property.value, context);
    if (value.kind === "function" && property.method) value = { ...value, thisValue: result };
    result.properties.set(
      key,
      nameValue(value, key, isAnonymousFunctionDefinition(property.value)),
    );
  }
  return result;
};

const createFunctionValue = (
  fn: FunctionValue["fn"],
  context: EvaluationContext,
): FunctionValue => ({
  kind: "function",
  fn,
  module: context.module,
  scope: context.scope,
  thisValue: fn.type === "ArrowFunctionExpression" ? context.thisValue : null,
  name: fn.type === "ArrowFunctionExpression" ? null : (fn.id?.name ?? null),
  statics: new Map(),
});

export const evaluateExpression = (
  interpreter: Interpreter,
  expression: Expression,
  context: EvaluationContext,
): StaticValue => {
  const source = (): string => interpreter.getSource(context.module, expression);
  switch (expression.type) {
    case "Literal":
      return "regex" in expression
        ? regexp(expression.regex.pattern, expression.regex.flags)
        : literal(expression.value);
    case "TemplateLiteral":
      return evaluateTemplate(interpreter, expression, context);
    case "Identifier":
      return resolveIdentifier(interpreter, expression.name, expression, context);
    case "ThisExpression":
      return context.thisValue ?? unknown("this");
    case "ArrayExpression": {
      const items: StaticValue[] = [];
      for (const element of expression.elements) {
        if (element === null) items.push(UNDEFINED);
        else if (element.type === "SpreadElement") {
          spreadInto(items, interpreter.evaluateExpression(element.argument, context));
        } else items.push(interpreter.evaluateExpression(element, context));
      }
      return array(items, getUndecidedDepth(context));
    }
    case "ObjectExpression":
      return evaluateObject(interpreter, expression, context);
    case "ArrowFunctionExpression":
    case "FunctionDeclaration":
    case "FunctionExpression":
      return createFunctionValue(expression, context);
    case "TSDeclareFunction":
    case "TSEmptyBodyFunctionExpression":
      return unknown(source());
    case "ClassDeclaration":
    case "ClassExpression":
      return classifyClass(interpreter, expression, context.module, context.scope, null, context);
    case "ConditionalExpression": {
      const test = interpreter.evaluateExpression(expression.test, context);
      const truthiness = getTruthiness(test);
      if (truthiness === true)
        return interpreter.evaluateExpression(expression.consequent, context);
      if (truthiness === false)
        return interpreter.evaluateExpression(expression.alternate, context);
      const testSource = interpreter.getSource(context.module, expression.test);
      return conditional(
        testSource,
        interpreter.evaluateExpression(
          expression.consequent,
          enterOutcome(interpreter, context, expression.test, testSource, true),
        ),
        interpreter.evaluateExpression(
          expression.alternate,
          enterOutcome(interpreter, context, expression.test, testSource, false),
        ),
      );
    }
    case "LogicalExpression":
      return evaluateLogical(interpreter, expression, context);
    case "MemberExpression":
      return evaluateMember(interpreter, expression, context);
    case "ChainExpression":
      return interpreter.evaluateExpression(expression.expression, context);
    case "CallExpression":
      return evaluateCall(interpreter, expression, context);
    case "NewExpression":
      return unknown(source());
    case "SequenceExpression": {
      let last: StaticValue = UNDEFINED;
      for (const inner of expression.expressions)
        last = interpreter.evaluateExpression(inner, context);
      return last;
    }
    case "AssignmentExpression": {
      const right = interpreter.evaluateExpression(expression.right, context);
      const value =
        expression.operator === "="
          ? right
          : evaluateCompoundAssignment(interpreter, expression, right, context);
      assignToTarget(interpreter, expression.left, value, context);
      return value;
    }
    case "UpdateExpression": {
      const current = interpreter.evaluateExpression(expression.argument, context);
      const updated =
        current.kind === "literal" && typeof current.value === "number"
          ? literal(current.value + (expression.operator === "++" ? 1 : -1))
          : unknown(source());
      assignToTarget(interpreter, expression.argument, updated, context);
      return expression.prefix ? updated : current;
    }
    case "UnaryExpression":
      return applyUnaryOperator(
        expression.operator,
        interpreter.evaluateExpression(expression.argument, context),
        source(),
      );
    case "BinaryExpression":
      if (expression.left.type === "PrivateIdentifier") return unknown(source());
      return applyBinaryOperator(
        expression.operator,
        interpreter.evaluateExpression(expression.left, context),
        interpreter.evaluateExpression(expression.right, context),
        source(),
      );
    case "AwaitExpression":
      return interpreter.evaluateExpression(expression.argument, context);
    case "TaggedTemplateExpression":
      return evaluateTaggedTemplate(interpreter, expression, context);
    case "ParenthesizedExpression":
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "TSNonNullExpression":
    case "TSTypeAssertion":
    case "TSInstantiationExpression":
      return interpreter.evaluateExpression(expression.expression, context);
    case "ImportExpression": {
      if (!isStringLiteral(expression.source)) return unknown(source());
      const module = interpreter.linker.resolveImportedModule(
        context.module,
        expression.source.value,
      );
      if (module) return { kind: "namespace", module };
      return normalizeExternal({
        kind: "external",
        specifier: expression.source.value,
        packageName: null,
        importedName: "*",
        memberPath: [],
        name: null,
      });
    }
    case "JSXElement":
      return evaluateJsxElement(interpreter, expression, context);
    case "JSXFragment":
      return evaluateJsxFragment(interpreter, expression, context);
    case "YieldExpression":
    case "MetaProperty":
    case "Super":
    case "V8IntrinsicExpression":
      return unknown(source());
  }
};
