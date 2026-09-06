import type { Span } from "@oxc-project/types";
import { getReactApiReference } from "../link/react-api.js";
import type { EvaluationContext, Interpreter } from "./interpreter.js";
import { createElementValue } from "./jsx.js";
import {
  array,
  builtin,
  cloneObject,
  component,
  type ExternalValue,
  FALSE,
  list,
  literal,
  mergeObjects,
  NULL,
  object,
  type ObjectValue,
  type StaticValue,
  TRUE,
  UNDEFINED,
  unknown,
} from "./values.js";

export type CallbackInvoker = (callback: StaticValue, callArguments: StaticValue[]) => StaticValue;

const isNullish = (value: StaticValue | undefined): boolean =>
  value === undefined || (value.kind === "literal" && value.value == null);

const childrenProp = (children: StaticValue[]): StaticValue | null => {
  if (children.length === 0) return null;
  return children.length === 1 ? children[0] : array(children);
};

/** `createElement(type, config, ...children)`: config minus `key`/`ref`, children appended. */
const createElementFromCall = (
  interpreter: Interpreter,
  callArguments: StaticValue[],
  span: Span,
  context: EvaluationContext,
): StaticValue => {
  const [type, config, ...children] = callArguments;
  if (!type) return unknown("createElement without type");
  const props: ObjectValue = config?.kind === "object" ? cloneObject(config) : object();
  if (config && config.kind !== "object" && !isNullish(config)) props.hasUnknownSpread = true;
  const key = props.properties.get("key") ?? null;
  props.properties.delete("key");
  const childrenValue = childrenProp(children);
  if (childrenValue) props.properties.set("children", childrenValue);
  return createElementValue(interpreter, type, props, key, span, context);
};

/** `jsx(type, props, key)` from the automatic runtime: children already live in props. */
const createElementFromJsxRuntime = (
  interpreter: Interpreter,
  callArguments: StaticValue[],
  span: Span,
  context: EvaluationContext,
): StaticValue => {
  const [type, config, key] = callArguments;
  if (!type) return unknown("jsx without type");
  const props = config?.kind === "object" ? cloneObject(config) : object([], config !== undefined);
  return createElementValue(interpreter, type, props, isNullish(key) ? null : (key ?? null), span, context);
};

const cloneElement = (
  interpreter: Interpreter,
  callArguments: StaticValue[],
  span: Span,
  context: EvaluationContext,
): StaticValue => {
  const [element, config, ...children] = callArguments;
  if (element?.kind !== "element") return unknown("cloneElement of non-element");
  const props = cloneObject(element.props);
  let key = element.key;
  if (config?.kind === "object") {
    mergeObjects(props, config);
    const configKey = config.properties.get("key");
    if (configKey) key = configKey;
    props.properties.delete("key");
  } else if (config && !isNullish(config)) props.hasUnknownSpread = true;
  const childrenValue = childrenProp(children);
  if (childrenValue) props.properties.set("children", childrenValue);
  return { ...createElementValue(interpreter, element.type, props, key, span, context), owner: element.owner };
};

const resolveLazyTarget = (interpreter: Interpreter, loaded: StaticValue): StaticValue => {
  switch (loaded.kind) {
    case "namespace":
      return interpreter.getModuleExport(loaded.module, "default");
    case "object":
      return loaded.properties.get("default") ?? unknown("lazy module without default export");
    default:
      return loaded.kind === "unknown" ? loaded : unknown("lazy loader result");
  }
};

const mapChildren = (
  children: StaticValue | undefined,
  invoke: CallbackInvoker,
  callback: StaticValue | undefined,
  description: string,
): StaticValue => {
  if (!children || !callback) return unknown(description);
  switch (children.kind) {
    case "array":
      return array(children.items.map((item, index) => invoke(callback, [item, literal(index)])));
    case "list":
      return list(invoke(callback, [children.item, unknown("index")]), description);
    case "literal":
      return children.value == null || typeof children.value === "boolean"
        ? array([])
        : array([invoke(callback, [children, literal(0)])]);
    case "element":
    case "text":
      return array([invoke(callback, [children, literal(0)])]);
    default:
      return list(invoke(callback, [unknown("child"), unknown("index")]), description);
  }
};

const toChildArray = (children: StaticValue | undefined): StaticValue => {
  if (!children) return array([]);
  switch (children.kind) {
    case "array":
    case "list":
      return children;
    case "literal":
      return children.value == null || typeof children.value === "boolean" ? array([]) : array([children]);
    case "unknown":
      return children;
    default:
      return array([children]);
  }
};

const evaluateChildrenApi = (
  method: string,
  callArguments: StaticValue[],
  invoke: CallbackInvoker,
  description: string,
): StaticValue => {
  const [children, callback] = callArguments;
  switch (method) {
    case "map":
      return mapChildren(children, invoke, callback, description);
    case "forEach":
      mapChildren(children, invoke, callback, description);
      return UNDEFINED;
    case "toArray":
      return toChildArray(children);
    case "only":
      return children ?? unknown("Children.only()");
    case "count":
      return unknown("Children.count()");
    default:
      return unknown(description);
  }
};

/**
 * Models calls into React's own API surface. Returns `null` for references
 * that are not React's, so the caller can fall back to opaque handling.
 */
export const evaluateReactCall = (
  interpreter: Interpreter,
  callee: ExternalValue,
  callArguments: StaticValue[],
  invoke: CallbackInvoker,
  span: Span,
  context: EvaluationContext,
): StaticValue | null => {
  const description = `${callee.name ?? [callee.importedName, ...callee.memberPath].join(".")}()`;
  const childrenIndex = callee.memberPath.indexOf("Children");
  if (
    callee.specifier === "react" &&
    childrenIndex !== -1 &&
    childrenIndex === callee.memberPath.length - 2
  ) {
    return evaluateChildrenApi(callee.memberPath[childrenIndex + 1], callArguments, invoke, description);
  }
  const reference = getReactApiReference(callee);
  if (!reference) return null;
  const [first, second] = callArguments;
  const spanOf = (): Span => ({ start: span.start, end: span.end });
  switch (reference.api) {
    case "memo":
      return component({
        kind: "memo",
        name: null,
        inner: first ?? unknown("memo without component"),
        hasCompare: second !== undefined && !isNullish(second),
        span: spanOf(),
      });
    case "forwardRef":
      return component({
        kind: "forwardRef",
        name: null,
        render: first?.kind === "function" ? first : null,
        span: spanOf(),
      });
    case "lazy": {
      const loaded = first ? invoke(first, []) : unknown("lazy without loader");
      return component({
        kind: "lazy",
        name: null,
        inner: resolveLazyTarget(interpreter, loaded),
        span: spanOf(),
      });
    }
    case "createContext":
      return component({
        kind: "context",
        name: null,
        role: "provider",
        defaultValue: first ?? UNDEFINED,
        module: context.module,
        span: spanOf(),
      });
    case "createElement":
      return createElementFromCall(interpreter, callArguments, span, context);
    case "jsx":
    case "jsxs":
    case "jsxDEV":
      return createElementFromJsxRuntime(interpreter, callArguments, span, context);
    case "cloneElement":
      return cloneElement(interpreter, callArguments, span, context);
    case "createPortal":
      return createElementValue(
        interpreter,
        builtin("Portal"),
        object([["children", first ?? NULL]]),
        callArguments[2] ?? null,
        span,
        context,
      );
    case "isValidElement":
      if (!first || first.kind === "unknown" || first.kind === "conditional") return unknown(description);
      return first.kind === "element" ? TRUE : FALSE;
    case "createRef":
      return object([["current", NULL]]);
    case "startTransition":
    case "flushSync":
    case "act":
      return first ? invoke(first, []) : UNDEFINED;
    case "cache":
    case "memoize":
      return first ?? unknown(description);
    default:
      return unknown(description);
  }
};
