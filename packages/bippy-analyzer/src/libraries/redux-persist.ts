import {
  branchValue,
  getObjectProperty,
  getTruthiness,
  isCallable,
  isUndefinedValue,
  mapValue,
  NULL_VALUE,
  objectFromRecord,
  toBooleanValue,
  UNDEFINED_VALUE,
  unknownValue,
} from "../evaluate/values.js";
import { nativeFunction, stubValue } from "../evaluate/stubs.js";
import type {
  LibraryValueProvider,
  ModeledExports,
  StaticValue,
  StubComponent,
  StubRenderTools,
} from "../types.js";
import { ClassComponentTag } from "../work-tags.js";
import { getReducerKeys, opaqueReducer } from "./redux-toolkit.js";

export const REDUX_PERSIST_PACKAGES = ["redux-persist", "redux-persist/integration/react"];

export const REDUX_PERSIST_MODELED_EXPORTS: ModeledExports = {
  "redux-persist": ["persistReducer", "persistCombineReducers", "persistStore"],
  "redux-persist/integration/react": ["PersistGate"],
};

const PERSIST_KEY = "_persist";

const persistedReducer = (baseReducer: StaticValue | undefined): StaticValue => {
  const baseKeys = baseReducer === undefined ? null : getReducerKeys(baseReducer);
  return opaqueReducer(
    "persistReducer",
    baseKeys && [...baseKeys.filter((key) => key !== PERSIST_KEY), PERSIST_KEY],
    "state produced by a persisted reducer",
  );
};

const persistReducer = nativeFunction("persistReducer", ([, baseReducer]) =>
  persistedReducer(baseReducer),
);

const persistCombineReducers = nativeFunction("persistCombineReducers", ([, reducers]) =>
  persistedReducer(reducers),
);

const getBootstrapped = (store: StaticValue, tools: StubRenderTools): StaticValue => {
  if (store.kind !== "object") return unknownValue("whether an unknown store has rehydrated");
  const state = tools.call(getObjectProperty(store, "getState"), []);
  return mapValue(state, (alternative) =>
    alternative.kind === "object"
      ? mapValue(getObjectProperty(alternative, PERSIST_KEY), (persist) =>
          persist.kind === "object"
            ? toBooleanValue(getObjectProperty(persist, "rehydrated"))
            : unknownValue("whether the store's persisted state has rehydrated"),
        )
      : unknownValue("whether a store with unrecorded state has rehydrated"),
  );
};

const dispatchResult = nativeFunction("dispatch", () =>
  unknownValue("result of dispatching at runtime"),
);

const settledPromise = (name: string): StaticValue =>
  nativeFunction(name, () => unknownValue(`promise resolved once the store has ${name}ed`));

const persistStore = nativeFunction("persistStore", ([store = UNDEFINED_VALUE]) =>
  objectFromRecord({
    getState: nativeFunction("getState", (_args, tools) =>
      objectFromRecord({
        registry: unknownValue("persist keys still waiting for rehydration"),
        bootstrapped: getBootstrapped(store, tools),
      }),
    ),
    dispatch: dispatchResult,
    subscribe: nativeFunction("subscribe", () =>
      nativeFunction("unsubscribe", () => UNDEFINED_VALUE),
    ),
    replaceReducer: nativeFunction("replaceReducer", () => UNDEFINED_VALUE),
    purge: settledPromise("purge"),
    flush: settledPromise("flush"),
    pause: nativeFunction("pause", () => UNDEFINED_VALUE),
    persist: nativeFunction("persist", () => UNDEFINED_VALUE),
  }),
);

const PERSIST_GATE: StubComponent = {
  displayName: "PersistGate",
  tag: ClassComponentTag,
  render: (props, tools) => {
    const persistor = getObjectProperty(props, "persistor");
    const bootstrapped =
      persistor.kind === "object"
        ? mapValue(
            tools.call(getObjectProperty(persistor, "getState"), []),
            (state): StaticValue =>
              state.kind === "object"
                ? toBooleanValue(getObjectProperty(state, "bootstrapped"))
                : unknownValue("whether the persistor has bootstrapped"),
          )
        : unknownValue("whether an unknown persistor has bootstrapped");
    const children = getObjectProperty(props, "children");
    if (isCallable(children)) return tools.call(children, [bootstrapped]);
    const loading = getObjectProperty(props, "loading");
    const fallback = isUndefinedValue(loading) ? NULL_VALUE : loading;
    const lifted = isUndefinedValue(children) ? NULL_VALUE : children;
    return mapValue(bootstrapped, (alternative) => {
      switch (getTruthiness(alternative)) {
        case true:
          return lifted;
        case false:
          return fallback;
        default:
          return branchValue([lifted, fallback], "whether the persistor has bootstrapped");
      }
    });
  },
};

export const reduxPersistValue: LibraryValueProvider = (specifier, importedName) => {
  if (specifier === "redux-persist/integration/react") {
    return importedName === "PersistGate" ? stubValue(PERSIST_GATE) : null;
  }
  if (specifier !== "redux-persist") return null;
  switch (importedName) {
    case "persistReducer":
      return persistReducer;
    case "persistCombineReducers":
      return persistCombineReducers;
    case "persistStore":
      return persistStore;
    default:
      return null;
  }
};
