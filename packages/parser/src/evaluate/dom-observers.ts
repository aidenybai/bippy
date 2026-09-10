import type { SourceLocation, StaticObjectValue, StaticValue } from "../types.js";
import type { EvaluationContext } from "./context.js";
import type { Interpreter } from "./interpreter.js";
import { nativeFunction } from "./stubs.js";
import {
  UNDEFINED_VALUE,
  listValue,
  objectFromRecord,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

const OBSERVER_CONSTRUCTOR_NAMES = new Set([
  "MutationObserver",
  "ResizeObserver",
  "IntersectionObserver",
  "PerformanceObserver",
]);

const LAYOUT_OBSERVER_NAMES = new Set(["ResizeObserver", "IntersectionObserver"]);

export const isDomObserverName = (name: string): boolean => OBSERVER_CONSTRUCTOR_NAMES.has(name);

const layoutNumber = (name: string): StaticValue =>
  unknownPrimitiveValue("number", `${name} depends on layout`);

const layoutRect = (name: string): StaticValue =>
  objectFromRecord(
    Object.fromEntries(
      ["x", "y", "width", "height", "top", "right", "bottom", "left"].map((key) => [
        key,
        layoutNumber(`${name}.${key}`),
      ]),
    ),
  );

const layoutBoxSize = (name: string): StaticValue =>
  listValue([
    objectFromRecord({
      inlineSize: layoutNumber(`${name}.inlineSize`),
      blockSize: layoutNumber(`${name}.blockSize`),
    }),
  ]);

/**
 * The entry a layout observer reports for one observed target: the target
 * itself is the one `observe` registered, its boxes are whatever the layout
 * the static document never performs would give.
 */
const createObservedEntry = (name: string, target: StaticValue): StaticValue =>
  name === "ResizeObserver"
    ? objectFromRecord({
        target,
        contentRect: layoutRect("ResizeObserverEntry.contentRect"),
        borderBoxSize: layoutBoxSize("ResizeObserverEntry.borderBoxSize"),
        contentBoxSize: layoutBoxSize("ResizeObserverEntry.contentBoxSize"),
        devicePixelContentBoxSize: layoutBoxSize("ResizeObserverEntry.devicePixelContentBoxSize"),
      })
    : objectFromRecord({
        target,
        time: layoutNumber("IntersectionObserverEntry.time"),
        isIntersecting: unknownPrimitiveValue(
          "boolean",
          "IntersectionObserverEntry.isIntersecting depends on layout",
        ),
        intersectionRatio: layoutNumber("IntersectionObserverEntry.intersectionRatio"),
        boundingClientRect: layoutRect("IntersectionObserverEntry.boundingClientRect"),
        intersectionRect: layoutRect("IntersectionObserverEntry.intersectionRect"),
        rootBounds: unknownValue("IntersectionObserverEntry.rootBounds depends on layout"),
      });

/**
 * `new MutationObserver(callback)` and the other DOM observers. A layout
 * observer (`ResizeObserver`, `IntersectionObserver`) reports each target
 * `observe` registers to the callback, once the layout the analysis never
 * performs has run, so `observe` dispatches the callback as the host would:
 * any number of times before the capture, with an entry for that target. The
 * analysis does not watch the mutations or performance entries the other
 * observers report, so their callbacks may run at times it cannot see (they
 * escape) and `takeRecords` yields records it cannot enumerate; the observer
 * object itself and its methods are certain.
 */
export const createDomObserver = (
  interpreter: Interpreter,
  name: string,
  callback: StaticValue | undefined,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticObjectValue => {
  const isLayoutObserver = LAYOUT_OBSERVER_NAMES.has(name);
  if (callback && !isLayoutObserver) interpreter.markEscaped(callback);
  const noop = (methodName: string): StaticValue =>
    nativeFunction(methodName, () => UNDEFINED_VALUE);
  const observer = objectFromRecord({
    observe: nativeFunction("observe", ([target]) => {
      if (callback && target && isLayoutObserver) {
        interpreter.runHostDispatches(
          callback,
          [listValue([createObservedEntry(name, target)]), observer],
          context,
          location,
        );
      }
      return UNDEFINED_VALUE;
    }),
    unobserve: noop("unobserve"),
    disconnect: noop("disconnect"),
    takeRecords: nativeFunction("takeRecords", () =>
      unknownValue(`records queued by a ${name}`, location),
    ),
  });
  return observer;
};
