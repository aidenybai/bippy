// Bundled by capture-browser.ts and injected into the page before any app
// script runs so the DevTools hook exists when React initializes.
import { createCommitRecorder } from "./commit-recorder.js";
import type { RuntimeSnapshot } from "./snapshot.js";

export interface HarnessGlobals {
  __BIPPY_PARSER_SNAPSHOT__: () => RuntimeSnapshot;
  __BIPPY_PARSER_COMMITS__: () => number;
}

const recorder = createCommitRecorder();
const target: Partial<HarnessGlobals> = Object(globalThis);
target.__BIPPY_PARSER_SNAPSHOT__ = recorder.snapshot;
target.__BIPPY_PARSER_COMMITS__ = recorder.commitCount;
