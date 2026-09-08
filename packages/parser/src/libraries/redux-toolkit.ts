import {
  FALSE_VALUE,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  branchValue,
  compareIdentity,
  getKnownObjectKeys,
  getObjectProperty,
  getTruthiness,
  isKnownString,
  mapValue,
  objectFromRecord,
  objectValue,
  primitiveValue,
  toJsonValue,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { lazyProperties, nativeFunction } from "../frameworks/stubs.js";
import { hashKey } from "../observations.js";
import type {
  CapturedValue,
  LibraryValueProvider,
  ProjectContext,
  StaticObjectValue,
  StaticSymbolValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";

export const REDUX_TOOLKIT_PACKAGES = [
  "@reduxjs/toolkit",
  "@reduxjs/toolkit/query",
  "@reduxjs/toolkit/query/react",
];

const SKIP_TOKEN: StaticSymbolValue = { kind: "symbol", key: "@reduxjs/toolkit/query/skipToken" };

type RequestStatus = "uninitialized" | "pending" | "fulfilled" | "rejected";

const reducerKeysByReducer = new WeakMap<StaticValue, readonly string[]>();

const booleanValue = (value: boolean): StaticValue => (value ? TRUE_VALUE : FALSE_VALUE);

const isUndefined = (value: StaticValue): boolean =>
  value.kind === "primitive" && value.value === undefined;

const isCapturedRecord = (value: CapturedValue): value is Record<string, CapturedValue> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const getOptionalProperty = (options: StaticValue | undefined, key: string): StaticValue =>
  options?.kind === "object" ? getObjectProperty(options, key) : UNDEFINED_VALUE;

const getReducerKeys = (reducer: StaticValue): readonly string[] | null =>
  reducer.kind === "object"
    ? getKnownObjectKeys(reducer)
    : (reducerKeysByReducer.get(reducer) ?? null);

const haveSameKeys = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((key) => right.includes(key));

/** The recorded state of the one store built from exactly these slice reducers; `undefined` when none or several were. */
const findStoreState = (
  states: readonly CapturedValue[],
  reducerKeys: readonly string[],
): CapturedValue | undefined => {
  const matches = states.filter(
    (state) => isCapturedRecord(state) && haveSameKeys(Object.keys(state), reducerKeys),
  );
  return matches.length === 1 ? matches[0] : undefined;
};

const combineReducers = nativeFunction("combineReducers", ([reducers]) => {
  const combined = nativeFunction("combination", () =>
    unknownValue("state produced by a combined reducer"),
  );
  const keys = reducers === undefined ? null : getReducerKeys(reducers);
  if (keys) reducerKeysByReducer.set(combined, keys);
  return combined;
});

const isCallable = (value: StaticValue): boolean =>
  value.kind === "function" || value.kind === "native-function";

const actionCreator = (type: string, prepare: StaticValue | null): StaticValue =>
  nativeFunction(type, (args, tools) => {
    if (prepare === null)
      return objectFromRecord({ type: primitiveValue(type), payload: args[0] ?? UNDEFINED_VALUE });
    const prepared = tools.call(prepare, args);
    if (prepared.kind !== "object") return unknownValue(`action prepared for ${type} at runtime`);
    return objectValue([
      { kind: "property", key: "type", value: primitiveValue(type) },
      ...prepared.entries.filter(
        (entry) => entry.kind !== "property" || ["payload", "meta", "error"].includes(entry.key),
      ),
    ]);
  });

const createAction = nativeFunction("createAction", ([type, prepare]) =>
  isKnownString(type)
    ? actionCreator(type.value, prepare !== undefined && isCallable(prepare) ? prepare : null)
    : unknownValue("createAction() with a type that is not statically known"),
);

const sliceActionCreators = (name: string, reducers: StaticValue): StaticValue | null => {
  const reducerNames = reducers.kind === "object" ? getKnownObjectKeys(reducers) : null;
  if (reducers.kind !== "object" || reducerNames === null) return null;
  return objectFromRecord(
    Object.fromEntries(
      reducerNames.map((reducerName) => {
        const definition = getObjectProperty(reducers, reducerName);
        const prepare =
          definition.kind === "object" ? getObjectProperty(definition, "prepare") : null;
        return [
          reducerName,
          actionCreator(
            `${name}/${reducerName}`,
            prepare !== null && isCallable(prepare) ? prepare : null,
          ),
        ];
      }),
    ),
  );
};

/**
 * `createSlice`: the slice's `name` and `reducerPath` are the strings it was
 * given, `getInitialState` its `initialState` (called when a function), and
 * `actions` one creator per case reducer typed `${name}/${reducerName}`.
 */
const createSlice = nativeFunction("createSlice", ([options]) => {
  const name = getOptionalProperty(options, "name");
  if (!isKnownString(name))
    return unknownValue("createSlice() with a name that is not statically known");
  const actions = sliceActionCreators(name.value, getOptionalProperty(options, "reducers"));
  if (actions === null)
    return unknownValue(`createSlice(${name.value}) with reducers that are not statically known`);
  const reducerPathOption = getOptionalProperty(options, "reducerPath");
  const reducerPath = isKnownString(reducerPathOption) ? reducerPathOption.value : name.value;
  const initialState = getOptionalProperty(options, "initialState");
  const getInitialState = nativeFunction("getInitialState", (_args, tools) =>
    isCallable(initialState) ? tools.call(initialState, []) : initialState,
  );
  const selectSlice = nativeFunction("selectSlice", ([state]) =>
    state?.kind === "object"
      ? getObjectProperty(state, reducerPath)
      : unknownValue(`the ${reducerPath} slice of a state that is not statically known`),
  );
  return objectFromRecord({
    name,
    reducerPath: primitiveValue(reducerPath),
    reducer: nativeFunction("reducer", () =>
      unknownValue(`state produced by the ${name.value} slice reducer`),
    ),
    actions,
    caseReducers: getOptionalProperty(options, "reducers"),
    getInitialState,
    selectSlice,
  });
});

const bindActionCreators = nativeFunction("bindActionCreators", ([creators, dispatch]) => {
  if (creators === undefined || dispatch === undefined)
    return unknownValue("bindActionCreators() without creators or a dispatch");
  const bind = (creator: StaticValue): StaticValue =>
    nativeFunction("boundActionCreator", (args, callTools) =>
      callTools.call(dispatch, [callTools.call(creator, args)]),
    );
  if (isCallable(creators)) return bind(creators);
  const keys = creators.kind === "object" ? getKnownObjectKeys(creators) : null;
  if (creators.kind !== "object" || keys === null) {
    return unknownValue("bindActionCreators() over creators that are not statically known");
  }
  return objectFromRecord(
    Object.fromEntries(keys.map((key) => [key, bind(getObjectProperty(creators, key))])),
  );
});

const configureStore = (project: ProjectContext): StaticValue =>
  nativeFunction("configureStore", ([options]) => {
    const reducerKeys = getReducerKeys(getOptionalProperty(options, "reducer"));
    const state =
      reducerKeys && project.storeStates
        ? findStoreState(project.storeStates, reducerKeys)
        : undefined;
    return objectFromRecord({
      getState: nativeFunction("getState", (_args, tools) =>
        state === undefined
          ? unknownValue("state of a Redux store the page did not record")
          : tools.captured(state, "the Redux store's state"),
      ),
      dispatch: nativeFunction("dispatch", () => unknownValue("result of dispatching at runtime")),
      subscribe: nativeFunction("subscribe", () =>
        nativeFunction("unsubscribe", () => UNDEFINED_VALUE),
      ),
      replaceReducer: nativeFunction("replaceReducer", () => UNDEFINED_VALUE),
    });
  });

const baseQueryFactory = (name: string): StaticValue =>
  nativeFunction(name, () =>
    nativeFunction("baseQuery", () => unknownValue(`response of the ${name} base query`)),
  );

const endpointBuilder = (type: "query" | "mutation"): StaticValue =>
  nativeFunction(type, ([definition]) =>
    objectValue([
      ...(definition?.kind === "object" ? definition.entries : []),
      { kind: "property", key: "type", value: primitiveValue(type) },
    ]),
  );

const ENDPOINT_BUILDER = objectFromRecord({
  query: endpointBuilder("query"),
  mutation: endpointBuilder("mutation"),
});

const requestStatusFlags = (status: RequestStatus): Record<string, StaticValue> => ({
  status: primitiveValue(status),
  isUninitialized: booleanValue(status === "uninitialized"),
  isLoading: booleanValue(status === "pending"),
  isSuccess: booleanValue(status === "fulfilled"),
  isError: booleanValue(status === "rejected"),
});

/** `useQuery`: the substate with request flags through `queryStatePreSelector` (no previous result), `noPendingQueryStateSelector` for a subscribed hook, plus the subscription's `refetch`. */
const queryHookResult = (
  substate: Record<string, StaticValue>,
  status: RequestStatus,
  isSkipped: boolean,
): StaticValue => {
  const data = substate.data ?? UNDEFINED_VALUE;
  const hasData = !isUndefined(data);
  const isFetching = status === "pending";
  const selected: Record<string, StaticValue> = {
    ...substate,
    ...requestStatusFlags(status),
    data,
    currentData: data,
    isFetching: booleanValue(isFetching),
    isLoading: booleanValue(!hasData && isFetching),
    isSuccess: booleanValue(status === "fulfilled" || (isFetching && hasData)),
  };
  const shown =
    status === "uninitialized" && !isSkipped
      ? {
          ...selected,
          isUninitialized: FALSE_VALUE,
          isFetching: TRUE_VALUE,
          isLoading: booleanValue(!hasData),
          status: primitiveValue("pending"),
        }
      : selected;
  return objectFromRecord({
    ...shown,
    refetch: nativeFunction("refetch", () => unknownValue("promise returned by refetch")),
  });
};

const capturedSubstate = (
  substate: Record<string, CapturedValue>,
  name: string,
  tools: StubRenderTools,
): Record<string, StaticValue> =>
  Object.fromEntries(
    Object.entries(substate).map(([key, value]) => [key, tools.captured(value, `${name}.${key}`)]),
  );

const capturedQueryResult = (
  substate: CapturedValue | undefined,
  name: string,
  tools: StubRenderTools,
): StaticValue => {
  if (substate === undefined) return queryHookResult({}, "uninitialized", false);
  if (!isCapturedRecord(substate) || typeof substate.status !== "string") {
    return unknownValue(`${name} recorded in an unexpected shape`);
  }
  const { status } = substate;
  if (status !== "pending" && status !== "fulfilled" && status !== "rejected") {
    return unknownValue(`${name} recorded with status ${status}`);
  }
  return queryHookResult(capturedSubstate(substate, name, tools), status, false);
};

const settledQueryResult = (endpointName: string, queryArgs: StaticValue): StaticValue => {
  const common: Record<string, StaticValue> = {
    endpointName: primitiveValue(endpointName),
    originalArgs: queryArgs,
    requestId: unknownPrimitiveValue("string", "request id of the query at runtime"),
    startedTimeStamp: unknownPrimitiveValue("number", "when the query started"),
  };
  return branchValue(
    [
      queryHookResult(
        {
          ...common,
          data: unknownValue(`data fetched by ${endpointName} at runtime`),
          fulfilledTimeStamp: unknownPrimitiveValue("number", "when the query fulfilled"),
        },
        "fulfilled",
        false,
      ),
      queryHookResult(
        { ...common, error: unknownValue(`error returned by ${endpointName} at runtime`) },
        "rejected",
        false,
      ),
    ],
    "whether the query succeeded or failed at runtime",
  );
};

interface ApiModel {
  reducerPath: string;
  serializeQueryArgs: StaticValue;
  endpointDefinitions: Map<string, StaticObjectValue>;
  project: ProjectContext;
  /** The api's plain members; every other key is an endpoint hook or unknown. */
  base: Record<string, StaticValue>;
}

/** `defaultSerializeQueryArgs`, or the api's own serializer when it is configured. */
const serializeQueryArgs = (
  api: ApiModel,
  endpointName: string,
  queryArgs: StaticValue,
  tools: StubRenderTools,
): string | null => {
  if (!isUndefined(api.serializeQueryArgs)) {
    const serialized = tools.call(api.serializeQueryArgs, [
      objectFromRecord({
        queryArgs,
        endpointDefinition: api.endpointDefinitions.get(endpointName) ?? UNDEFINED_VALUE,
        endpointName: primitiveValue(endpointName),
      }),
    ]);
    return isKnownString(serialized) ? serialized.value : null;
  }
  if (isUndefined(queryArgs)) return `${endpointName}(undefined)`;
  const json = toJsonValue(queryArgs);
  return json === undefined ? null : `${endpointName}(${hashKey(json)})`;
};

/** The recorded query cache entry, `undefined` when the one store carrying this api has none and `null` without such a store. */
const findQuerySubstate = (
  api: ApiModel,
  serializedArgs: string,
): CapturedValue | undefined | null => {
  const caches = (api.project.storeStates ?? []).flatMap((state) => {
    if (!isCapturedRecord(state)) return [];
    const slice = state[api.reducerPath];
    return isCapturedRecord(slice) && isCapturedRecord(slice.queries) ? [slice.queries] : [];
  });
  return caches.length === 1 ? caches[0][serializedArgs] : null;
};

const capitalize = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

const useQuery = (api: ApiModel, endpointName: string): StaticValue =>
  nativeFunction(
    `use${capitalize(endpointName)}Query`,
    ([queryArgs = UNDEFINED_VALUE, options], tools) =>
      mapValue(options ?? UNDEFINED_VALUE, (alternative) => {
        const skip = getOptionalProperty(alternative, "skip");
        const isSkipped =
          compareIdentity(queryArgs, SKIP_TOKEN) === true || getTruthiness(skip) === true;
        if (isSkipped) return queryHookResult({}, "uninitialized", true);
        if (getTruthiness(skip) === null) {
          return unknownValue(`whether ${endpointName} is skipped at runtime`);
        }
        const serializedArgs = serializeQueryArgs(api, endpointName, queryArgs, tools);
        const substate = serializedArgs === null ? null : findQuerySubstate(api, serializedArgs);
        return substate === null
          ? settledQueryResult(endpointName, queryArgs)
          : capturedQueryResult(substate, `${api.reducerPath} query ${serializedArgs}`, tools);
      }),
  );

const endpointHooks = (api: ApiModel, endpointName: string): StaticValue => {
  const definition = api.endpointDefinitions.get(endpointName);
  if (!definition) return unknownValue(`endpoint ${endpointName} of createApi()`);
  const type = getObjectProperty(definition, "type");
  return isKnownString(type) && type.value === "query"
    ? objectFromRecord({ useQuery: useQuery(api, endpointName) })
    : unknownValue(
        `${type.kind === "primitive" ? String(type.value) : "unknown"} endpoint ${endpointName} of createApi()`,
      );
};

const QUERY_HOOK_NAME = /^use(.+)Query$/;

const apiProperty = (api: ApiModel, key: string): StaticValue => {
  const base = api.base[key];
  if (base) return base;
  const hookMatch = QUERY_HOOK_NAME.exec(key);
  const endpointName =
    hookMatch === null
      ? undefined
      : [...api.endpointDefinitions.keys()].find((name) => capitalize(name) === hookMatch[1]);
  if (endpointName === undefined) return unknownValue(`${key} of createApi()`);
  const hooks = endpointHooks(api, endpointName);
  return hooks.kind === "object" ? getObjectProperty(hooks, "useQuery") : hooks;
};

const createApi = (project: ProjectContext): StaticValue =>
  nativeFunction("createApi", ([options], tools) => {
    const reducerPathOption = getOptionalProperty(options, "reducerPath");
    const endpoints = tools.call(getOptionalProperty(options, "endpoints"), [ENDPOINT_BUILDER]);
    const endpointNames = endpoints.kind === "object" ? getKnownObjectKeys(endpoints) : null;
    if (endpoints.kind !== "object" || endpointNames === null) {
      return unknownValue("createApi() with endpoints that are not statically known");
    }
    const reducerPath = isKnownString(reducerPathOption) ? reducerPathOption.value : "api";
    const api: ApiModel = {
      reducerPath,
      serializeQueryArgs: getOptionalProperty(options, "serializeQueryArgs"),
      endpointDefinitions: new Map(
        endpointNames.flatMap((name): [string, StaticObjectValue][] => {
          const definition = getObjectProperty(endpoints, name);
          return definition.kind === "object" ? [[name, definition]] : [];
        }),
      ),
      project,
      base: {
        reducerPath: primitiveValue(reducerPath),
        reducer: nativeFunction("reducer", () => unknownValue("state produced by the api reducer")),
        middleware: nativeFunction("middleware", () => unknownValue("the api middleware")),
        endpoints: lazyProperties(objectValue(), (name) => endpointHooks(api, name)),
      },
    };
    return lazyProperties(objectValue(), (key) => apiProperty(api, key));
  });

export const reduxToolkitValue: LibraryValueProvider = (specifier, importedName, project) => {
  if (!REDUX_TOOLKIT_PACKAGES.includes(specifier)) return null;
  switch (importedName) {
    case "combineReducers":
      return combineReducers;
    case "createAction":
      return createAction;
    case "createSlice":
      return createSlice;
    case "bindActionCreators":
      return bindActionCreators;
    case "configureStore":
      return configureStore(project);
    case "createApi":
      return createApi(project);
    case "fetchBaseQuery":
    case "fakeBaseQuery":
      return baseQueryFactory(importedName);
    case "skipToken":
      return SKIP_TOKEN;
    default:
      return null;
  }
};
