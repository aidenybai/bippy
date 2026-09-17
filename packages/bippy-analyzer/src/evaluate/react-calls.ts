import type { ModuleRecord } from "../graph/module-types.js";
import type { SourceLocation } from "../parse/source-types.js";
import {
  createFunctionComponentDefinition,
  toElementKey,
  toElementType,
} from "../react/element-type.js";
import type { ReactApi, StaticElementType, StaticObjectValue, StaticValue } from "../types.js";
import type { CallbackEvaluator } from "./callbacks.js";
import type { EvaluationContext } from "./context.js";
import { childrenToArray, countChildren, mapChildren } from "./react-children.js";
import { cloneElement, isValidElementValue, propsFromValue } from "./react-elements.js";
import { evaluateReactHook, type ReactHookEvaluator } from "./react-hooks.js";
import { nativeFunction } from "./stubs.js";
import {
  componentReference,
  FALSE_VALUE,
  getObjectProperty,
  isNullish,
  listValue,
  mapValue,
  NULL_VALUE,
  objectFromRecord,
  objectValue,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownValue,
} from "./values.js";

export interface ReactApiEvaluator extends ReactHookEvaluator, CallbackEvaluator {
  createElement: (
    type: StaticValue,
    props: StaticObjectValue,
    key: StaticValue | null,
    children: StaticValue[],
    location: SourceLocation | null,
    nameHint: string | null,
    context: EvaluationContext,
  ) => StaticValue;
  evaluateModuleExport: (module: ModuleRecord, exportedName: string) => StaticValue;
  recordRootRender: (element: StaticValue) => void;
}

const resolveLazyTarget = (
  evaluator: ReactApiEvaluator,
  resolved: StaticValue,
): StaticElementType | null => {
  switch (resolved.kind) {
    case "namespace":
      return toElementType(evaluator.evaluateModuleExport(resolved.module, "default"), null);
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
      return resolveLazyTarget(evaluator, resolved.alternatives[resolved.preferredIndex]);
    default:
      return null;
  }
};

const createReactRoot = (evaluator: ReactApiEvaluator): StaticValue =>
  objectFromRecord({
    render: nativeFunction("render", ([element]) => {
      evaluator.recordRootRender(element ?? UNDEFINED_VALUE);
      return UNDEFINED_VALUE;
    }),
    unmount: nativeFunction("unmount", () => UNDEFINED_VALUE),
  });

export const evaluateReactApiCall = (
  evaluator: ReactApiEvaluator,
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
      const { entries, key } = propsFromValue(second);
      return evaluator.createElement(
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
      const { entries, key } = propsFromValue(second, third);
      return evaluator.createElement(
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
      const resolved = evaluator.callFunction(first, [], context, { awaited: true });
      return componentReference({
        kind: "lazy",
        inner: resolveLazyTarget(evaluator, resolved),
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
    case "useState":
    case "useReducer":
    case "useMemo":
    case "useCallback":
    case "useRef":
    case "useContext":
    case "use":
    case "useEffect":
    case "useLayoutEffect":
    case "useInsertionEffect":
    case "useImperativeHandle":
    case "useDebugValue":
    case "useId":
    case "useTransition":
    case "useDeferredValue":
    case "useSyncExternalStore":
    case "useOptimistic":
    case "useActionState":
    case "useMemoCache":
      return evaluateReactHook(evaluator, api, args, context, location, nameHint);

    case "createRef":
      return objectFromRecord({ current: NULL_VALUE });
    case "startTransition":
      return first ? evaluator.callValue(first, [], context, location) : UNDEFINED_VALUE;
    case "createPortal": {
      const props = objectValue(first ? [{ kind: "property", key: "children", value: first }] : []);
      return {
        kind: "element",
        type: { kind: "portal", container: second ?? UNDEFINED_VALUE },
        key: third && isNullish(third) !== true ? toElementKey(third) : null,
        props,
        location,
        environment: context.environment,
        owner: context.owner,
      };
    }
    case "flushSync":
      return first?.kind === "function"
        ? evaluator.callFunction(first, [], context)
        : UNDEFINED_VALUE;
    case "batchedUpdates":
      return first
        ? evaluator.callValue(first, second ? [second] : [], context, location)
        : UNDEFINED_VALUE;
    case "createRoot":
      return createReactRoot(evaluator);
    case "hydrateRoot":
      evaluator.recordRootRender(second ?? UNDEFINED_VALUE);
      return createReactRoot(evaluator);
    case "render":
    case "hydrate":
      evaluator.recordRootRender(first ?? UNDEFINED_VALUE);
      return unknownValue(`${api}() root`, location);
    case "Children.map":
      return mapChildren(evaluator, first, second, third, context, location);
    case "Children.forEach":
      mapChildren(evaluator, first, second, third, context, location);
      return UNDEFINED_VALUE;
    case "Children.toArray":
      return first
        ? mapValue(first, (children) => childrenToArray(evaluator, children, context, location))
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
