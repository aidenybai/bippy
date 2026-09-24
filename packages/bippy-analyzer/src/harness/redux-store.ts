import type { Fiber, FiberRoot } from "bippy";
import { traverseFiber } from "bippy";
import { isRecord } from "../observations.js";
import type { CapturedValue } from "../types.js";
import type { ExportIndex } from "./module-exports.js";
import { toCapturedValue } from "./query-cache.js";

export interface ReduxStoreLike {
  getState: () => unknown;
}

interface StoreCreator {
  (...args: unknown[]): unknown;
}
interface StoreEnhancer {
  (createStore: StoreCreator): StoreCreator;
}

export const isReduxStore = (value: unknown): value is ReduxStoreLike =>
  isRecord(value) && typeof value.getState === "function" && typeof value.subscribe === "function";

const composeEnhancers =
  (enhancers: StoreEnhancer[]): StoreEnhancer =>
  (createStore) =>
    enhancers.reduceRight((next, enhancer) => enhancer(next), createStore);

/**
 * Every Redux store creation path (redux's `createStore`, Redux Toolkit,
 * kea) composes its enhancers through the DevTools extension hook when the
 * page defines one, which makes that hook the one place to see the stores a
 * page creates without touching its code. Must run before the app's scripts.
 */
export const installReduxStoreHook = (host: object): (() => ReduxStoreLike[]) => {
  const stores: ReduxStoreLike[] = [];
  const recordingCompose = (...enhancers: unknown[]): StoreEnhancer => {
    const composed = composeEnhancers(
      enhancers.filter((enhancer): enhancer is StoreEnhancer => typeof enhancer === "function"),
    );
    return (createStore) =>
      (...args) => {
        const store = composed(createStore)(...args);
        if (isReduxStore(store)) stores.push(store);
        return store;
      };
  };
  Object.assign(host, {
    __REDUX_DEVTOOLS_EXTENSION_COMPOSE__: (...args: unknown[]) =>
      args.length === 1 && typeof args[0] !== "function"
        ? recordingCompose
        : recordingCompose(...args),
  });
  return () => [...stores];
};

const getProviderStore = (fiber: Fiber): ReduxStoreLike | null => {
  const props: unknown = fiber.memoizedProps;
  if (!isRecord(props) || !isRecord(props.value)) return null;
  return isReduxStore(props.value.store) ? props.value.store : null;
};

/** The stores react-redux `Provider`s hand down through `ReactReduxContext` (`{ store, subscription }`). */
export const readProviderStores = (roots: FiberRoot[]): ReduxStoreLike[] => {
  const stores: ReduxStoreLike[] = [];
  for (const root of roots) {
    traverseFiber(root.current, (fiber) => {
      const store = getProviderStore(fiber);
      if (store && !stores.includes(store)) stores.push(store);
      return false;
    });
  }
  return stores;
};

export const captureStores = (stores: ReduxStoreLike[], exports: ExportIndex): CapturedValue[] =>
  stores.map((store) => toCapturedValue(store.getState(), exports) ?? null);
