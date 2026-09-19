import { lazyProperties, nativeFunction, noopFunction } from "../evaluate/stubs.js";
import {
  FALSE_VALUE,
  UNDEFINED_VALUE,
  allocate,
  branchValue,
  compareShallowly,
  compareIdentity,
  decidedBooleanValue,
  getObjectProperty,
  getTruthiness,
  isCallable,
  isUndefinedValue,
  listValue,
  objectFromRecord,
  objectValue,
} from "../evaluate/values.js";
import type {
  LibraryValueProvider,
  JournaledState,
  ModeledExports,
  StaticListValue,
  StaticObjectValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";
import { subscribeToExternalStore } from "./use-sync-external-store.js";

export const ZUSTAND_PACKAGES = ["zustand"];
export const ZUSTAND_MODELED_EXPORTS: ModeledExports = {
  zustand: ["create", "createStore", "useStore"],
  "zustand/react": ["create", "useStore"],
  "zustand/vanilla": ["createStore"],
  "zustand/middleware": [
    "combine",
    "createJSONStorage",
    "devtools",
    "persist",
    "redux",
    "subscribeWithSelector",
    "unstable_ssrSafe",
  ],
  "zustand/middleware/immer": ["immer"],
  "zustand/react/shallow": ["useShallow"],
  "zustand/shallow": ["shallow", "useShallow"],
  "zustand/traditional": ["createWithEqualityFn", "useStoreWithEqualityFn"],
  "zustand/vanilla/shallow": ["shallow"],
};

interface ZustandStore {
  api: StaticObjectValue;
  initialState: StaticValue;
  listeners: StaticListValue;
  state: ZustandState;
}

interface ZustandState extends JournaledState<StaticValue> {
  current: StaticValue;
}

const createState = (): ZustandState => {
  const state: ZustandState = {
    allocation: allocate(),
    current: UNDEFINED_VALUE,
    capture: () => state.current,
    restore: (snapshot) => {
      state.current = snapshot;
    },
    join: (snapshots, reason, location, preferredPath, predicate) => {
      state.current = branchValue(snapshots, reason, location, preferredPath, predicate ?? null);
    },
  };
  return state;
};

const getState = (store: ZustandStore): StaticValue => store.state.current;

const isObjectState = (state: StaticValue): boolean =>
  state.kind === "object" ||
  (state.kind === "branch" && state.alternatives.every(isObjectState));

const notify = (
  store: ZustandStore,
  nextState: StaticValue,
  previousState: StaticValue,
  tools: StubRenderTools,
): void => {
  for (const listener of store.listeners.items) {
    if (isCallable(listener)) tools.call(listener, [nextState, previousState]);
  }
};

const setState = (store: ZustandStore): StaticValue =>
  nativeFunction("setState", ([partial, replace], tools) => {
    if (partial === undefined) return UNDEFINED_VALUE;
    const previousState = getState(store);
    const nextState = isCallable(partial) ? tools.call(partial, [previousState]) : partial;
    const shouldReplace = getTruthiness(replace ?? FALSE_VALUE) === true;
    const mergedState =
      !shouldReplace && isObjectState(previousState) && isObjectState(nextState)
        ? objectValue([
            { kind: "spread", value: previousState },
            { kind: "spread", value: nextState },
          ])
        : nextState;
    if (compareIdentity(previousState, mergedState) === true) return UNDEFINED_VALUE;
    tools.recordStateMutation(store.state);
    store.state.current = mergedState;
    notify(store, mergedState, previousState, tools);
    return UNDEFINED_VALUE;
  });

const subscribe = (store: ZustandStore): StaticValue =>
  nativeFunction("subscribe", ([selectorOrListener, optionalListener], tools) => {
    if (selectorOrListener === undefined) return noopFunction("unsubscribe");
    const listener =
      optionalListener === undefined
        ? selectorOrListener
        : nativeFunction("selectorListener", ([nextState, previousState], listenerTools) => {
            const nextSelection = listenerTools.call(selectorOrListener, [nextState]);
            const previousSelection = listenerTools.call(selectorOrListener, [previousState]);
            return listenerTools.call(optionalListener, [nextSelection, previousSelection]);
          });
    tools.pushItems(store.listeners, [listener]);
    return nativeFunction("unsubscribe", (_args, unsubscribeTools) => {
      const listenerIndex = store.listeners.items.indexOf(listener);
      if (listenerIndex !== -1) {
        unsubscribeTools.setItem(store.listeners, listenerIndex, UNDEFINED_VALUE);
      }
      return UNDEFINED_VALUE;
    });
  });

const initializeStore = (initializer: StaticValue, tools: StubRenderTools): ZustandStore => {
  const store: ZustandStore = {
    api: objectFromRecord({}),
    initialState: UNDEFINED_VALUE,
    listeners: listValue([]),
    state: createState(),
  };
  const setter = setState(store);
  const getter = nativeFunction("getState", () => getState(store));
  const initialGetter = nativeFunction("getInitialState", () => store.initialState);
  store.api.entries.push(
    { kind: "property", key: "setState", value: setter },
    { kind: "property", key: "getState", value: getter },
    { kind: "property", key: "getInitialState", value: initialGetter },
    { kind: "property", key: "subscribe", value: subscribe(store) },
  );
  const initialState = tools.call(initializer, [setter, getter, store.api]);
  store.initialState = initialState;
  store.state.current = initialState;
  return store;
};

const useStore = (
  store: ZustandStore,
  selector: StaticValue | undefined,
  tools: StubRenderTools,
): StaticValue => {
  return subscribeToExternalStore(
    getObjectProperty(store.api, "subscribe"),
    getObjectProperty(store.api, "getState"),
    selector,
    tools,
  );
};

const bindStore = (store: ZustandStore): StaticValue =>
  lazyProperties(
    nativeFunction("useBoundStore", ([selector], tools) => useStore(store, selector, tools)),
    (key) => getObjectProperty(store.api, key),
  );

const createStore = (initializer: StaticValue | undefined, tools: StubRenderTools): StaticValue =>
  initializer === undefined
    ? nativeFunction("createStore", ([nextInitializer], nextTools) =>
        nextInitializer === undefined
          ? UNDEFINED_VALUE
          : initializeStore(nextInitializer, nextTools).api,
      )
    : initializeStore(initializer, tools).api;

const create = (initializer: StaticValue | undefined, tools: StubRenderTools): StaticValue =>
  initializer === undefined
    ? nativeFunction("create", ([nextInitializer], nextTools) =>
        nextInitializer === undefined
          ? UNDEFINED_VALUE
          : bindStore(initializeStore(nextInitializer, nextTools)),
      )
    : bindStore(initializeStore(initializer, tools));

const middleware = (name: string): StaticValue =>
  nativeFunction(name, ([initializer]) => initializer ?? UNDEFINED_VALUE);

const combine = nativeFunction("combine", ([initialState, initializer]) =>
  nativeFunction("combinedInitializer", (args, tools) => {
    const created = initializer === undefined ? UNDEFINED_VALUE : tools.call(initializer, args);
    return objectValue([
      { kind: "spread", value: initialState ?? objectValue() },
      { kind: "spread", value: created },
    ]);
  }),
);

const redux = nativeFunction("redux", ([reducer, initialState]) =>
  nativeFunction("reduxInitializer", ([set]) => {
    const dispatch = nativeFunction("dispatch", ([action], tools) => {
      const update = nativeFunction("reduxUpdate", ([state], updateTools) =>
        updateTools.call(reducer ?? UNDEFINED_VALUE, [
          state ?? UNDEFINED_VALUE,
          action ?? UNDEFINED_VALUE,
        ]),
      );
      tools.call(set ?? UNDEFINED_VALUE, [update, FALSE_VALUE, action ?? UNDEFINED_VALUE]);
      return action ?? UNDEFINED_VALUE;
    });
    return objectValue([
      { kind: "spread", value: initialState ?? objectValue() },
      { kind: "property", key: "dispatch", value: dispatch },
    ]);
  }),
);

const shallow = nativeFunction("shallow", ([left, right]) =>
  left === undefined || right === undefined
    ? FALSE_VALUE
    : decidedBooleanValue(compareShallowly(left, right), "Zustand shallow comparison"),
);

const useShallow = nativeFunction("useShallow", ([selector]) => selector ?? UNDEFINED_VALUE);

const immer = nativeFunction("immer", ([initializer]) =>
  nativeFunction("immerInitializer", ([set, get, api], tools) => {
    const immerSet = nativeFunction("setState", ([updater, replace, ...args], setTools) => {
      const producedUpdater = !isCallable(updater ?? UNDEFINED_VALUE)
        ? updater
        : nativeFunction("produce", ([state], produceTools) => {
            const draft =
              state?.kind === "object"
                ? objectValue([{ kind: "spread", value: state }])
                : (state ?? UNDEFINED_VALUE);
            const result = produceTools.call(updater ?? UNDEFINED_VALUE, [draft]);
            return isUndefinedValue(result) ? draft : result;
          });
      return setTools.call(set ?? UNDEFINED_VALUE, [
        producedUpdater ?? UNDEFINED_VALUE,
        replace ?? UNDEFINED_VALUE,
        ...args,
      ]);
    });
    if (api?.kind === "object") tools.setProperty(api, "setState", immerSet);
    return tools.call(initializer ?? UNDEFINED_VALUE, [
      immerSet,
      get ?? UNDEFINED_VALUE,
      api ?? UNDEFINED_VALUE,
    ]);
  }),
);

const standaloneUseStore = nativeFunction("useStore", ([api, selector], tools) => {
  if (api?.kind !== "object") return UNDEFINED_VALUE;
  return subscribeToExternalStore(
    getObjectProperty(api, "subscribe"),
    getObjectProperty(api, "getState"),
    selector,
    tools,
  );
});

export const zustandValue: LibraryValueProvider = (specifier, importedName) => {
  if (specifier === "zustand" || specifier === "zustand/react") {
    if (importedName === "create")
      return nativeFunction("create", ([initializer], tools) => create(initializer, tools));
    if (importedName === "createStore")
      return nativeFunction("createStore", ([initializer], tools) =>
        createStore(initializer, tools),
      );
    if (importedName === "useStore") return standaloneUseStore;
    return null;
  }
  if (specifier === "zustand/vanilla" && importedName === "createStore") {
    return nativeFunction("createStore", ([initializer], tools) => createStore(initializer, tools));
  }
  if (specifier === "zustand/middleware") {
    if (importedName === "combine") return combine;
    if (importedName === "redux") return redux;
    if (importedName === "createJSONStorage")
      return nativeFunction("createJSONStorage", () => objectFromRecord({}));
    if (
      importedName === "devtools" ||
      importedName === "persist" ||
      importedName === "subscribeWithSelector" ||
      importedName === "unstable_ssrSafe"
    ) {
      return middleware(importedName);
    }
    return null;
  }
  if (specifier === "zustand/middleware/immer" && importedName === "immer") {
    return immer;
  }
  if (specifier === "zustand/shallow" || specifier === "zustand/react/shallow") {
    if (importedName === "shallow") return shallow;
    if (importedName === "useShallow") return useShallow;
    return null;
  }
  if (specifier === "zustand/vanilla/shallow" && importedName === "shallow") return shallow;
  if (specifier === "zustand/traditional") {
    if (importedName === "createWithEqualityFn")
      return nativeFunction("createWithEqualityFn", ([initializer], tools) =>
        create(initializer, tools),
      );
    if (importedName === "useStoreWithEqualityFn") return standaloneUseStore;
  }
  return null;
};
