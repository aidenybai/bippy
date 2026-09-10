import { primitiveValue, UNDEFINED_VALUE } from "../evaluate/values.js";
import { nativeFunction } from "../evaluate/stubs.js";
import type { ExternalValueProvider } from "../types.js";

// `scheduler/src/forks/Scheduler.js`: `unstable_runWithPriority` only swaps the
// current priority level around a synchronous call of the handler and returns
// its result; the priority levels are the constants of `SchedulerPriorities.js`.

export const SCHEDULER_PACKAGES = ["scheduler"];

const PRIORITY_LEVELS: ReadonlyMap<string, number> = new Map([
  ["unstable_NoPriority", 0],
  ["unstable_ImmediatePriority", 1],
  ["unstable_UserBlockingPriority", 2],
  ["unstable_NormalPriority", 3],
  ["unstable_LowPriority", 4],
  ["unstable_IdlePriority", 5],
]);

export const schedulerValue: ExternalValueProvider = (specifier, importedName) => {
  if (specifier !== "scheduler") return null;
  const priorityLevel = PRIORITY_LEVELS.get(importedName);
  if (priorityLevel !== undefined) return primitiveValue(priorityLevel);
  return importedName === "unstable_runWithPriority"
    ? nativeFunction(importedName, ([, eventHandler], tools) =>
        tools.call(eventHandler ?? UNDEFINED_VALUE, []),
      )
    : null;
};
