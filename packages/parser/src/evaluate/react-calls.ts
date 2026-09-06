import { createFunctionComponentDefinition, toElementType } from "../react/element-type.js";
import type {
  ReactApi,
  SourceLocation,
  StaticElementType,
  StaticObjectEntry,
  StaticValue,
} from "../types.js";
import type { EvaluationContext } from "./context.js";
import { lookupContextValue } from "./context.js";
import type { Interpreter } from "./interpreter.js";
import {
  branchValue,
  componentReference,
  describeValue,
  FALSE_VALUE,
  getObjectProperty,
  isNullish,
  listValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

const propsFromValue = (
  value: StaticValue | undefined,
  omitKey: boolean,
): { entries: StaticObjectEntry[]; key: StaticValue | null } => {
  if (
    !value ||
    (value.kind === "primitive" && (value.value === null || value.value === undefined))
  ) {
    return { entries: [], key: null };
  }
  if (value.kind === "object") {
    const entries: StaticObjectEntry[] = [];
    let key: StaticValue | null = null;
    for (const entry of value.entries) {
      if (omitKey && entry.kind === "property" && entry.key === "key") {
        key = entry.value;
        continue;
      }
      entries.push(entry);
    }
    return { entries, key };
  }
  return { entries: [{ kind: "spread", value }], key: null };
};

const resolveLazyTarget = (
  interpreter: Interpreter,
  resolved: StaticValue,
): StaticElementType | null => {
  switch (resolved.kind) {
    case "namespace":
      return toElementType(interpreter.evaluateModuleExport(resolved.module, "default"), null);
    case "object": {
      const defaultExport = getObjectProperty(resolved, "default");
      if (defaultExport.kind === "primitive" && defaultExport.value === undefined) return null;
      return toElementType(defaultExport, null);
    }
    case "external":
      return toElementType({ ...resolved, importedName: `${resolved.importedName}.default` }, null);
    case "function":
    case "class":
    case "component-reference":
      return toElementType(resolved, null);
    case "branch":
      return resolveLazyTarget(interpreter, resolved.alternatives[resolved.preferredIndex]);
    default:
      return null;
  }
};

const readContextValue = (
  interpreter: Interpreter,
  contextValue: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  if (contextValue.kind === "context") {
    const provided = lookupContextValue(context.contextFrame, contextValue.context);
    if (provided) return provided;
    return branchValue(
      [
        contextValue.context.defaultValue,
        unknownValue(`${contextValue.context.name} provided outside the analyzed tree`),
      ],
      `no provider for ${contextValue.context.name}`,
      location,
    );
  }
  if (contextValue.kind === "external") {
    return unknownValue(`context from ${contextValue.packageName}`, location);
  }
  interpreter.report("unknown-context", `useContext on ${describeValue(contextValue)}`, location);
  return unknownValue(`useContext on ${describeValue(contextValue)}`, location);
};

const mapChildren = (
  interpreter: Interpreter,
  children: StaticValue | undefined,
  callback: StaticValue | undefined,
  context: EvaluationContext,
): StaticValue => {
  if (!children || !callback || callback.kind !== "function")
    return unknownValue("Children.map with dynamic callback");
  if (children.kind === "primitive" && (children.value === null || children.value === undefined))
    return children;
  if (children.kind === "list") {
    return listValue(
      children.items.map((item, index) =>
        item.kind === "repeat"
          ? {
              kind: "repeat",
              item: interpreter.callFunction(
                callback,
                [item.item, unknownPrimitiveValue("number", "index")],
                context,
              ),
              location: item.location,
            }
          : interpreter.callFunction(callback, [item, primitiveValue(index)], context),
      ),
    );
  }
  if (children.kind === "repeat") {
    return {
      kind: "repeat",
      item: interpreter.callFunction(
        callback,
        [children.item, unknownPrimitiveValue("number", "index")],
        context,
      ),
      location: children.location,
    };
  }
  if (children.kind === "element" || children.kind === "primitive") {
    return listValue([interpreter.callFunction(callback, [children, primitiveValue(0)], context)]);
  }
  return {
    kind: "repeat",
    item: interpreter.callFunction(
      callback,
      [unknownValue("child"), unknownPrimitiveValue("number", "index")],
      context,
    ),
    location: null,
  };
};

export const evaluateReactApiCall = (
  interpreter: Interpreter,
  api: ReactApi,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
  nameHint: string | null,
): StaticValue => {
  const [first, second, third] = args;
  switch (api) {
    case "createElement": {
      if (!first) return unknownValue("createElement without a type", location);
      const { entries, key } = propsFromValue(second, true);
      return interpreter.createElement(
        first,
        objectValue(entries),
        key,
        args.slice(2),
        location,
        nameHint,
      );
    }
    case "jsx":
    case "jsxs":
    case "jsxDEV": {
      if (!first) return unknownValue(`${api} without a type`, location);
      const { entries } = propsFromValue(second, false);
      const key =
        third && !(third.kind === "primitive" && third.value === undefined) ? third : null;
      return interpreter.createElement(first, objectValue(entries), key, [], location, nameHint);
    }
    case "cloneElement": {
      if (first?.kind !== "element")
        return unknownValue(
          `cloneElement of ${first ? describeValue(first) : "nothing"}`,
          location,
        );
      const { entries, key } = propsFromValue(second, true);
      const merged = objectValue([{ kind: "spread", value: first.props }, ...entries]);
      const children = args.slice(2);
      if (children.length === 1)
        merged.entries.push({ kind: "property", key: "children", value: children[0] });
      if (children.length > 1)
        merged.entries.push({ kind: "property", key: "children", value: listValue(children) });
      return {
        kind: "element",
        type: first.type,
        key: key ?? first.key,
        props: merged,
        location: first.location,
      };
    }
    case "isValidElement":
      if (!first) return FALSE_VALUE;
      if (first.kind === "element") return primitiveValue(true);
      if (first.kind === "primitive" || first.kind === "list" || first.kind === "function")
        return FALSE_VALUE;
      return unknownPrimitiveValue("boolean", "isValidElement on dynamic value");
    case "memo": {
      if (!first) return unknownValue("memo without a component", location);
      const inner = toElementType(first, null);
      const hasCompare = second !== undefined && isNullish(second) !== true;
      return componentReference({ kind: "memo", inner, hasCompare, displayName: null });
    }
    case "forwardRef": {
      if (first?.kind !== "function") {
        return componentReference({
          kind: "unknown",
          displayName: nameHint,
          reason: "forwardRef with a non-function render",
        });
      }
      return componentReference({
        kind: "forward-ref",
        component: createFunctionComponentDefinition(first, first.name),
        displayName: null,
      });
    }
    case "lazy": {
      if (first?.kind !== "function") {
        return componentReference({ kind: "lazy", inner: null, displayName: null });
      }
      const resolved = interpreter.callFunction(first, [], context);
      return componentReference({
        kind: "lazy",
        inner: resolveLazyTarget(interpreter, resolved),
        displayName: null,
      });
    }
    case "createContext":
      return {
        kind: "context",
        context: {
          name: nameHint ?? "Context",
          displayName: null,
          defaultValue: first ?? UNDEFINED_VALUE,
          location,
        },
      };
    case "useState": {
      const initial =
        first?.kind === "function"
          ? interpreter.callFunction(first, [], context)
          : (first ?? UNDEFINED_VALUE);
      return listValue([
        branchValue(
          [initial, unknownValue(`updated state of ${nameHint ?? "useState"}`)],
          "state may change after mount",
          location,
        ),
        unknownValue("state setter"),
      ]);
    }
    case "useReducer": {
      const initial =
        third?.kind === "function"
          ? interpreter.callFunction(third, [second ?? UNDEFINED_VALUE], context)
          : (second ?? UNDEFINED_VALUE);
      return listValue([
        branchValue(
          [initial, unknownValue("reducer state after dispatch")],
          "reducer state may change",
          location,
        ),
        unknownValue("dispatch"),
      ]);
    }
    case "useMemo":
      return first?.kind === "function"
        ? interpreter.callFunction(first, [], context)
        : unknownValue("useMemo factory", location);
    case "useCallback":
      return first ?? UNDEFINED_VALUE;
    case "useRef":
      return objectFromRecord({ current: first ?? UNDEFINED_VALUE });
    case "useContext":
      return first
        ? readContextValue(interpreter, first, context, location)
        : unknownValue("useContext without a context", location);
    case "use":
      if (first?.kind === "context") return readContextValue(interpreter, first, context, location);
      return unknownValue("use(promise)", location);
    case "useEffect":
    case "useLayoutEffect":
    case "useInsertionEffect":
    case "useImperativeHandle":
    case "useDebugValue":
    case "startTransition":
      return UNDEFINED_VALUE;
    case "useId":
      return unknownPrimitiveValue("string", "useId");
    case "useTransition":
      return listValue([FALSE_VALUE, unknownValue("startTransition")]);
    case "useDeferredValue":
      return first ?? UNDEFINED_VALUE;
    case "useSyncExternalStore": {
      const snapshot =
        second?.kind === "function"
          ? interpreter.callFunction(second, [], context)
          : unknownValue("external store snapshot");
      return branchValue(
        [snapshot, unknownValue("external store snapshot may change")],
        "external store",
        location,
      );
    }
    case "useOptimistic":
      return listValue([first ?? UNDEFINED_VALUE, unknownValue("optimistic setter")]);
    case "useActionState":
      return listValue([second ?? UNDEFINED_VALUE, unknownValue("form action"), FALSE_VALUE]);
    case "createPortal": {
      const props = objectValue(first ? [{ kind: "property", key: "children", value: first }] : []);
      return { kind: "element", type: { kind: "portal" }, key: third ?? null, props, location };
    }
    case "flushSync":
      return first?.kind === "function"
        ? interpreter.callFunction(first, [], context)
        : UNDEFINED_VALUE;
    case "createRoot":
    case "hydrateRoot":
    case "render":
    case "hydrate":
      return unknownValue(`${api}() root`, location);
    case "Children.map":
      return mapChildren(interpreter, first, second, context);
    case "Children.forEach":
      mapChildren(interpreter, first, second, context);
      return UNDEFINED_VALUE;
    case "Children.toArray":
      if (!first) return listValue([]);
      if (first.kind === "list" || first.kind === "repeat") return first;
      if (first.kind === "primitive" && (first.value === null || first.value === undefined))
        return listValue([]);
      if (first.kind === "element" || first.kind === "primitive") return listValue([first]);
      return first;
    case "Children.count":
      if (first?.kind === "list" && first.items.every((item) => item.kind !== "repeat"))
        return primitiveValue(first.items.length);
      return unknownPrimitiveValue("number", "Children.count");
    case "Children.only":
      return first ?? unknownValue("Children.only without children", location);
    case "Children":
    case "Fragment":
    case "StrictMode":
    case "Suspense":
    case "SuspenseList":
    case "Profiler":
    case "Activity":
    case "ViewTransition":
    case "Component":
    case "PureComponent":
      return unknownValue(`React.${api} called as a function`, location);
  }
};
