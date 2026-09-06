import type { Class, ClassElement } from "@oxc-project/types";
import { getReactApiReference } from "../link/react-api.js";
import { getClassMember, isFunctionLike } from "../module/ast.js";
import type { ParsedModule } from "../module/types.js";
import { readContext } from "./contexts.js";
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

const getStaticProperty = (
  interpreter: Interpreter,
  classNode: Class,
  name: string,
  context: EvaluationContext,
): StaticValue | null => {
  for (const element of classNode.body.body) {
    if (element.type !== "PropertyDefinition" || !element.static || !element.value) continue;
    if (getPropertyKeyName(interpreter, element.key, element.computed, context) !== name) continue;
    return interpreter.evaluateExpression(element.value, context);
  }
  return null;
};

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
  const base =
    superValue.kind === "component" && superValue.definition.kind === "class"
      ? superValue.definition
      : null;
  const hasRender = getClassMember(classNode, "render") !== null;
  if (!extendsReactComponent && !base && !hasRender) {
    return unknown(`class ${name ?? "anonymous"}`);
  }
  const defaultProps = getStaticProperty(interpreter, classNode, "defaultProps", context);
  return component({
    kind: "class",
    name,
    module,
    classNode,
    scope,
    base,
    defaultProps: defaultProps?.kind === "object" ? defaultProps : (base?.defaultProps ?? null),
    contextType:
      getStaticProperty(interpreter, classNode, "contextType", context) ??
      base?.contextType ??
      null,
    isErrorBoundary: hasErrorBoundaryMembers(classNode) || (base?.isErrorBoundary ?? false),
    span: { start: classNode.start, end: classNode.end },
  });
};

/** `resolveClassComponentProps`: `defaultProps` fill in props that are `undefined`. */
export const resolveClassProps = (
  definition: ClassComponentDefinition,
  props: ObjectValue,
): ObjectValue => {
  if (!definition.defaultProps) return props;
  const resolved = object(props.properties, props.hasUnknownSpread, props.depth);
  for (const [key, defaultValue] of definition.defaultProps.properties) {
    const given = resolved.properties.get(key);
    if (given === undefined || (given.kind === "literal" && given.value === undefined)) {
      resolved.properties.set(key, defaultValue);
    }
  }
  return resolved;
};

/** State is observed after updates, so its keys are kept and its values forgotten. */
const forgetStateValues = (state: StaticValue): StaticValue => {
  if (state.kind !== "object") return state.kind === "literal" ? state : unknown("this.state");
  return object(
    [...state.properties.keys()].map((key) => [key, unknown(`this.state.${key}`)]),
    true,
  );
};

/** The class chain from the outermost base to the class itself. */
const getClassChain = (definition: ClassComponentDefinition): ClassComponentDefinition[] =>
  definition.base ? [...getClassChain(definition.base), definition] : [definition];

interface InstanceMembers {
  constructorMethod: FunctionValue | null;
}

const installMembers = (
  interpreter: Interpreter,
  definition: ClassComponentDefinition,
  instance: ObjectValue,
  members: InstanceMembers,
  context: EvaluationContext,
): void => {
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
  const install = (element: ClassElement): void => {
    if (element.type !== "MethodDefinition" && element.type !== "PropertyDefinition") return;
    if (element.static) return;
    const key = getPropertyKeyName(interpreter, element.key, element.computed, instanceContext);
    if (key === null) return;
    if (element.type === "MethodDefinition") {
      if (element.kind === "constructor")
        members.constructorMethod = asMethod(element.value, "constructor");
      else if (element.kind === "get") {
        instance.properties.set(
          key,
          interpreter.callFunction(asMethod(element.value, key), [], instanceContext),
        );
      } else if (element.kind === "method")
        instance.properties.set(key, asMethod(element.value, key));
      return;
    }
    if (!element.value) {
      instance.properties.set(key, UNDEFINED);
      return;
    }
    const value = isFunctionLike(element.value)
      ? asMethod(element.value, key)
      : interpreter.evaluateExpression(element.value, instanceContext);
    instance.properties.set(key, value);
  };
  for (const element of definition.classNode.body.body) install(element);
};

/**
 * Builds the `this` an instance of a class component observes during
 * `render()`: props, fields and methods from the base classes down, then
 * whatever the most derived constructor assigned.
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
    [
      "context",
      definition.contextType ? readContext(context.contexts, definition.contextType) : UNDEFINED,
    ],
    ["setState", unknown("this.setState")],
    ["forceUpdate", unknown("this.forceUpdate")],
    ["refs", unknown("this.refs")],
  ]);
  const members: InstanceMembers = { constructorMethod: null };
  for (const ancestor of getClassChain(definition))
    installMembers(interpreter, ancestor, instance, members, context);
  if (members.constructorMethod) {
    const constructorContext: EvaluationContext = {
      ...context,
      module: members.constructorMethod.module,
      scope: createScope(members.constructorMethod.scope),
      thisValue: instance,
      hooks: null,
    };
    interpreter.callFunction(members.constructorMethod, [props], constructorContext);
  }
  const state = instance.properties.get("state");
  if (state) instance.properties.set("state", forgetStateValues(state));
  const render = instance.properties.get("render");
  return { instance, render: render?.kind === "function" ? render : null };
};
