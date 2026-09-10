import path from "node:path";
import type { StaticNativeObjectValue, StaticValue } from "../types.js";
import type { EvaluationContext } from "./context.js";
import type { Interpreter } from "./interpreter.js";
import { isNullish, objectFromRecord, primitiveValue } from "./values.js";

type ResourceEventType = "load" | "error";

/**
 * The `load`/`error` listeners of an `<img>` the program created and the fetch
 * its `src` started. A fetch whose outcome the analysis decided fires as one
 * task once the current script yields, at the listeners attached by then, as
 * in a browser where the response arrives after the script that set `src`
 * has ended; one it cannot decide lets the listeners escape.
 */
interface ImageLoadState {
  listeners: Map<ResourceEventType, Set<StaticValue>>;
  fetch: object | null;
  isUndecided: boolean;
}

const imageLoadStates = new WeakMap<object, ImageLoadState>();

/** Formats a browser decodes into an `<img>`; a served file of another kind fires `error`. */
const IMAGE_EXTENSIONS = new Set([
  ".apng",
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

const isResourceEventType = (type: string): type is ResourceEventType =>
  type === "load" || type === "error";

const isImageElement = (interpreter: Interpreter, element: StaticNativeObjectValue): boolean =>
  interpreter.hostDocument?.isInstanceOf(element.value, "HTMLImageElement") === true;

const hasSource = (element: object): boolean => {
  const source: unknown = Reflect.get(element, "src");
  return typeof source === "string" && source !== "";
};

/** How the page saw the fetch of `url` end by the snapshot, when the capture recorded it. */
const readCapturedImageOutcome = (
  interpreter: Interpreter,
  url: string,
): ResourceEventType | null => {
  const resolved = interpreter.resolvePageUrl(url);
  const outcome = resolved === null ? undefined : interpreter.pageState?.images?.[resolved];
  if (outcome === undefined) return null;
  return outcome === "loaded" ? "load" : "error";
};

/**
 * How the fetch of `url` ends for an `<img>` the analysis can follow to its
 * bytes: an image data URL or an image file the dev server serves loads; a
 * served file of another kind fails to decode. Anything else (the network, a
 * proxy, a URL the analysis cannot read) ends as the capture saw it end, or
 * stays open when the capture holds no outcome for it.
 */
const decideImageOutcome = (interpreter: Interpreter, url: string): ResourceEventType | null => {
  if (url.startsWith("data:")) return url.startsWith("data:image/") ? "load" : "error";
  const filePath = interpreter.project.findServedFile(url);
  if (filePath === null) return readCapturedImageOutcome(interpreter, url);
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase()) ? "load" : "error";
};

const getImageLoadState = (
  interpreter: Interpreter,
  element: StaticNativeObjectValue,
): ImageLoadState | null => {
  const existing = imageLoadStates.get(element.value);
  if (existing) return existing;
  if (!isImageElement(interpreter, element)) return null;
  const state: ImageLoadState = {
    listeners: new Map(),
    fetch: null,
    isUndecided: hasSource(element.value),
  };
  imageLoadStates.set(element.value, state);
  return state;
};

/**
 * `image.src = url` on an `<img>` the program created: starts its fetch and
 * schedules the `load` or `error` it ends in when the analysis can tell which;
 * otherwise the listeners may run at any point and escape.
 */
export const startImageLoad = (
  interpreter: Interpreter,
  element: StaticNativeObjectValue,
  key: string,
  value: StaticValue,
  context: EvaluationContext,
): void => {
  if (key !== "src") return;
  const state = getImageLoadState(interpreter, element);
  if (!state) return;
  const outcome =
    value.kind === "primitive" && typeof value.value === "string" && value.value !== ""
      ? decideImageOutcome(interpreter, value.value)
      : null;
  if (outcome === null) {
    state.isUndecided = true;
    state.fetch = null;
    for (const listeners of state.listeners.values()) {
      for (const listener of listeners) interpreter.markEscaped(listener);
    }
    state.listeners.clear();
    return;
  }
  const fetch = {};
  state.isUndecided = false;
  state.fetch = fetch;
  const isDeferred = interpreter.timers.isDeferred;
  interpreter.timers.enqueue(() => {
    if (state.fetch !== fetch) return;
    state.fetch = null;
    const event = objectFromRecord({
      type: primitiveValue(outcome),
      target: element,
      currentTarget: element,
    });
    for (const listener of state.listeners.get(outcome) ?? []) {
      if (isDeferred) interpreter.callDeferred(listener, [event], context, null);
      else interpreter.callValue(listener, [event], context, null, { thisValue: element });
    }
  });
};

/**
 * A `load`/`error` listener on an `<img>` whose fetches the analysis decides:
 * it runs with the scheduled event or never, so it does not escape. False when
 * the listener follows the general rules instead: another target, another
 * event, or an image whose fetch the analysis could not follow.
 */
export const registerResourceListener = (
  interpreter: Interpreter,
  receiver: StaticNativeObjectValue,
  type: string,
  listener: StaticValue,
  isRegistration: boolean,
): boolean => {
  if (!isResourceEventType(type)) return false;
  const state = getImageLoadState(interpreter, receiver);
  if (!state || state.isUndecided) return false;
  if (isNullish(listener) === true) return true;
  let listeners = state.listeners.get(type);
  if (!listeners) {
    listeners = new Set();
    state.listeners.set(type, listeners);
  }
  if (isRegistration) listeners.add(listener);
  else listeners.delete(listener);
  return true;
};
