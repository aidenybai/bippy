import { createFunctionComponentDefinition, toElementType } from "../react/element-type.js";
import { REACT_MEMO_CACHE_SENTINEL_KEY } from "../react/react-api.js";
import type {
  ContextDefinition,
  ReactApi,
  SourceLocation,
  StaticElementType,
  StaticNativeFunctionValue,
  StaticObjectEntry,
  StaticValue,
  StubRenderTools,
} from "../types.js";
import { type CallableValue, callUncertainCallback, isCallable } from "./builtin-calls.js";
import { countChildrenExactly, mapChildrenExactly } from "./react-children.js";
import type { EvaluationContext } from "./context.js";
import {
  escapeStateCell,
  invokeHookFactory,
  nextMemoCell,
  nextStateCell,
  queueStateUpdate,
} from "./hooks.js";
import { awaitedValue } from "./promises.js";
import type { Interpreter } from "./interpreter.js";
import {
  branchValue,
  componentReference,
  describeValue,
  FALSE_VALUE,
  getKnownObjectKeys,
  getObjectProperty,
  isNullish,
  listValue,
  mapValue,
  NULL_VALUE,
  objectFromRecord,
  objectValue,
  optionalValue,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

const ELEMENT_TYPE_TAG_KEY = "$$typeof";

const IDENTITY_MAPPER: StaticNativeFunctionValue = {
  kind: "native-function",
  name: "toArray",
  call: ([child = NULL_VALUE]) => child,
};

/** `isValidElement`: `object.$$typeof === REACT_ELEMENT_TYPE`, so a program object whose keys are known and lack the tag is decided. */
const isValidElementValue = (value: StaticValue): StaticValue => {
  switch (value.kind) {
    case "element":
      return primitiveValue(true);
    case "object": {
      const keys = getKnownObjectKeys(value);
      return keys !== null && !keys.includes(ELEMENT_TYPE_TAG_KEY)
        ? FALSE_VALUE
        : unknownPrimitiveValue("boolean", "isValidElement on dynamic value");
    }
    case "unknown":
    case "optional":
    case "external":
    case "proxy":
      return unknownPrimitiveValue("boolean", "isValidElement on dynamic value");
    case "unknown-primitive":
      return value.primitiveType === "any"
        ? unknownPrimitiveValue("boolean", "isValidElement on dynamic value")
        : FALSE_VALUE;
    default:
      return FALSE_VALUE;
  }
};

/** `mountState`/`mountReducer`: the initializer runs on mount only, twice under Strict Mode. */
const stateHook = (
  context: EvaluationContext,
  name: string,
  computeInitial: () => StaticValue,
  reduce: (
    action: StaticValue | undefined,
    current: StaticValue,
    tools: StubRenderTools,
  ) => StaticValue,
): StaticValue => {
  const frame = context.hooks;
  if (!frame) {
    return listValue([
      branchValue(
        [computeInitial(), unknownValue(`updated state of ${name}`)],
        "state may change",
        null,
      ),
      unknownValue("state setter"),
    ]);
  }
  const cell = nextStateCell(frame, name, () => invokeHookFactory(frame, computeInitial));
  cell.setter ??= {
    kind: "native-function",
    name: `set ${name}`,
    call: ([action], tools) => {
      queueStateUpdate(
        frame,
        cell,
        reduce(action, cell.next ?? cell.current, tools),
        tools.isDeferred(),
      );
      return UNDEFINED_VALUE;
    },
    onEscape: () => escapeStateCell(frame, cell),
  };
  return listValue([cell.current, cell.setter]);
};

/**
 * Mirrors `mountSyncExternalStore`: the snapshot is read on every render, and a
 * passive effect subscribes and re-checks it (`updateStoreInstance`), so a store
 * mutated between render and commit re-renders with the latest value. The
 * listener does the same for store changes triggered during evaluation.
 */
const externalStoreHook = (
  interpreter: Interpreter,
  context: EvaluationContext,
  subscribe: StaticValue | undefined,
  getSnapshot: StaticValue | undefined,
  location: SourceLocation | null,
): StaticValue => {
  const readSnapshot = (): StaticValue =>
    getSnapshot
      ? interpreter.callValue(getSnapshot, [], context, location)
      : unknownValue("external store snapshot", location);
  const snapshot = readSnapshot();
  const frame = context.hooks;
  if (!frame) return snapshot;
  const cell = nextStateCell(frame, "useSyncExternalStore", () => snapshot);
  cell.current = snapshot;
  if (!frame.isRendering || !subscribe) return snapshot;
  const handleStoreChange: StaticNativeFunctionValue = {
    kind: "native-function",
    name: "handleStoreChange",
    call: (_args, tools) => {
      queueStateUpdate(frame, cell, readSnapshot(), tools.isDeferred());
      return UNDEFINED_VALUE;
    },
  };
  frame.effects.push({
    isLayout: false,
    callback: {
      kind: "native-function",
      name: "subscribeToStore",
      call: (_args, tools) => {
        const unsubscribe = tools.call(subscribe, [handleStoreChange]);
        handleStoreChange.call([], tools);
        return unsubscribe;
      },
    },
    deps: listValue([subscribe]),
    cleanup: null,
  });
  return snapshot;
};

interface SplitProps {
  entries: StaticObjectEntry[];
  key: StaticValue | null;
}

const propsFromValue = (value: StaticValue | undefined, omitKey: boolean): SplitProps => {
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

/** What a consumer of `definition` sees when `provided` is what the nearest provider supplies (null without one). */
export const providedContextValue = (
  interpreter: Interpreter,
  definition: ContextDefinition,
  provided: StaticValue | null,
  location: SourceLocation | null,
): StaticValue => {
  if (provided) return provided;
  if (!interpreter.assumeOuterProviders) return definition.defaultValue;
  return branchValue(
    [
      definition.defaultValue,
      unknownValue(`${definition.name} provided outside the analyzed tree`),
    ],
    `no provider for ${definition.name}`,
    location,
  );
};

const readContextValue = (
  interpreter: Interpreter,
  contextValue: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue => {
  if (contextValue.kind === "context") {
    return providedContextValue(
      interpreter,
      contextValue.context,
      context.readContext(contextValue.context),
      location,
    );
  }
  if (contextValue.kind === "external") {
    return unknownValue(`context from ${contextValue.packageName}`, location);
  }
  interpreter.report("unknown-context", `useContext on ${describeValue(contextValue)}`, location);
  return unknownValue(`useContext on ${describeValue(contextValue)}`, location);
};

/** Children whose shape is uncertain (repeats, branches, unknowns) are mapped item-wise without React's flattening or keys. */
const mapUncertainChildren = (
  interpreter: Interpreter,
  children: StaticValue,
  callback: CallableValue,
  context: EvaluationContext,
): StaticValue => {
  if (children.kind === "list") {
    return listValue(
      children.items.map((item, index) =>
        item.kind === "repeat"
          ? {
              kind: "repeat",
              item: callUncertainCallback(
                interpreter,
                callback,
                [item.item, unknownPrimitiveValue("number", "index")],
                context,
              ),
              location: item.location,
            }
          : interpreter.callValue(callback, [item, primitiveValue(index)], context, null),
      ),
    );
  }
  if (children.kind === "repeat") {
    return {
      kind: "repeat",
      item: callUncertainCallback(
        interpreter,
        callback,
        [children.item, unknownPrimitiveValue("number", "index")],
        context,
      ),
      location: children.location,
    };
  }
  const uncertainContext = { ...context, uncertainDepth: context.uncertainDepth + 1 };
  if (children.kind === "branch") {
    return mapValue(children, (alternative) =>
      mapChildren(interpreter, alternative, callback, undefined, uncertainContext),
    );
  }
  if (children.kind === "optional") {
    return optionalValue(
      mapChildren(interpreter, children.value, callback, undefined, uncertainContext),
      children.reason,
      children.location,
    );
  }
  return {
    kind: "repeat",
    item: interpreter.callValue(
      callback,
      [unknownValue("child"), unknownPrimitiveValue("number", "index")],
      context,
      null,
    ),
    location: null,
  };
};

const cloneElement = (
  element: StaticValue,
  props: StaticValue | undefined,
  children: StaticValue[],
  location: SourceLocation | null,
): StaticValue => {
  if (element.kind !== "element")
    return unknownValue(`cloneElement of ${describeValue(element)}`, location);
  const { entries, key } = propsFromValue(props, true);
  const merged = objectValue([{ kind: "spread", value: element.props }, ...entries]);
  if (children.length === 1)
    merged.entries.push({ kind: "property", key: "children", value: children[0] });
  if (children.length > 1)
    merged.entries.push({ kind: "property", key: "children", value: listValue(children) });
  return {
    kind: "element",
    type: element.type,
    key: key ?? element.key,
    props: merged,
    location: element.location,
    environment: element.environment,
  };
};

const childrenToArray = (
  interpreter: Interpreter,
  children: StaticValue,
  context: EvaluationContext,
): StaticValue => {
  if (isNullish(children) === true) return listValue([]);
  const mapped = mapChildrenExactly(interpreter, children, IDENTITY_MAPPER, undefined, context);
  if (mapped) return mapped;
  if (children.kind === "list" || children.kind === "repeat") return children;
  if (children.kind === "element" || children.kind === "primitive") return listValue([children]);
  return children;
};

const countChildren = (children: StaticValue): StaticValue => {
  const count = countChildrenExactly(children);
  return count === null ? unknownPrimitiveValue("number", "Children.count") : primitiveValue(count);
};

const mapChildren = (
  interpreter: Interpreter,
  children: StaticValue | undefined,
  callback: StaticValue | undefined,
  thisArg: StaticValue | undefined,
  context: EvaluationContext,
): StaticValue => {
  if (!children || !isCallable(callback)) return unknownValue("Children.map with dynamic callback");
  return (
    mapChildrenExactly(interpreter, children, callback, thisArg, context) ??
    mapUncertainChildren(interpreter, children, callback, context)
  );
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
        context,
      );
    }
    case "jsx":
    case "jsxs":
    case "jsxDEV": {
      if (!first) return unknownValue(`${api} without a type`, location);
      const { entries } = propsFromValue(second, false);
      const key =
        third && !(third.kind === "primitive" && third.value === undefined) ? third : null;
      return interpreter.createElement(
        first,
        objectValue(entries),
        key,
        [],
        location,
        nameHint,
        context,
      );
    }
    case "cloneElement":
      return first
        ? mapValue(first, (element) => cloneElement(element, second, args.slice(2), location))
        : unknownValue("cloneElement of nothing", location);
    case "isValidElement":
      return first ? mapValue(first, isValidElementValue) : FALSE_VALUE;
    case "memo": {
      if (!first) return unknownValue("memo without a component", location);
      const inner = toElementType(first, null);
      const hasCompare = second !== undefined && isNullish(second) !== true;
      return componentReference({
        kind: "memo",
        inner,
        hasCompare,
        displayName: null,
        properties: new Map(),
      });
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
        component: createFunctionComponentDefinition(first),
        render: first,
        displayName: null,
        properties: new Map(),
      });
    }
    case "lazy": {
      if (first?.kind !== "function") {
        return componentReference({
          kind: "lazy",
          inner: null,
          displayName: null,
          properties: new Map(),
        });
      }
      const resolved = interpreter.callFunction(first, [], context, { awaited: true });
      return componentReference({
        kind: "lazy",
        inner: resolveLazyTarget(interpreter, resolved),
        displayName: null,
        properties: new Map(),
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
      const computeInitial = (): StaticValue =>
        first?.kind === "function"
          ? interpreter.callFunction(first, [], context)
          : (first ?? UNDEFINED_VALUE);
      return stateHook(context, nameHint ?? "useState", computeInitial, (action, current, tools) =>
        action?.kind === "function" ? tools.call(action, [current]) : (action ?? UNDEFINED_VALUE),
      );
    }
    case "useReducer": {
      const computeInitial = (): StaticValue =>
        third?.kind === "function"
          ? interpreter.callFunction(third, [second ?? UNDEFINED_VALUE], context)
          : (second ?? UNDEFINED_VALUE);
      return stateHook(
        context,
        nameHint ?? "useReducer",
        computeInitial,
        (action, current, tools) =>
          first && action
            ? tools.call(first, [current, action])
            : unknownValue("reducer state after dispatch"),
      );
    }
    case "useMemo": {
      const compute = (): StaticValue =>
        invokeHookFactory(context.hooks, () =>
          first?.kind === "function"
            ? interpreter.callFunction(first, [], context)
            : unknownValue("useMemo factory", location),
        );
      return context.hooks && second?.kind === "list"
        ? nextMemoCell(context.hooks, second, compute)
        : compute();
    }
    case "useCallback": {
      const callback = first ?? UNDEFINED_VALUE;
      return context.hooks && second?.kind === "list"
        ? nextMemoCell(context.hooks, second, () => callback)
        : callback;
    }
    case "useRef": {
      const createRef = (): StaticValue => objectFromRecord({ current: first ?? UNDEFINED_VALUE });
      return context.hooks ? nextMemoCell(context.hooks, null, createRef) : createRef();
    }
    case "useContext":
      return first
        ? readContextValue(interpreter, first, context, location)
        : unknownValue("useContext without a context", location);
    case "use":
      if (first?.kind === "context") return readContextValue(interpreter, first, context, location);
      return first
        ? awaitedValue(first, location, () => interpreter.timers.drainMicrotasks())
        : unknownValue("use() without an argument", location);
    case "useEffect":
    case "useLayoutEffect":
    case "useInsertionEffect":
      if (context.hooks?.isRendering && first) {
        context.hooks.effects.push({
          isLayout: api !== "useEffect",
          callback: first,
          deps: second ?? null,
          cleanup: null,
        });
      }
      return UNDEFINED_VALUE;
    case "useImperativeHandle":
    case "useDebugValue":
      return UNDEFINED_VALUE;
    case "startTransition":
      return first ? interpreter.callValue(first, [], context, location) : UNDEFINED_VALUE;
    case "useId": {
      const createId = (): StaticValue => unknownPrimitiveValue("string", "useId");
      return context.hooks ? nextMemoCell(context.hooks, null, createId) : createId();
    }
    case "useTransition":
      return listValue([
        FALSE_VALUE,
        {
          kind: "native-function",
          name: "startTransition",
          call: ([callback], tools) => (callback ? tools.call(callback, []) : UNDEFINED_VALUE),
        },
      ]);
    case "useDeferredValue":
      return first ?? UNDEFINED_VALUE;
    case "useSyncExternalStore":
      return externalStoreHook(interpreter, context, first, second, location);
    case "useOptimistic":
      return listValue([first ?? UNDEFINED_VALUE, unknownValue("optimistic setter")]);
    case "useActionState":
      return listValue([second ?? UNDEFINED_VALUE, unknownValue("form action"), FALSE_VALUE]);
    case "useMemoCache": {
      if (first?.kind !== "primitive" || typeof first.value !== "number") {
        return unknownValue("memo cache of dynamic size", location);
      }
      const sentinel: StaticValue = { kind: "symbol", key: REACT_MEMO_CACHE_SENTINEL_KEY };
      return listValue(Array.from({ length: first.value }, () => sentinel));
    }
    case "createPortal": {
      const props = objectValue(first ? [{ kind: "property", key: "children", value: first }] : []);
      return {
        kind: "element",
        type: { kind: "portal" },
        key: third ?? null,
        props,
        location,
        environment: context.environment,
      };
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
      return mapChildren(interpreter, first, second, third, context);
    case "Children.forEach":
      mapChildren(interpreter, first, second, third, context);
      return UNDEFINED_VALUE;
    case "Children.toArray":
      return first
        ? mapValue(first, (children) => childrenToArray(interpreter, children, context))
        : listValue([]);
    case "Children.count":
      return first ? mapValue(first, countChildren) : primitiveValue(0);
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
