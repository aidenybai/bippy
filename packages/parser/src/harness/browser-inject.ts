// Bundled by capture-browser.ts and injected into the page before any app
// script runs so the DevTools hook exists when React initializes.
import type { CapturedQueryCaches, CapturedValue } from "../types.js";
import { createCommitRecorder } from "./commit-recorder.js";
import { toCapturedValue } from "./query-cache.js";
import type { RuntimeSnapshot } from "./snapshot.js";

export interface HarnessGlobals {
  __BIPPY_PARSER_SNAPSHOT__: () => RuntimeSnapshot;
  __BIPPY_PARSER_QUERY_CACHES__: () => CapturedQueryCaches;
  __BIPPY_PARSER_GLOBALS__: (names: string[]) => Record<string, CapturedValue>;
  __BIPPY_PARSER_COMMITS__: () => number;
}

const readWindowGlobals = (names: string[]): Record<string, CapturedValue> => {
  const values: Record<string, CapturedValue> = {};
  for (const name of names) {
    const captured = toCapturedValue(Object(globalThis)[name]);
    if (captured !== undefined) values[name] = captured;
  }
  return values;
};

const recorder = createCommitRecorder();
const target: Partial<HarnessGlobals> = Object(globalThis);
target.__BIPPY_PARSER_SNAPSHOT__ = recorder.snapshot;
target.__BIPPY_PARSER_QUERY_CACHES__ = recorder.queryCaches;
target.__BIPPY_PARSER_GLOBALS__ = readWindowGlobals;
target.__BIPPY_PARSER_COMMITS__ = recorder.commitCount;
