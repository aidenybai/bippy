import type { Class, ClassElement, Node } from "oxc-parser";
import { someNode } from "../parse/ast-walk.js";
import type {
  ClassBody,
  ClassMember,
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
  NULL_VALUE,
  objectFromRecord,
  objectValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

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

export const collectClassMembers = (node: Class): ClassMember[] => {
  const members: ClassMember[] = [];
  for (const element of node.body.body) {
    const key = getElementName(element);
    if (key === null) continue;
    if (element.type === "MethodDefinition" || element.type === "TSAbstractMethodDefinition") {
      if (element.kind === "set") continue;
      const kind = element.kind === "get" ? "getter" : element.kind;
      members.push({ key, isStatic: element.static, kind, fn: element.value });
    } else if (
      element.type === "PropertyDefinition" ||
      element.type === "TSAbstractPropertyDefinition"
    ) {
      members.push({ key, isStatic: element.static, kind: "field", value: element.value });
    }
  }
  return members;
};

const memberNode = (member: ClassMember): Node | null =>
  member.kind === "field" ? member.value : member.fn;

/**
 * A class whose body never calls `this.setState` (or derives state from props)
 * renders with exactly the state its constructor/fields produced.
 */
const mayUpdateState = (chain: StaticClassValue[]): boolean =>
  chain.some((current) =>
    current.body.members.some((member) => {
      if (member.isStatic) return member.key === "getDerivedStateFromProps";
      const node = memberNode(member);
      return (
        node !== null &&
        someNode(
          node,
          (candidate) =>
            candidate.type === "MemberExpression" &&
            candidate.object.type === "ThisExpression" &&
            candidate.property.type === "Identifier" &&
            (candidate.property.name === "setState" || candidate.property.name === "forceUpdate"),
        )
      );
    }),
  );

export const isErrorBoundaryClass = (body: ClassBody): boolean =>
  body.members.some(
    (member) =>
      (member.key === "getDerivedStateFromError" && member.isStatic) ||
      (member.key === "componentDidCatch" && !member.isStatic),
  ) ||
  (body.superValue?.kind === "class" && isErrorBoundaryClass(body.superValue.body));

const collectClassChain = (classValue: StaticClassValue): StaticClassValue[] => {
  const chain: StaticClassValue[] = [classValue];
  let current: StaticClassValue = classValue;
  while (chain.length < MAX_INHERITANCE_DEPTH) {
    const superValue = current.body.superValue;
    if (superValue?.kind !== "class" || chain.includes(superValue)) break;
    chain.push(superValue);
    current = superValue;
  }
  return chain;
};

interface InstanceMembers {
  constructor: StaticFunctionValue | null;
  fields: ClassMember[];
  getters: Array<{ key: string; fn: StaticFunctionValue }>;
}

const bindMethods = (
  interpreter: Interpreter,
  classValue: StaticClassValue,
  instance: StaticObjectValue,
  methodContext: EvaluationContext,
  seen: Set<string>,
): InstanceMembers => {
  const members: InstanceMembers = { constructor: null, fields: [], getters: [] };
  for (const member of classValue.body.members) {
    if (member.isStatic) continue;
    if (member.kind === "constructor") {
      const fn = interpreter.createFunctionValue(member.fn, methodContext, "constructor");
      if (fn.kind === "function") members.constructor = fn;
      continue;
    }
    if (seen.has(member.key)) continue;
    seen.add(member.key);
    if (member.kind === "field") {
      members.fields.push(member);
      continue;
    }
    const fn = interpreter.createFunctionValue(member.fn, methodContext, member.key);
    if (fn.kind !== "function") continue;
    const bound: StaticFunctionValue = { ...fn, thisValue: instance };
    if (member.kind === "getter") members.getters.push({ key: member.key, fn: bound });
    else instance.entries.push({ kind: "property", key: member.key, value: bound });
  }
  return members;
};

const caughtErrorValue = (): StaticValue =>
  objectFromRecord({
    name: unknownPrimitiveValue("string", "caught error name"),
    message: unknownPrimitiveValue("string", "caught error message"),
    stack: unknownPrimitiveValue("string", "caught error stack"),
  });

/**
 * `static getDerivedStateFromError(error)` from the nearest class in the chain
 * that defines it; null when the boundary only has `componentDidCatch`.
 */
const deriveStateFromError = (
  interpreter: Interpreter,
  chain: StaticClassValue[],
  context: EvaluationContext,
): StaticValue | null => {
  for (const current of chain) {
    const derive = current.properties.get("getDerivedStateFromError");
    if (derive?.kind === "function") {
      return interpreter.callFunction(derive, [caughtErrorValue()], context, {
        thisValue: current,
      });
    }
  }
  return null;
};

/**
 * Builds the `this` a class component instance observes in `render()`: props,
 * fields and methods from the base classes down, then whatever the constructors
 * assigned. With `caughtError` the instance renders as React re-renders an
 * error boundary: with `getDerivedStateFromError` merged into state, or with
 * null children when the class only defines `componentDidCatch`
 * (`finishClassComponent`).
 */
export const renderClassComponent = (
  interpreter: Interpreter,
  classValue: StaticClassValue,
  props: StaticValue,
  context: EvaluationContext,
  caughtError = false,
): StaticValue => {
  const instance = objectFromRecord({
    props,
    state: UNDEFINED_VALUE,
    context: unknownValue("legacy class context"),
    refs: objectFromRecord({}),
  });
  const chain = collectClassChain(classValue);
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
      members: bindMethods(interpreter, current, instance, methodContext, seen),
    };
  });
  for (const { current, methodContext, members } of [...perClass].reverse()) {
    for (const field of members.fields) {
      const fieldContext: EvaluationContext = {
        ...methodContext,
        scope: createScope(current.scope),
        thisValue: instance,
      };
      const value =
        field.kind === "field" && field.value
          ? interpreter.evaluateExpression(field.value, fieldContext, field.key)
          : UNDEFINED_VALUE;
      instance.entries.push({ kind: "property", key: field.key, value });
    }
    if (members.constructor) {
      interpreter.callFunction(members.constructor, [props], methodContext, {
        thisValue: instance,
      });
    }
  }
  for (const { methodContext, members } of perClass) {
    for (const getter of members.getters) {
      instance.entries.push({
        kind: "property",
        key: getter.key,
        value: interpreter.callFunction(getter.fn, [], methodContext, { thisValue: instance }),
      });
    }
  }
  if (caughtError) {
    const derived = deriveStateFromError(interpreter, chain, context);
    if (!derived) return NULL_VALUE;
    instance.entries.push({
      kind: "property",
      key: "state",
      value: objectValue([
        { kind: "spread", value: getObjectProperty(instance, "state") },
        { kind: "spread", value: derived },
      ]),
    });
  } else if (mayUpdateState(chain)) {
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
