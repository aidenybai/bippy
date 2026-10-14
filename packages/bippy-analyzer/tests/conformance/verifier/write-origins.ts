import { ENTRY_PATH } from "./types";

interface DispatcherHook {
  (...hookArguments: unknown[]): unknown;
}

const HARNESS_PATH_PATTERN = /\/conformance\/verifier\//;
const LIBRARY_PATH_PATTERN = /\/node_modules\//;
const STACK_FRAME_PATTERN = /^\s+at .*\bhttps?:\/\//;
const QUEUED_HOOK_NAMES = ["useState", "useReducer"];
const DISPATCHER_KEYS = ["H", "current"];

const libraryDispatches = new WeakSet<object>();
const attributedDispatches = new WeakSet<object>();
const patchedDispatchers = new WeakSet<object>();
const watchedDispatcherRefs = new WeakSet<object>();

const isHarnessFrame = (frame: string): boolean =>
  frame.includes(ENTRY_PATH) || HARNESS_PATH_PATTERN.test(frame);

const getOutsideFrames = (): string[] =>
  (new Error().stack ?? "")
    .split("\n")
    .filter((frame) => STACK_FRAME_PATTERN.test(frame) && !isHarnessFrame(frame));

export const isWrittenByLibrary = (): boolean =>
  LIBRARY_PATH_PATTERN.test(getOutsideFrames()[0] ?? "");

export const isLibraryHookDispatch = (dispatch: unknown): boolean =>
  typeof dispatch === "function" && libraryDispatches.has(dispatch);

const recordHookCaller = (hookResult: unknown): void => {
  if (!Array.isArray(hookResult)) return;
  const dispatch: unknown = hookResult[1];
  if (typeof dispatch !== "function" || attributedDispatches.has(dispatch)) return;
  attributedDispatches.add(dispatch);
  const [, callerFrame = ""] = getOutsideFrames();
  if (LIBRARY_PATH_PATTERN.test(callerFrame)) libraryDispatches.add(dispatch);
};

const patchDispatcher = (dispatcher: unknown): void => {
  if (typeof dispatcher !== "object" || dispatcher === null) return;
  if (patchedDispatchers.has(dispatcher)) return;
  patchedDispatchers.add(dispatcher);
  for (const hookName of QUEUED_HOOK_NAMES) {
    const hook: unknown = Reflect.get(dispatcher, hookName);
    if (typeof hook !== "function") continue;
    const recordingHook: DispatcherHook = (...hookArguments) => {
      const hookResult: unknown = Reflect.apply(hook, dispatcher, hookArguments);
      recordHookCaller(hookResult);
      return hookResult;
    };
    Reflect.set(dispatcher, hookName, recordingHook);
  }
};

const watchDispatcherRef = (dispatcherRef: object): void => {
  if (watchedDispatcherRefs.has(dispatcherRef)) return;
  watchedDispatcherRefs.add(dispatcherRef);
  const key = DISPATCHER_KEYS.find((candidate) => Object.hasOwn(dispatcherRef, candidate));
  if (!key) return;
  let dispatcher: unknown = Reflect.get(dispatcherRef, key);
  Object.defineProperty(dispatcherRef, key, {
    configurable: true,
    enumerable: true,
    get: () => dispatcher,
    set: (nextDispatcher: unknown) => {
      patchDispatcher(nextDispatcher);
      dispatcher = nextDispatcher;
    },
  });
};

export const watchHookCallers = (dispatcherRefs: object[]): void => {
  for (const dispatcherRef of dispatcherRefs) watchDispatcherRef(dispatcherRef);
};
