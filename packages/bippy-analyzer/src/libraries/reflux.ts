import { objectValue } from "../evaluate/values.js";
import { nativeFunction, noopFunction } from "../evaluate/stubs.js";
import type { ExternalValueProvider, StaticObjectEntry, StaticValue } from "../types.js";

// `createStore(definition)` (reflux-core) copies the definition onto a store
// whose methods are bound to it, then runs `init()`. The store's own methods
// mutate `this.state`; the emitter side only notifies listeners.

export const REFLUX_PACKAGES = ["reflux"];

const createStore = (): StaticValue =>
  nativeFunction("createStore", ([definition], tools) => {
    const store = objectValue([
      {
        kind: "property",
        key: "listen",
        value: nativeFunction("listen", () => noopFunction("unlisten")),
      },
      { kind: "property", key: "listenTo", value: noopFunction("listenTo") },
      { kind: "property", key: "listenToMany", value: noopFunction("listenToMany") },
      { kind: "property", key: "trigger", value: noopFunction("trigger") },
    ]);
    if (definition?.kind !== "object") return store;
    for (const entry of definition.entries) store.entries.push(bindToStore(entry, store));
    for (const entry of store.entries) {
      if (entry.kind === "property" && entry.key === "init") tools.call(entry.value, []);
    }
    return store;
  });

const bindToStore = (entry: StaticObjectEntry, store: StaticValue): StaticObjectEntry =>
  entry.kind === "property" && entry.value.kind === "function"
    ? { ...entry, value: { ...entry.value, thisValue: store } }
    : entry;

export const refluxValue: ExternalValueProvider = (specifier, importedName) =>
  specifier === "reflux" && importedName === "createStore" ? createStore() : null;
