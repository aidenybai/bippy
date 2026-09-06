import type { Class, ClassElement } from "oxc-parser";
import { someNode } from "../parse/ast-walk.js";
import type {
  StaticClassValue,
  StaticFunctionValue,
  StaticObjectValue,
  StaticValue,
} from "../types.js";
import type { EvaluationContext } from "./context.js";
import type { Interpreter } from "./interpreter.js";
import { createScope } from "./scope.js";
import {
  branchValue,
  getObjectProperty,
  objectFromRecord,
  UNDEFINED_VALUE,
  unknownValue,
} from "./values.js";

/**
 * A class whose body never calls `this.setState` (or derives state from props)
 * renders with exactly the state its constructor/fields produced.
 */
const mayUpdateState = (chain: StaticClassValue[]): boolean =>
  chain.some((current) =>
    someNode(current.node, (node) => {
      if (node.type === "MemberExpression") {
        return (
          node.object.type === "ThisExpression" &&
          node.property.type === "Identifier" &&
          (node.property.name === "setState" || node.property.name === "forceUpdate")
        );
      }
      return (
        node.type === "MethodDefinition" &&
        node.static &&
        node.key.type === "Identifier" &&
        node.key.name === "getDerivedStateFromProps"
      );
    }),
  );

const MAX_INHERITANCE_DEPTH = 8;

const getElementName = (element: ClassElement): string | null => {
  if (element.type === "StaticBlock" || element.type === "TSIndexSignature") return null;
  if (element.computed) return null;
  const key = element.key;
  if (key.type === "Identifier") return key.name;
  if (key.type === "PrivateIdentifier") return `#${key.name}`;
  if (key.type === "Literal") return String(key.value);
  return null;
};

const collectClassChain = (
  interpreter: Interpreter,
  classValue: StaticClassValue,
  context: EvaluationContext,
): StaticClassValue[] => {
  const chain: StaticClassValue[] = [classValue];
  let current: StaticClassValue = classValue;
  while (chain.length < MAX_INHERITANCE_DEPTH && current.node.superClass) {
    const superValue = interpreter.evaluateExpression(current.node.superClass, {
      ...context,
      module: current.module,
      scope: current.scope,
    });
    if (superValue.kind !== "class" || chain.includes(superValue)) break;
    chain.push(superValue);
    current = superValue;
  }
  return chain;
};

const bindMethods = (
  interpreter: Interpreter,
  classValue: StaticClassValue,
  instance: StaticObjectValue,
  methodContext: EvaluationContext,
  seen: Set<string>,
): {
  constructor: StaticFunctionValue | null;
  fields: Array<{ name: string; node: Class["body"]["body"][number] }>;
} => {
  let constructor: StaticFunctionValue | null = null;
  const fields: Array<{ name: string; node: Class["body"]["body"][number] }> = [];
  for (const element of classValue.node.body.body) {
    if (element.type === "StaticBlock" || element.type === "TSIndexSignature") continue;
    if (element.static) continue;
    const name = getElementName(element);
    if (!name) continue;
    if (element.type === "MethodDefinition" || element.type === "TSAbstractMethodDefinition") {
      if (element.kind === "constructor") {
        const fn = interpreter.createFunctionValue(element.value, methodContext, "constructor");
        if (fn.kind === "function") constructor = fn;
        continue;
      }
      if (element.kind !== "method" || seen.has(name)) continue;
      seen.add(name);
      const fn = interpreter.createFunctionValue(element.value, methodContext, name);
      if (fn.kind === "function")
        instance.entries.push({
          kind: "property",
          key: name,
          value: { ...fn, thisValue: instance },
        });
      continue;
    }
    if (element.type === "PropertyDefinition" || element.type === "TSAbstractPropertyDefinition") {
      if (seen.has(name)) continue;
      seen.add(name);
      fields.push({ name, node: element });
    }
  }
  return { constructor, fields };
};

export const renderClassComponent = (
  interpreter: Interpreter,
  classValue: StaticClassValue,
  props: StaticValue,
  context: EvaluationContext,
): StaticValue => {
  const instance = objectFromRecord({
    props,
    state: UNDEFINED_VALUE,
    context: unknownValue("legacy class context"),
    refs: objectFromRecord({}),
  });
  const chain = collectClassChain(interpreter, classValue, context);
  const seen = new Set<string>();
  const perClass = chain.map((current) => {
    const methodContext: EvaluationContext = {
      ...context,
      module: current.module,
      scope: current.scope,
      thisValue: instance,
    };
    return {
      current,
      methodContext,
      ...bindMethods(interpreter, current, instance, methodContext, seen),
    };
  });
  for (const { current, methodContext, fields, constructor } of [...perClass].reverse()) {
    for (const { name, node } of fields) {
      if (node.type !== "PropertyDefinition" && node.type !== "TSAbstractPropertyDefinition")
        continue;
      const fieldContext: EvaluationContext = {
        ...methodContext,
        scope: createScope(current.scope),
        thisValue: instance,
      };
      const value = node.value
        ? interpreter.evaluateExpression(node.value, fieldContext, name)
        : UNDEFINED_VALUE;
      instance.entries.push({ kind: "property", key: name, value });
    }
    if (constructor) {
      interpreter.callFunction(constructor, [props], methodContext, { thisValue: instance });
    }
  }
  if (mayUpdateState(chain)) {
    instance.entries.push({
      kind: "property",
      key: "state",
      value: branchValue(
        [
          getObjectProperty(instance, "state"),
          unknownValue(`updated state of ${classValue.name ?? "class component"}`),
        ],
        "class state may change after mount",
        null,
      ),
    });
  }
  const render = getObjectProperty(instance, "render");
  if (render.kind !== "function") {
    return unknownValue(`class ${classValue.name ?? "component"} has no static render method`);
  }
  return interpreter.callFunction(render, [], context, { thisValue: instance });
};
