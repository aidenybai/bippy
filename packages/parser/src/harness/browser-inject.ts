// Bundled by capture-browser.ts and injected into the page before any app
// script runs so the DevTools hook exists when React initializes.
import type { CapturedPageState, CapturedValue, RootObservations } from "../types.js";
import { createCommitRecorder } from "./commit-recorder.js";
import { readKeaStores } from "./kea-store.js";
import { readModuleExports } from "./module-exports.js";
import { toCapturedValue } from "./query-cache.js";
import { installReduxStoreHook } from "./redux-store.js";
import type { RuntimeSnapshot } from "./snapshot.js";

export interface HarnessGlobals {
  __BIPPY_PARSER_SNAPSHOT__: () => RuntimeSnapshot;
  __BIPPY_PARSER_OBSERVATIONS__: () => Promise<RootObservations>;
  __BIPPY_PARSER_GLOBALS__: (names: string[]) => Promise<Record<string, CapturedValue>>;
  __BIPPY_PARSER_PAGE__: () => CapturedPageState;
  __BIPPY_PARSER_COMMITS__: () => number;
}

const RESOURCE_TIMING_BUFFER_SIZE = 100_000;

const readWindowGlobals = async (names: string[]): Promise<Record<string, CapturedValue>> => {
  const exports = await readModuleExports();
  const values: Record<string, CapturedValue> = {};
  for (const name of names) {
    const captured = toCapturedValue(Object(globalThis)[name], exports);
    if (captured !== undefined) values[name] = captured;
  }
  return values;
};

const readStorageArea = (area: Storage): Record<string, string> => {
  const entries: Record<string, string> = {};
  for (let index = 0; index < area.length; index++) {
    const key = area.key(index);
    const stored = key === null ? null : area.getItem(key);
    if (key !== null && stored !== null) entries[key] = stored;
  }
  return entries;
};

const initialHistoryState = toCapturedValue(history.state) ?? null;

const readWindowKeys = (): string[] => {
  const names = new Set<string>();
  for (let object: unknown = globalThis; object; object = Object.getPrototypeOf(object)) {
    for (const name of Object.getOwnPropertyNames(object)) names.add(name);
  }
  return [...names];
};
const initialWindowKeys = readWindowKeys();

const readPageState = (): CapturedPageState => ({
  cookie: document.cookie,
  name: window.name,
  historyState: initialHistoryState,
  windowKeys: initialWindowKeys,
  userAgent: navigator.userAgent,
  language: navigator.language,
  localStorage: readStorageArea(localStorage),
  sessionStorage: readStorageArea(sessionStorage),
});

// The default resource timing buffer (250 entries) holds a fraction of a dev
// server's per-file module loads, and the loaded-module list is how the
// harness finds the page's stores and exports.
performance.setResourceTimingBufferSize(RESOURCE_TIMING_BUFFER_SIZE);
const readHookedStores = installReduxStoreHook(globalThis);
const recorder = createCommitRecorder({
  reduxStores: async () => [...readHookedStores(), ...(await readKeaStores())],
  moduleExports: readModuleExports,
});
const target: Partial<HarnessGlobals> = Object(globalThis);
target.__BIPPY_PARSER_SNAPSHOT__ = recorder.snapshot;
target.__BIPPY_PARSER_OBSERVATIONS__ = recorder.observations;
target.__BIPPY_PARSER_GLOBALS__ = readWindowGlobals;
target.__BIPPY_PARSER_PAGE__ = readPageState;
target.__BIPPY_PARSER_COMMITS__ = recorder.commitCount;
