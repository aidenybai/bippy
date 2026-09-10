import {
  TRUE_VALUE,
  UNDEFINED_VALUE,
  compareIdentity,
  getKnownObjectKeys,
  getObjectProperty,
  getTruthiness,
  isFunctionValue,
  isNullish,
  mapValue,
  objectFromRecord,
  unknownValue,
} from "../evaluate/values.js";
import { nativeFunction } from "../evaluate/stubs.js";
import type {
  LibraryValueProvider,
  ModeledExports,
  LibraryRun,
  StaticObjectValue,
  StaticValue,
  StubRenderTools,
} from "../types.js";

// Jotai's store is a dependency graph of atom states whose epoch bookkeeping,
// continuable promises and mount/unmount cascades dominate any render reading
// an atom. The model keeps the store contract (`get`, `set`, `sub`, derived
// atoms recomputed once a dependency changed, `onMount` on first subscription,
// listeners notified after a write) and drops the graph bookkeeping. Atom
// creation and the hooks stay analyzed from `jotai/vanilla` and `jotai/react`.

const STORE_SPECIFIERS = ["jotai", "jotai/vanilla"];
const STORE_EXPORTS = ["createStore", "getDefaultStore"];

export const JOTAI_PACKAGES = ["jotai"];

export const JOTAI_MODELED_EXPORTS: ModeledExports = Object.fromEntries(
  STORE_SPECIFIERS.map((specifier): [string, string[]] => [specifier, STORE_EXPORTS]),
);

const VALUE_KEY = "value";
const IS_INITIALIZED_KEY = "isInitialized";

interface MountedAtom {
  listeners: Set<StaticValue>;
  dependencies: Set<AtomRecord>;
  dependents: Set<AtomRecord>;
  onUnmount: StaticValue | null;
}

interface AtomRecord {
  atom: StaticObjectValue;
  /** Holds the atom's value as heap properties so a fork undoes writes made on its other paths. */
  cell: StaticObjectValue;
  epoch: number;
  dependencies: Map<AtomRecord, number>;
  mounted: MountedAtom | null;
}

interface Store {
  records: Map<number, AtomRecord>;
  changed: Set<AtomRecord>;
  pendingFunctions: Array<() => void>;
}

const hasInitialValue = (atom: StaticObjectValue): boolean =>
  getKnownObjectKeys(atom)?.includes("init") ?? false;

const isInitialized = (record: AtomRecord): boolean =>
  getTruthiness(getObjectProperty(record.cell, IS_INITIALIZED_KEY)) === true;

const readValue = (record: AtomRecord): StaticValue => getObjectProperty(record.cell, VALUE_KEY);

const getRecord = (store: Store, atom: StaticObjectValue): AtomRecord | null => {
  if (atom.allocation === undefined) return null;
  let record = store.records.get(atom.allocation);
  if (!record) {
    record = {
      atom,
      cell: objectFromRecord({
        [VALUE_KEY]: UNDEFINED_VALUE,
        [IS_INITIALIZED_KEY]: UNDEFINED_VALUE,
      }),
      epoch: 0,
      dependencies: new Map(),
      mounted: null,
    };
    store.records.set(atom.allocation, record);
  }
  return record;
};

const setValue = (record: AtomRecord, next: StaticValue, tools: StubRenderTools): boolean => {
  const isSameValue = isInitialized(record) && compareIdentity(readValue(record), next) === true;
  tools.setProperty(record.cell, VALUE_KEY, next);
  tools.setProperty(record.cell, IS_INITIALIZED_KEY, TRUE_VALUE);
  if (isSameValue) return false;
  record.epoch++;
  return true;
};

const isSelfAtom = (record: AtomRecord, atom: StaticValue): boolean =>
  atom.kind === "object" && atom.allocation === record.atom.allocation;

const areDependenciesFresh = (store: Store, record: AtomRecord, tools: StubRenderTools): boolean =>
  [...record.dependencies].every(
    ([dependency, epoch]) => readAtomState(store, dependency, tools).epoch === epoch,
  );

const readAtomState = (
  store: Store,
  record: AtomRecord,
  tools: StubRenderTools,
  isForced = false,
): AtomRecord => {
  if (
    !isForced &&
    isInitialized(record) &&
    (record.mounted || areDependenciesFresh(store, record, tools))
  ) {
    return record;
  }
  record.dependencies.clear();
  const getter = nativeFunction("get", ([dependencyAtom]) => {
    if (dependencyAtom === undefined) return UNDEFINED_VALUE;
    if (isSelfAtom(record, dependencyAtom)) {
      if (!isInitialized(record)) {
        if (!hasInitialValue(record.atom)) return unknownValue("no atom init");
        setValue(record, getObjectProperty(record.atom, "init"), tools);
      }
      return readValue(record);
    }
    return readAtom(store, dependencyAtom, (dependency) => {
      readAtomState(store, dependency, tools);
      record.dependencies.set(dependency, dependency.epoch);
      dependency.mounted?.dependents.add(record);
    });
  });
  const options = objectFromRecord({
    signal: unknownValue("AbortSignal of an atom read"),
    setSelf: nativeFunction("setSelf", (args, selfTools) =>
      writeAtomState(store, record, args, selfTools),
    ),
  });
  const read = getObjectProperty(record.atom, "read");
  const next = isFunctionValue(read)
    ? tools.call(read, [getter, options], record.atom)
    : unknownValue("atom without a read function");
  setValue(record, next, tools);
  return record;
};

const readAtom = (
  store: Store,
  atom: StaticValue,
  onRecord: (record: AtomRecord) => void,
): StaticValue =>
  mapValue(atom, (alternative) => {
    const record = alternative.kind === "object" ? getRecord(store, alternative) : null;
    if (!record) return unknownValue("value of an atom the analysis did not create");
    onRecord(record);
    return readValue(record);
  });

const collectDependents = (record: AtomRecord, sorted: AtomRecord[], marked: Set<AtomRecord>) => {
  if (marked.has(record)) return;
  marked.add(record);
  for (const dependent of record.mounted?.dependents ?? [])
    collectDependents(dependent, sorted, marked);
  sorted.push(record);
};

const recomputeDependents = (store: Store, record: AtomRecord, tools: StubRenderTools): void => {
  const sorted: AtomRecord[] = [];
  collectDependents(record, sorted, new Set());
  const changed = new Set([record]);
  for (const dependent of sorted.reverse()) {
    if (dependent === record) continue;
    const hasChangedDependency = [...dependent.dependencies.keys()].some((dependency) =>
      changed.has(dependency),
    );
    if (!hasChangedDependency) continue;
    const previousEpoch = dependent.epoch;
    readAtomState(store, dependent, tools, true);
    mountDependencies(store, dependent, tools);
    if (dependent.epoch !== previousEpoch) {
      changed.add(dependent);
      store.changed.add(dependent);
    }
  }
};

const flushPending = (store: Store, tools: StubRenderTools): void => {
  while (store.changed.size > 0 || store.pendingFunctions.length > 0) {
    const changed = [...store.changed];
    store.changed.clear();
    const pendingFunctions = store.pendingFunctions.splice(0);
    for (const record of changed) {
      for (const listener of record.mounted?.listeners ?? []) tools.call(listener, []);
    }
    for (const pendingFunction of pendingFunctions) pendingFunction();
  }
};

const writeAtomState = (
  store: Store,
  record: AtomRecord,
  args: StaticValue[],
  tools: StubRenderTools,
): StaticValue => {
  const getter = nativeFunction("get", ([dependencyAtom]) =>
    dependencyAtom === undefined
      ? UNDEFINED_VALUE
      : readAtom(store, dependencyAtom, (dependency) => readAtomState(store, dependency, tools)),
  );
  const setter = nativeFunction("set", ([targetAtom, ...setterArgs]) => {
    if (targetAtom === undefined) return UNDEFINED_VALUE;
    const result = mapValue(targetAtom, (alternative) => {
      const target = alternative.kind === "object" ? getRecord(store, alternative) : null;
      if (!target) return unknownValue("write to an atom the analysis did not create");
      if (!isSelfAtom(record, alternative)) return writeAtomState(store, target, setterArgs, tools);
      if (!hasInitialValue(target.atom)) return unknownValue("atom not writable");
      if (setValue(target, setterArgs[0] ?? UNDEFINED_VALUE, tools)) {
        mountDependencies(store, target, tools);
        store.changed.add(target);
        recomputeDependents(store, target, tools);
      }
      return UNDEFINED_VALUE;
    });
    flushPending(store, tools);
    return result;
  });
  const write = getObjectProperty(record.atom, "write");
  return isFunctionValue(write)
    ? tools.call(write, [getter, setter, ...args], record.atom)
    : unknownValue("atom not writable");
};

const writeAtom = (
  store: Store,
  atom: StaticValue,
  args: StaticValue[],
  tools: StubRenderTools,
): StaticValue => {
  const result = mapValue(atom, (alternative) => {
    const record = alternative.kind === "object" ? getRecord(store, alternative) : null;
    return record
      ? writeAtomState(store, record, args, tools)
      : unknownValue("write to an atom the analysis did not create");
  });
  flushPending(store, tools);
  return result;
};

const mountDependencies = (store: Store, record: AtomRecord, tools: StubRenderTools): void => {
  const { mounted } = record;
  if (!mounted) return;
  for (const dependency of record.dependencies.keys()) {
    if (mounted.dependencies.has(dependency)) continue;
    mountAtom(store, dependency, tools).dependents.add(record);
    mounted.dependencies.add(dependency);
  }
  for (const dependency of mounted.dependencies) {
    if (record.dependencies.has(dependency)) continue;
    unmountAtom(store, dependency, tools)?.dependents.delete(record);
    mounted.dependencies.delete(dependency);
  }
};

const mountAtom = (store: Store, record: AtomRecord, tools: StubRenderTools): MountedAtom => {
  if (record.mounted) return record.mounted;
  readAtomState(store, record, tools);
  const mounted: MountedAtom = {
    listeners: new Set(),
    dependencies: new Set(record.dependencies.keys()),
    dependents: new Set(),
    onUnmount: null,
  };
  for (const dependency of record.dependencies.keys()) {
    mountAtom(store, dependency, tools).dependents.add(record);
  }
  record.mounted = mounted;
  const onMount = getObjectProperty(record.atom, "onMount");
  if (hasInitialValue(record.atom) && isFunctionValue(onMount)) {
    store.pendingFunctions.push(() => {
      const setSelf = nativeFunction("setAtom", (args, selfTools) =>
        writeAtomState(store, record, args, selfTools),
      );
      const onUnmount = tools.call(onMount, [setSelf], record.atom);
      if (isFunctionValue(onUnmount)) mounted.onUnmount = onUnmount;
    });
  }
  return mounted;
};

const unmountAtom = (
  store: Store,
  record: AtomRecord,
  tools: StubRenderTools,
): MountedAtom | null => {
  const { mounted } = record;
  if (!mounted) return null;
  const hasMountedDependent = [...mounted.dependents].some((dependent) => dependent.mounted);
  if (mounted.listeners.size > 0 || hasMountedDependent) return mounted;
  if (mounted.onUnmount) {
    const { onUnmount } = mounted;
    store.pendingFunctions.push(() => {
      tools.call(onUnmount, []);
    });
  }
  record.mounted = null;
  for (const dependency of record.dependencies.keys()) {
    unmountAtom(store, dependency, tools)?.dependents.delete(record);
  }
  return null;
};

const subscribeAtom = (
  store: Store,
  atom: StaticValue,
  listener: StaticValue,
  tools: StubRenderTools,
): StaticValue => {
  const record = atom.kind === "object" ? getRecord(store, atom) : null;
  if (!record) return unknownValue("subscription to an atom the analysis did not create");
  const mounted = mountAtom(store, record, tools);
  flushPending(store, tools);
  mounted.listeners.add(listener);
  return nativeFunction("unsubscribe", (_args, unsubscribeTools) => {
    mounted.listeners.delete(listener);
    unmountAtom(store, record, unsubscribeTools);
    flushPending(store, unsubscribeTools);
    return UNDEFINED_VALUE;
  });
};

const createStore = (): StaticValue => {
  const store: Store = { records: new Map(), changed: new Set(), pendingFunctions: [] };
  return objectFromRecord({
    get: nativeFunction("get", ([atom], tools) =>
      atom === undefined || isNullish(atom)
        ? UNDEFINED_VALUE
        : readAtom(store, atom, (record) => readAtomState(store, record, tools)),
    ),
    set: nativeFunction("set", ([atom, ...args], tools) =>
      atom === undefined ? UNDEFINED_VALUE : writeAtom(store, atom, args, tools),
    ),
    sub: nativeFunction("sub", ([atom, listener], tools) =>
      atom === undefined || listener === undefined || !isFunctionValue(listener)
        ? UNDEFINED_VALUE
        : subscribeAtom(store, atom, listener, tools),
    ),
  });
};

const defaultStores = new WeakMap<LibraryRun, StaticValue>();

const getDefaultStore = (run: LibraryRun): StaticValue => {
  let store = defaultStores.get(run);
  if (!store) {
    store = createStore();
    defaultStores.set(run, store);
  }
  return store;
};

export const jotaiValue: LibraryValueProvider = (specifier, importedName, run) => {
  if (!STORE_SPECIFIERS.includes(specifier)) return null;
  switch (importedName) {
    case "createStore":
      return nativeFunction(importedName, createStore);
    case "getDefaultStore":
      return nativeFunction(importedName, () => getDefaultStore(run));
    default:
      return null;
  }
};
