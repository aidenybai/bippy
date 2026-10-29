import { useSyncExternalStore } from "react";

let storeValue = 0;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => storeValue;

const setStore = (next: number) => {
  storeValue = next;
  listeners.forEach((listener) => listener());
};

export const ModuleStore = () => {
  const value = useSyncExternalStore(subscribe, getSnapshot);
  return (
    <button onClick={() => setStore(value === 1 ? 0 : 1)}>{value === 1 ? "one" : "zero"}</button>
  );
};

declare const counterStore: {
  subscribe: (listener: () => void) => () => void;
  get: () => number;
  bump: () => void;
};

export const DeclaredStore = () => {
  const value = useSyncExternalStore(counterStore.subscribe, counterStore.get);
  return <button onClick={() => counterStore.bump()}>{value === 1 ? "one" : "zero"}</button>;
};
