import { ENTRY_PATH } from "./types";

interface DispatcherHook {
  (...hookArguments: unknown[]): unknown;
}

const HARNESS_PATH_PATTERN = /\/conformance\/verifier\//;
const LIBRARY_PATH_PATTERN = /\/node_modules\//;
const STACK_FRAME_PATTERN = /^\s+at .*\bhttps?:\/\//;
const QUEUED_HOOK_NAMES = ["useState", "useReducer", "useSyncExternalStore"];
const QUEUE_FUNCTION_KEYS = ["dispatch", "getSnapshot"];
const DISPATCHER_KEYS = ["H", "current"];

const libraryQueueFunctions = new WeakSet<object>();
const attributedQueueFunctions = new WeakSet<object>();
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

export const isLibraryHookQueue = (queue: unknown): boolean =>
  typeof queue === "object" &&
  queue !== null &&
  QUEUE_FUNCTION_KEYS.some((key) => {
    const queueFunction: unknown = Reflect.get(queue, key);
    return typeof queueFunction === "function" && libraryQueueFunctions.has(queueFunction);
  });

const getQueueFunction = (
  hookName: string,
  hookArguments: unknown[],
  hookResult: unknown,
): unknown => {
  if (hookName === "useSyncExternalStore") return hookArguments[1];
  return Array.isArray(hookResult) ? hookResult[1] : null;
};

const recordHookCaller = (queueFunction: unknown): void => {
  if (typeof queueFunction !== "function" || attributedQueueFunctions.has(queueFunction)) return;
  attributedQueueFunctions.add(queueFunction);
  const [, callerFrame = ""] = getOutsideFrames();
  if (LIBRARY_PATH_PATTERN.test(callerFrame)) libraryQueueFunctions.add(queueFunction);
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
      recordHookCaller(getQueueFunction(hookName, hookArguments, hookResult));
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
