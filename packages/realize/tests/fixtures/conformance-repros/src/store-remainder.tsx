import * as ReactNamespace from "react";
import React, { useSyncExternalStore } from "react";

let storeValue = 0;
const listeners = new Set<() => void>();

const store = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: () => storeValue,
  bump() {
    storeValue = storeValue === 1 ? 0 : 1;
    listeners.forEach((listener) => listener());
  },
};

export const StoreMethodHandler = () => {
  const value = useSyncExternalStore(store.subscribe, store.get);
  return <button onClick={store.bump}>{value === 1 ? "one" : "zero"}</button>;
};

export const NamespaceStore = () => {
  const value = ReactNamespace.useSyncExternalStore(store.subscribe, store.get);
  return <button onClick={() => store.bump()}>{value === 1 ? "one" : "zero"}</button>;
};

export const DefaultImportStore = () => {
  const value = React.useSyncExternalStore(store.subscribe, store.get);
  return <button onClick={() => store.bump()}>{value === 1 ? "one" : "zero"}</button>;
};
