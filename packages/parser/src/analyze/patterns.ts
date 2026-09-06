import type {
  AssignmentTarget,
  BindingPattern,
  Expression,
  ParamPattern,
  PropertyKey,
} from "@oxc-project/types";
import { isStringLiteral, unwrapExpression } from "../module/ast.js";
import { forgetArrayItems, getIndex, getProperty } from "./access.js";
import { type EvaluationContext, type Interpreter, isEffectUndecided } from "./interpreter.js";
import { assignVariable, declareVariable } from "./scope.js";
import {
  array,
  type ArrayValue,
  assignStatic,
  cloneObject,
  conditional,
  list,
  type ObjectValue,
  type StaticValue,
  UNDEFINED,
  unknown,
} from "./values.js";

export type BindingMode = "declare" | "assign";

const isUndefinedLiteral = (value: StaticValue): boolean =>
  value.kind === "literal" && value.value === undefined;

/** Resolves a property key to a string, or `null` when it is only known at runtime. */
export const getPropertyKeyName = (
  interpreter: Interpreter,
  key: PropertyKey,
  isComputed: boolean,
  context: EvaluationContext,
): string | null => {
  if (key.type === "PrivateIdentifier") return `#${key.name}`;
  if (!isComputed) {
    if (key.type === "Identifier") return key.name;
    if (isStringLiteral(key)) return key.value;
    if (key.type === "Literal" && typeof key.value === "number") return String(key.value);
    return null;
  }
  const evaluated = interpreter.evaluateExpression(key, context);
  if (evaluated.kind !== "literal") return null;
  return typeof evaluated.value === "string" || typeof evaluated.value === "number"
    ? String(evaluated.value)
    : null;
};

const applyDefault = (
  interpreter: Interpreter,
  value: StaticValue,
  defaultExpression: Expression,
  context: EvaluationContext,
): StaticValue =>
  isUndefinedLiteral(value) ? interpreter.evaluateExpression(defaultExpression, context) : value;

const restOfObject = (value: StaticValue, consumedKeys: string[]): StaticValue => {
  if (value.kind !== "object") return unknown(`rest of ${value.kind}`);
  const rest = cloneObject(value);
  for (const key of consumedKeys) rest.properties.delete(key);
  return rest;
};

const restOfArray = (value: StaticValue, start: number): StaticValue => {
  if (value.kind === "list") return value;
  if (value.kind !== "array") return unknown(`rest of ${value.kind}`);
  const isOffsetKnown = value.items.slice(0, start).every((item) => item.kind !== "optional");
  return isOffsetKnown ? array(value.items.slice(start)) : list(unknown("rest item"), "array rest");
};

/**
 * Binds a destructuring pattern against a value, declaring (or assigning)
 * every name it introduces. Defaults apply only when the incoming value is
 * statically `undefined`; unknown values stay unknown.
 */
export const bindPattern = (
  interpreter: Interpreter,
  pattern: BindingPattern,
  value: StaticValue,
  context: EvaluationContext,
  mode: BindingMode = "declare",
): void => {
  switch (pattern.type) {
    case "Identifier":
      if (mode === "declare") declareVariable(context.scope, pattern.name, value);
      else assignVariable(context.scope, pattern.name, value);
      return;
    case "AssignmentPattern":
      bindPattern(
        interpreter,
        pattern.left,
        applyDefault(interpreter, value, pattern.right, context),
        context,
        mode,
      );
      return;
    case "ObjectPattern": {
      const consumedKeys: string[] = [];
      for (const property of pattern.properties) {
        if (property.type === "RestElement") {
          bindPattern(
            interpreter,
            property.argument,
            restOfObject(value, consumedKeys),
            context,
            mode,
          );
          continue;
        }
        const keyName = getPropertyKeyName(interpreter, property.key, property.computed, context);
        if (keyName !== null) consumedKeys.push(keyName);
        const propertyValue =
          keyName === null
            ? unknown("computed destructuring key")
            : getProperty(interpreter, value, keyName);
        bindPattern(interpreter, property.value, propertyValue, context, mode);
      }
      return;
    }
    case "ArrayPattern":
      pattern.elements.forEach((element, index) => {
        if (!element) return;
        if (element.type === "RestElement") {
          bindPattern(interpreter, element.argument, restOfArray(value, index), context, mode);
          return;
        }
        bindPattern(
          interpreter,
          element,
          getProperty(interpreter, value, String(index)),
          context,
          mode,
        );
      });
      return;
  }
};

export const bindParameters = (
  interpreter: Interpreter,
  parameters: ParamPattern[],
  callArguments: StaticValue[],
  context: EvaluationContext,
): void => {
  parameters.forEach((parameter, index) => {
    if (parameter.type === "RestElement") {
      bindPattern(interpreter, parameter.argument, array(callArguments.slice(index)), context);
      return;
    }
    const pattern = parameter.type === "TSParameterProperty" ? parameter.parameter : parameter;
    bindPattern(interpreter, pattern, callArguments[index] ?? UNDEFINED, context);
  });
};

/**
 * Assigns to an assignment target (`x = …`, `obj.prop = …`, `[a, b] = …`).
 * Member writes mutate object values in place so constructor-style
 * `this.state = {…}` and `styles.header = …` are observed by later reads.
 */
const writeProperty = (
  target: ObjectValue | ArrayValue,
  keyName: string,
  value: StaticValue,
  context: EvaluationContext,
): void => {
  const undecided = context.undecided;
  const previous = target.properties.get(keyName) ?? UNDEFINED;
  target.properties.set(
    keyName,
    undecided && isEffectUndecided(context, target.depth)
      ? conditional(undecided.test, value, previous)
      : value,
  );
};

const assignObjectProperty = (
  target: ObjectValue,
  keyName: string | null,
  value: StaticValue,
  context: EvaluationContext,
): void => {
  if (keyName === null) target.hasUnknownSpread = true;
  else writeProperty(target, keyName, value, context);
};

/**
 * `Wrapped.displayName = "…"` inside a factory renames the value every
 * holder sees, as the runtime assignment does to the function object.
 */
/** Writes an item, a named member (`result.ref = …`), or forgets the items when the write cannot be placed. */
const assignArrayItem = (
  target: ArrayValue,
  keyName: string | null,
  value: StaticValue,
  description: string,
  context: EvaluationContext,
): void => {
  const index = keyName === null ? null : getIndex(keyName);
  if (keyName !== null && index === null && keyName !== "length") {
    writeProperty(target, keyName, value, context);
    return;
  }
  if (index === null || isEffectUndecided(context, target.depth)) {
    forgetArrayItems(target, description);
    return;
  }
  while (target.items.length < index) target.items.push(UNDEFINED);
  target.items[index] = value;
};

export const assignToTarget = (
  interpreter: Interpreter,
  target: AssignmentTarget,
  value: StaticValue,
  context: EvaluationContext,
): void => {
  switch (target.type) {
    case "Identifier":
      assignVariable(context.scope, target.name, value);
      return;
    case "MemberExpression": {
      const objectValue = interpreter.evaluateExpression(target.object, context);
      const keyName = getPropertyKeyName(interpreter, target.property, target.computed, context);
      if (objectValue.kind === "array") {
        assignArrayItem(
          objectValue,
          keyName,
          value,
          interpreter.getSource(context.module, target),
          context,
        );
      } else if (objectValue.kind === "object") {
        assignObjectProperty(objectValue, keyName, value, context);
      } else if (keyName !== null) {
        assignStatic(objectValue, keyName, value);
      }
      return;
    }
    case "ArrayPattern":
      target.elements.forEach((element, index) => {
        if (!element) return;
        const itemValue = getProperty(interpreter, value, String(index));
        if (element.type === "RestElement") {
          assignToTarget(interpreter, element.argument, restOfArray(value, index), context);
        } else if (element.type === "AssignmentPattern") {
          const withDefault = applyDefault(interpreter, itemValue, element.right, context);
          assignToTarget(interpreter, element.left, withDefault, context);
        } else {
          assignToTarget(interpreter, element, itemValue, context);
        }
      });
      return;
    case "ObjectPattern": {
      const consumedKeys: string[] = [];
      for (const property of target.properties) {
        if (property.type === "RestElement") {
          assignToTarget(
            interpreter,
            property.argument,
            restOfObject(value, consumedKeys),
            context,
          );
          continue;
        }
        const keyName = getPropertyKeyName(interpreter, property.key, property.computed, context);
        if (keyName !== null) consumedKeys.push(keyName);
        const propertyValue =
          keyName === null
            ? unknown("computed destructuring key")
            : getProperty(interpreter, value, keyName);
        if (property.value.type === "AssignmentPattern") {
          const withDefault = applyDefault(
            interpreter,
            propertyValue,
            property.value.right,
            context,
          );
          assignToTarget(interpreter, property.value.left, withDefault, context);
        } else {
          assignToTarget(interpreter, property.value, propertyValue, context);
        }
      }
      return;
    }
    default: {
      const inner = unwrapExpression(target.expression);
      if (inner.type === "Identifier" || inner.type === "MemberExpression") {
        assignToTarget(interpreter, inner, value, context);
      }
    }
  }
};
