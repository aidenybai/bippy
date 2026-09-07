import { isReduxStore, type ReduxStoreLike } from "./redux-store.js";

// kea keeps its Redux store in a module-private context (`getContext().store`)
// and apps may hand it a plain `compose`, bypassing the DevTools hook. Vite's
// dev server serves each dependency as one module per URL, so importing the
// URL the page already loaded for kea yields the same module instance and
// with it the live context.
const KEA_MODULE_URL = /\/(?:\.vite\/deps\/kea|kea\/lib\/index(?:\.esm)?)\.js(?:\?|$)/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getContextStore = (module: unknown): ReduxStoreLike | null => {
  if (!isRecord(module) || typeof module.getContext !== "function") return null;
  const context: unknown = module.getContext();
  return isRecord(context) && isReduxStore(context.store) ? context.store : null;
};

export const readKeaStores = async (): Promise<ReduxStoreLike[]> => {
  if (typeof performance === "undefined") return [];
  const urls = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((name) => KEA_MODULE_URL.test(name));
  const stores: ReduxStoreLike[] = [];
  for (const url of new Set(urls)) {
    try {
      const store = getContextStore(await import(/* @vite-ignore */ url));
      if (store && !stores.includes(store)) stores.push(store);
    } catch {
      // the URL was not an importable module
    }
  }
  return stores;
};
