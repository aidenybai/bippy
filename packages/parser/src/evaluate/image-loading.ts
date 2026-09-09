import { nativeFunction } from "../frameworks/stubs.js";
import type { StaticAccessor, StaticObjectValue, StaticValue } from "../types.js";
import {
  createEventTarget,
  dispatchEvent,
  type EventDispatchHost,
  type EventTargetModel,
} from "./event-target-model.js";
import {
  NULL_VALUE,
  UNDEFINED_VALUE,
  getObjectProperty,
  primitiveValue,
  unknownPrimitiveValue,
} from "./values.js";

/**
 * `new Image()` as the browser loads it: assigning `src` or `srcset` queues an
 * update of the image data in a microtask, and the fetch settles in a later
 * task with a `load` or `error` event. A same-origin image the dev server
 * serves loads; an empty `src` errors. Any other source (a remote URL, a
 * string the analysis cannot read) settles outside the analysis, so the
 * handlers it reaches escape as code that may run at any time after mount.
 */
export interface ImageLoadHost extends EventDispatchHost {
  schedule: (task: () => void) => void;
  queueMicrotask: (task: () => void) => void;
  setProperty: (
    object: StaticObjectValue,
    key: string,
    value: StaticValue,
    accessor?: StaticAccessor,
  ) => void;
  markEscaped: (value: StaticValue) => void;
  readServedAsset: (url: string) => string | null;
}

type ImageOutcome = "load" | "error" | "unknown";

const IMAGE_EVENT_TYPES = ["load", "error"];
const IMAGE_FILE_EXTENSION = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i;
const DATA_IMAGE_URL = /^data:image\//i;

const toKnownString = (value: StaticValue): string | null =>
  value.kind === "primitive" && typeof value.value === "string" ? value.value : null;

const isImageAvailable = (host: ImageLoadHost, url: string): boolean => {
  if (DATA_IMAGE_URL.test(url)) return true;
  const pathname = url.split(/[?#]/, 1)[0];
  return IMAGE_FILE_EXTENSION.test(pathname) && host.readServedAsset(url) !== null;
};

/** The candidate URLs of a `srcset`: each comma-separated entry's URL before its descriptor. */
const getSourceSetUrls = (sourceSet: string): string[] =>
  sourceSet
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/, 1)[0])
    .filter((url) => url.length > 0);

const selectOutcome = (
  host: ImageLoadHost,
  src: StaticValue,
  srcset: StaticValue,
): ImageOutcome => {
  const knownSrc = toKnownString(src);
  const knownSrcset = toKnownString(srcset);
  if (knownSrc === null || knownSrcset === null) return "unknown";
  const candidates = [...getSourceSetUrls(knownSrcset), ...(knownSrc === "" ? [] : [knownSrc])];
  if (candidates.length === 0) return "error";
  return candidates.every((url) => isImageAvailable(host, url)) ? "load" : "unknown";
};

export const createImageElement = (host: ImageLoadHost, args: StaticValue[]): StaticValue => {
  let isUpdateQueued = false;
  let hasUnknownOutcome = false;
  const escapeIfUnknown = (listener: StaticValue): void => {
    if (hasUnknownOutcome) host.markEscaped(listener);
  };
  const target: EventTargetModel = createEventTarget(
    {
      width: args[0] ?? primitiveValue(0),
      height: args[1] ?? primitiveValue(0),
      naturalWidth: primitiveValue(0),
      naturalHeight: primitiveValue(0),
      complete: primitiveValue(true),
      currentSrc: primitiveValue(""),
      crossOrigin: NULL_VALUE,
      referrerPolicy: primitiveValue(""),
      decoding: primitiveValue("auto"),
      loading: primitiveValue("eager"),
      alt: primitiveValue(""),
    },
    (type, listener) => {
      if (IMAGE_EVENT_TYPES.includes(type)) escapeIfUnknown(listener);
    },
  );
  const image = target.value;
  const defineTrackedProperty = (
    key: string,
    initial: StaticValue,
    onAssign: (value: StaticValue) => void,
  ): void => {
    const accessor: StaticAccessor = {
      get: nativeFunction(key, () => getObjectProperty(image, key)),
      set: nativeFunction(key, ([value = UNDEFINED_VALUE]) => {
        host.setProperty(image, key, value, accessor);
        onAssign(value);
        return UNDEFINED_VALUE;
      }),
    };
    host.setProperty(image, key, initial, accessor);
  };
  const settle = (outcome: ImageOutcome): void => {
    if (outcome === "unknown") {
      hasUnknownOutcome = true;
      for (const type of IMAGE_EVENT_TYPES) {
        host.markEscaped(getObjectProperty(image, `on${type}`));
        for (const listener of target.listeners.get(type) ?? []) host.markEscaped(listener);
      }
      return;
    }
    host.schedule(() => {
      host.setProperty(image, "complete", primitiveValue(true));
      if (outcome === "load") {
        host.setProperty(image, "currentSrc", getObjectProperty(image, "src"));
        for (const dimension of ["naturalWidth", "naturalHeight"]) {
          host.setProperty(
            image,
            dimension,
            unknownPrimitiveValue("number", `HTMLImageElement.${dimension} of the decoded image`),
          );
        }
      }
      dispatchEvent(host, target, outcome);
    });
  };
  const queueUpdate = (): void => {
    host.setProperty(image, "complete", primitiveValue(false));
    if (isUpdateQueued) return;
    isUpdateQueued = true;
    host.queueMicrotask(() => {
      isUpdateQueued = false;
      settle(
        selectOutcome(host, getObjectProperty(image, "src"), getObjectProperty(image, "srcset")),
      );
    });
  };
  for (const key of ["src", "srcset"]) defineTrackedProperty(key, primitiveValue(""), queueUpdate);
  for (const type of IMAGE_EVENT_TYPES) {
    defineTrackedProperty(`on${type}`, NULL_VALUE, escapeIfUnknown);
  }
  return image;
};
