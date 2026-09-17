import type { SourceLocation } from "../parse/source-types.js";
import type { StaticObjectValue, StaticValue } from "../types.js";
import { nativeFunction } from "./stubs.js";
import { UNDEFINED_VALUE, objectFromRecord, unknownValue } from "./values.js";

export interface DomObserverEvaluator {
  markEscaped: (value: StaticValue) => void;
}

const OBSERVER_CONSTRUCTOR_NAMES = new Set([
  "MutationObserver",
  "ResizeObserver",
  "IntersectionObserver",
  "PerformanceObserver",
]);

export const isDomObserverName = (name: string): boolean => OBSERVER_CONSTRUCTOR_NAMES.has(name);

/**
 * `new MutationObserver(callback)` and the other DOM observers. The analysis
 * does not watch the targets `observe` registers, so the callback may run at
 * times it cannot see (it escapes) and `takeRecords` yields records it cannot
 * enumerate; the observer object itself and its methods are certain.
 */
export const createDomObserver = (
  evaluator: DomObserverEvaluator,
  name: string,
  callback: StaticValue | undefined,
  location: SourceLocation | null,
): StaticObjectValue => {
  if (callback) evaluator.markEscaped(callback);
  const noop = (methodName: string): StaticValue =>
    nativeFunction(methodName, () => UNDEFINED_VALUE);
  return objectFromRecord({
    observe: noop("observe"),
    unobserve: noop("unobserve"),
    disconnect: noop("disconnect"),
    takeRecords: nativeFunction("takeRecords", () =>
      unknownValue(`records queued by a ${name}`, location),
    ),
  });
};
