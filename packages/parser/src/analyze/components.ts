import type { Class, Span } from "@oxc-project/types";
import { getReactApiReference, REACT_BASE_CLASSES } from "../link/react-api.js";
import { type FunctionLike, isFunctionLike } from "../module/ast.js";
import type { ParsedModule } from "../module/types.js";
import { readContext } from "./contexts.js";
import type { EvaluationContext, Interpreter } from "./interpreter.js";
import { getPropertyKeyName } from "./patterns.js";
import { createScope, type Scope } from "./scope.js";
import {
  type ClassComponentDefinition,
  type ClassMember,
  component,
  type FunctionValue,
  NULL,
  object,
  type ObjectValue,
  type StaticValue,
  UNDEFINED,
  unknown,
} from "./values.js";

/** A class before it is known to be a component: its members and what it extends. */
export interface ClassSource {
  name: string | null;
  module: ParsedModule;
  scope: Scope;
  members: ClassMember[];
  superValue: StaticValue;
  span: Span;
}

/** The members of class syntax, with computed keys resolved in the class's scope. */
const collectClassMembers = (
  interpreter: Interpreter,
  classNode: Class,
  context: EvaluationContext,
): ClassMember[] => {
  const members: ClassMember[] = [];
  for (const element of classNode.body.body) {
    if (element.type !== "MethodDefinition" && element.type !== "PropertyDefinition") continue;
    const key = getPropertyKeyName(interpreter, element.key, element.computed, context);
    if (key === null) continue;
    if (!("kind" in element)) {
      members.push({ key, isStatic: element.static, kind: "field", value: element.value });
    } else if (element.kind !== "set") {
      const kind = element.kind === "get" ? "getter" : element.kind;
      members.push({ key, isStatic: element.static, kind, fn: element.value });
    }
  }
  return members;
};

const hasErrorBoundaryMembers = (members: ClassMember[]): boolean =>
  members.some(
    (member) =>
      (member.key === "componentDidCatch" && !member.isStatic) ||
      (member.key === "getDerivedStateFromError" && member.isStatic),
  );

const getStaticProperty = (
  interpreter: Interpreter,
  members: ClassMember[],
  name: string,
  context: EvaluationContext,
): StaticValue | null => {
  for (const member of members) {
    if (!member.isStatic || member.key !== name || member.kind !== "field" || !member.value)
      continue;
    return interpreter.evaluateExpression(member.value, context);
  }
  return null;
};

/**
 * Defines a class as a React class component when it extends
 * `React.Component`/`PureComponent`, another class component, or at least
 * defines `render()` under an unresolved base class.
 */
export const defineClassComponent = (
  interpreter: Interpreter,
  source: ClassSource,
  context: EvaluationContext,
): StaticValue => {
  const { superValue, members } = source;
  const reactApi = superValue.kind === "external" ? getReactApiReference(superValue) : null;
  const extendsReactComponent = reactApi !== null && REACT_BASE_CLASSES.has(reactApi.api);
  const base =
    superValue.kind === "component" && superValue.definition.kind === "class"
      ? superValue.definition
      : null;
  const hasRender = members.some((member) => member.key === "render" && !member.isStatic);
  if (!extendsReactComponent && !base && !hasRender) {
    return unknown(`class ${source.name ?? "anonymous"}`);
  }
  const defaultProps = getStaticProperty(interpreter, members, "defaultProps", context);
  const displayName = getStaticProperty(interpreter, members, "displayName", context);
  return component({
    kind: "class",
    name:
      displayName?.kind === "literal" && typeof displayName.value === "string"
        ? displayName.value
        : source.name,
    module: source.module,
    members,
    scope: source.scope,
    base,
    defaultProps: defaultProps?.kind === "object" ? defaultProps : (base?.defaultProps ?? null),
    contextType:
      getStaticProperty(interpreter, members, "contextType", context) ?? base?.contextType ?? null,
    isErrorBoundary: hasErrorBoundaryMembers(members) || (base?.isErrorBoundary ?? false),
    span: source.span,
  });
};

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
  return defineClassComponent(
    interpreter,
    {
      name,
      module,
      scope,
      members: collectClassMembers(interpreter, classNode, context),
      superValue: interpreter.evaluateExpression(classNode.superClass, context),
      span: { start: classNode.start, end: classNode.end },
    },
    context,
  );
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
  const asMethod = (fn: FunctionLike, name: string): FunctionValue => ({
    kind: "function",
    fn,
    module: definition.module,
    scope: definition.scope,
    thisValue: instance,
    name,
    statics: new Map(),
  });
  for (const member of definition.members) {
    if (member.isStatic) continue;
    switch (member.kind) {
      case "constructor":
        members.constructorMethod = asMethod(member.fn, "constructor");
        break;
      case "getter":
        instance.properties.set(
          member.key,
          interpreter.callFunction(asMethod(member.fn, member.key), [], instanceContext),
        );
        break;
      case "method":
        instance.properties.set(member.key, asMethod(member.fn, member.key));
        break;
      case "field":
        instance.properties.set(
          member.key,
          member.value === null
            ? UNDEFINED
            : isFunctionLike(member.value)
              ? asMethod(member.value, member.key)
              : interpreter.evaluateExpression(member.value, instanceContext),
        );
        break;
    }
  }
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
