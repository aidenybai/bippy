import {
  FALSE_VALUE,
  TRUE_VALUE,
  UNDEFINED_VALUE,
  compareIdentity,
  compareShallowly,
  getObjectProperty,
  getTruthiness,
  isCallable,
  isNullish,
  mapValue,
  objectFromRecord,
  unknownPrimitiveValue,
  unknownValue,
} from "../evaluate/values.js";
import { nativeFunction } from "../frameworks/stubs.js";
import { subscribeToExternalStore } from "./use-sync-external-store.js";
import type {
  ExternalValueProvider,
  StaticObjectEntry,
  StaticObjectValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";

// TanStack Store is alien-signals underneath: a push/pull graph of linked
// dependency nodes whose propagation dominates any render that touches a
// router. The model keeps the observable contract (`get`, `set`, `subscribe`,
// computed atoms recomputed once a dependency changed, batched notification)
// and drops the graph bookkeeping, which has no effect on the values read.

export const TANSTACK_STORE_PACKAGES = ["@tanstack/store", "@tanstack/react-store"];

const SNAPSHOT_KEY = "_snapshot";

interface AtomDependency {
  atom: ModeledAtom;
  version: number;
}

interface Observer {
  next: StaticValue;
}

interface ModeledAtom {
  value: StaticObjectValue;
  version: number;
  getter: StaticValue | null;
  compare: StaticValue | null;
  dependencies: AtomDependency[] | null;
  observers: Set<Observer>;
}

let trackingStack: ModeledAtom[] = [];
let batchDepth = 0;
const queuedNotifications: Array<() => void> = [];

const isUndefined = (value: StaticValue): boolean =>
  value.kind === "primitive" && value.value === undefined;

const isSameSnapshot = (
  atom: ModeledAtom,
  previous: StaticValue,
  next: StaticValue,
  tools: StubRenderTools,
): boolean =>
  atom.compare
    ? getTruthiness(tools.call(atom.compare, [previous, next])) === true
    : compareIdentity(previous, next) === true;

const readSnapshot = (atom: ModeledAtom): StaticValue =>
  getObjectProperty(atom.value, SNAPSHOT_KEY);

const writeSnapshot = (atom: ModeledAtom, next: StaticValue, tools: StubRenderTools): boolean => {
  const previous = readSnapshot(atom);
  if (!isUndefined(previous) && isSameSnapshot(atom, previous, next, tools)) return false;
  tools.setProperty(atom.value, SNAPSHOT_KEY, next);
  atom.version++;
  return true;
};

const flush = (): void => {
  if (batchDepth > 0) return;
  for (const notification of queuedNotifications.splice(0)) notification();
};

const notify = (atom: ModeledAtom, tools: StubRenderTools): void => {
  for (const observer of atom.observers) {
    queuedNotifications.push(() => {
      tools.call(observer.next, [readSnapshot(atom)]);
    });
  }
  flush();
};

const isStale = (atom: ModeledAtom, tools: StubRenderTools): boolean =>
  atom.dependencies === null ||
  atom.dependencies.some((dependency) => {
    readAtom(dependency.atom, tools);
    return dependency.atom.version !== dependency.version;
  });

const recompute = (atom: ModeledAtom, getter: StaticValue, tools: StubRenderTools): void => {
  const previousStack = trackingStack;
  trackingStack = [...previousStack, atom];
  atom.dependencies = [];
  try {
    const next = tools.call(getter, [readSnapshot(atom)]);
    writeSnapshot(atom, next, tools);
  } finally {
    trackingStack = previousStack;
  }
};

const readAtom = (atom: ModeledAtom, tools: StubRenderTools): StaticValue => {
  if (atom.getter && isStale(atom, tools)) recompute(atom, atom.getter, tools);
  const subscriber = trackingStack.at(-1);
  if (subscriber && subscriber !== atom) {
    subscriber.dependencies?.push({ atom, version: atom.version });
  }
  return readSnapshot(atom);
};

const toObserver = (observerOrFn: StaticValue | undefined): Observer | null => {
  if (observerOrFn === undefined) return null;
  if (observerOrFn.kind === "object") {
    const next = getObjectProperty(observerOrFn, "next");
    return isCallable(next) ? { next } : null;
  }
  return isCallable(observerOrFn) ? { next: observerOrFn } : null;
};

const subscribe = (atom: ModeledAtom): StaticValue =>
  nativeFunction("subscribe", ([observerOrFn]) => {
    const observer = toObserver(observerOrFn);
    if (observer) atom.observers.add(observer);
    return objectFromRecord({
      unsubscribe: nativeFunction("unsubscribe", () => {
        if (observer) atom.observers.delete(observer);
        return UNDEFINED_VALUE;
      }),
    });
  });

const setAtom = (atom: ModeledAtom): StaticValue =>
  nativeFunction("set", ([valueOrFn], tools) => {
    if (valueOrFn === undefined) return UNDEFINED_VALUE;
    const next = isCallable(valueOrFn) ? tools.call(valueOrFn, [readSnapshot(atom)]) : valueOrFn;
    if (writeSnapshot(atom, next, tools)) notify(atom, tools);
    return UNDEFINED_VALUE;
  });

const createAtom = (
  valueOrFn: StaticValue | undefined,
  options: StaticValue | undefined,
): ModeledAtom => {
  const isComputed = isCallable(valueOrFn);
  const compare = options?.kind === "object" ? getObjectProperty(options, "compare") : undefined;
  const atom: ModeledAtom = {
    value: objectFromRecord({
      [SNAPSHOT_KEY]: isComputed ? UNDEFINED_VALUE : (valueOrFn ?? UNDEFINED_VALUE),
    }),
    version: 0,
    getter: isComputed ? valueOrFn : null,
    compare: isCallable(compare) ? compare : null,
    dependencies: null,
    observers: new Set(),
  };
  const members: Record<string, StaticValue> = {
    get: nativeFunction("get", (_args, tools) => readAtom(atom, tools)),
    subscribe: subscribe(atom),
  };
  if (!isComputed) members.set = setAtom(atom);
  atom.value.entries.push(
    ...Object.entries(members).map(([key, value]): StaticObjectEntry => ({
      kind: "property",
      key,
      value,
    })),
  );
  return atom;
};

const batch = nativeFunction("batch", ([fn], tools) => {
  if (fn === undefined) return UNDEFINED_VALUE;
  batchDepth++;
  try {
    tools.call(fn, []);
  } finally {
    batchDepth--;
  }
  flush();
  return UNDEFINED_VALUE;
});

const storeClass = (name: string, isReadonly: boolean): StaticValue =>
  nativeFunction(name, ([valueOrFn]) => {
    const atom = createAtom(valueOrFn, undefined);
    const store: StaticObjectValue = objectFromRecord({
      atom: atom.value,
      get: nativeFunction("get", (_args, tools) => readAtom(atom, tools)),
      subscribe: subscribe(atom),
    });
    store.entries.push({
      kind: "property",
      key: "state",
      value: unknownValue("state read through a store getter"),
      accessor: {
        get: nativeFunction("state", (_args, tools) => readAtom(atom, tools)),
        set: null,
      },
    });
    if (!isReadonly) {
      store.entries.push({ kind: "property", key: "setState", value: setAtom(atom) });
    }
    return store;
  });

const STORE = storeClass("Store", false);
const READONLY_STORE = storeClass("ReadonlyStore", true);

const readStoreSnapshot = (store: StaticValue, tools: StubRenderTools): StaticValue => {
  if (isNullish(store)) return UNDEFINED_VALUE;
  const getter = store.kind === "object" ? getObjectProperty(store, "get") : undefined;
  return isCallable(getter)
    ? tools.call(getter, [])
    : unknownValue("snapshot of a store the analysis did not create");
};

const subscribeToStore = (store: StaticObjectValue): StaticValue =>
  nativeFunction("subscribe", ([listener], tools) => {
    const subscription = tools.call(getObjectProperty(store, "subscribe"), [
      listener ?? UNDEFINED_VALUE,
    ]);
    return subscription.kind === "object"
      ? getObjectProperty(subscription, "unsubscribe")
      : subscription;
  });

const useStore = nativeFunction("useStore", ([store, selector], tools) => {
  if (store === undefined) return UNDEFINED_VALUE;
  const selectorOrNone = isCallable(selector) ? selector : undefined;
  if (store.kind === "object" && isCallable(getObjectProperty(store, "subscribe"))) {
    return subscribeToExternalStore(
      subscribeToStore(store),
      nativeFunction("getSnapshot", (_args, snapshotTools) =>
        readStoreSnapshot(store, snapshotTools),
      ),
      selectorOrNone,
      tools,
    );
  }
  const snapshot = mapValue(store, (alternative) => readStoreSnapshot(alternative, tools));
  return selectorOrNone ? tools.call(selectorOrNone, [snapshot]) : snapshot;
});

const booleanValue = (value: boolean | null, reason: string): StaticValue =>
  value === null ? unknownPrimitiveValue("boolean", reason) : value ? TRUE_VALUE : FALSE_VALUE;

const shallow = nativeFunction("shallow", ([left, right]) =>
  left === undefined || right === undefined
    ? FALSE_VALUE
    : booleanValue(compareShallowly(left, right), "shallow comparison of two objects"),
);

export const tanstackStoreValue: ExternalValueProvider = (specifier, importedName) => {
  if (!TANSTACK_STORE_PACKAGES.includes(specifier)) return null;
  switch (importedName) {
    case "createAtom":
      return nativeFunction(
        importedName,
        ([valueOrFn, options]) => createAtom(valueOrFn, options).value,
      );
    case "createStore":
      return nativeFunction(importedName, ([valueOrFn], tools) =>
        tools.call(isCallable(valueOrFn) ? READONLY_STORE : STORE, [valueOrFn ?? UNDEFINED_VALUE]),
      );
    case "Store":
      return STORE;
    case "ReadonlyStore":
      return READONLY_STORE;
    case "batch":
      return batch;
    case "flush":
      return nativeFunction(importedName, () => {
        flush();
        return UNDEFINED_VALUE;
      });
    case "useStore":
    case "useSelector":
      return specifier === "@tanstack/react-store" ? useStore : null;
    case "shallow":
      return specifier === "@tanstack/react-store" ? shallow : null;
    default:
      return null;
  }
};
