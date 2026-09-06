import type { Class } from "@oxc-project/types";
import { getReactApiReference } from "../link/react-api.js";
import { getClassMember, isFunctionLike } from "../module/ast.js";
import type { ParsedModule } from "../module/types.js";
import type { EvaluationContext, Interpreter } from "./interpreter.js";
import { getPropertyKeyName } from "./patterns.js";
import { createScope, type Scope } from "./scope.js";
import {
  type ClassComponentDefinition,
  component,
  type FunctionValue,
  NULL,
  object,
  type ObjectValue,
  type StaticValue,
  UNDEFINED,
  unknown,
} from "./values.js";

const REACT_BASE_CLASSES = new Set(["Component", "PureComponent"]);

const hasErrorBoundaryMembers = (classNode: Class): boolean =>
  classNode.body.body.some(
    (element) =>
      (element.type === "MethodDefinition" || element.type === "PropertyDefinition") &&
      element.key.type === "Identifier" &&
      ((element.key.name === "componentDidCatch" && !element.static) ||
        (element.key.name === "getDerivedStateFromError" && element.static)),
  );

/**
 * Classifies a class as a React class component when it extends
 * `React.Component`/`PureComponent`, another class component, or at least
 * defines `render()` under an unresolved base class.
 */
export const classifyClass = (
  interpreter: Interpreter,
  classNode: Class,
  module: ParsedModule,
  scope: Scope,
  nameHint: string | null,
  context: EvaluationContext,
): StaticValue => {
  const name = classNode.id?.name ?? nameHint;
  if (!classNode.superClass) return unknown(`class ${name ?? "anonymous"}`);
  const superValue = interpreter.evaluateExpression(classNode.superClass, context);
  const reactApi = superValue.kind === "external" ? getReactApiReference(superValue) : null;
  const extendsReactComponent = reactApi !== null && REACT_BASE_CLASSES.has(reactApi.api);
  const extendsClassComponent =
    superValue.kind === "component" && superValue.definition.kind === "class";
  const hasRender = getClassMember(classNode, "render") !== null;
  if (!extendsReactComponent && !extendsClassComponent && !hasRender) {
    return unknown(`class ${name ?? "anonymous"}`);
  }
  return component({
    kind: "class",
    name,
    module,
    classNode,
    scope,
    isErrorBoundary: hasErrorBoundaryMembers(classNode),
    span: { start: classNode.start, end: classNode.end },
  });
};

/** State is observed after updates, so its keys are kept and its values forgotten. */
const forgetStateValues = (state: StaticValue): StaticValue => {
  if (state.kind !== "object") return state.kind === "literal" ? state : unknown("this.state");
  return object(
    [...state.properties.keys()].map((key) => [key, unknown(`this.state.${key}`)]),
    true,
  );
};

/**
 * Builds the `this` an instance of a class component observes during
 * `render()`: props, fields, methods bound to the instance, then whatever
 * the constructor assigned.
 */
export const instantiateClassComponent = (
  interpreter: Interpreter,
  definition: ClassComponentDefinition,
  props: ObjectValue,
  context: EvaluationContext,
): { instance: ObjectValue; render: FunctionValue | null } => {
  const instance = object([
    ["props", props],
    ["state", NULL],
    ["context", unknown("legacy context")],
    ["setState", unknown("this.setState")],
    ["forceUpdate", unknown("this.forceUpdate")],
    ["refs", unknown("this.refs")],
  ]);
  const instanceContext: EvaluationContext = {
    ...context,
    module: definition.module,
    scope: createScope(definition.scope),
    thisValue: instance,
    hooks: null,
  };
  const asMethod = (fn: FunctionValue["fn"], name: string): FunctionValue => ({
    kind: "function",
    fn,
    module: definition.module,
    scope: definition.scope,
    thisValue: instance,
    name,
  });
  let constructorMethod: FunctionValue | null = null;
  for (const element of definition.classNode.body.body) {
    if (element.type !== "MethodDefinition" && element.type !== "PropertyDefinition") continue;
    if (element.static) continue;
    const key = getPropertyKeyName(interpreter, element.key, element.computed, instanceContext);
    if (key === null) continue;
    if (element.type === "MethodDefinition") {
      if (element.kind === "constructor") constructorMethod = asMethod(element.value, "constructor");
      else if (element.kind === "get") {
        instance.properties.set(key, interpreter.callFunction(asMethod(element.value, key), [], instanceContext));
      } else if (element.kind === "method") instance.properties.set(key, asMethod(element.value, key));
      continue;
    }
    if (!element.value) {
      instance.properties.set(key, UNDEFINED);
      continue;
    }
    const value = isFunctionLike(element.value)
      ? asMethod(element.value, key)
      : interpreter.evaluateExpression(element.value, instanceContext);
    instance.properties.set(key, value);
  }
  if (constructorMethod) interpreter.callFunction(constructorMethod, [props], instanceContext);
  const state = instance.properties.get("state");
  if (state) instance.properties.set("state", forgetStateValues(state));
  const render = instance.properties.get("render");
  return { instance, render: render?.kind === "function" ? render : null };
};
