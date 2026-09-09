import type { HostDocument } from "../host/host-document.js";
import type { ImageLoadOutcome, StaticNativeObjectValue, StaticValue } from "../types.js";

/** An image settles by firing one of these once its source has been fetched. */
export const IMAGE_LOAD_EVENTS: ReadonlySet<string> = new Set(["load", "error"]);

/**
 * Whether the source the analysis assigned to an image had an outcome the
 * capture observed; absent while no source has been assigned through the
 * interpreter.
 */
const imageSources = new WeakMap<object, "observed" | "unobserved">();

const isImageElement = (host: HostDocument | null, value: object): boolean =>
  host !== null && host.isInstanceOf(value, "HTMLImageElement") === true;

const isImageValue = (value: StaticValue): value is StaticNativeObjectValue =>
  value.kind === "native-object" && isImageElement(value.host, value.value);

const hasSourceAttribute = (image: object): boolean => {
  const getAttribute: unknown = Reflect.get(image, "getAttribute");
  return typeof getAttribute === "function" && Reflect.apply(getAttribute, image, ["src"]) !== null;
};

/**
 * A `load`/`error` listener on an image whose source is still to come, or came
 * with an observed outcome, runs when that outcome is dispatched rather than
 * escaping now; one on an image whose source the analysis did not see assigned
 * (or saw without an observed outcome) may have run by the snapshot.
 */
export const isAwaitingImageSource = (
  receiver: StaticValue,
  type: StaticValue | undefined,
): boolean => {
  if (type?.kind !== "primitive" || typeof type.value !== "string") return false;
  if (!IMAGE_LOAD_EVENTS.has(type.value) || !isImageValue(receiver)) return false;
  const source = imageSources.get(receiver.value);
  return source === undefined ? !hasSourceAttribute(receiver.value) : source === "observed";
};

/**
 * Records the source assigned to an image and answers how the browser settled
 * it: the event it fired before the snapshot, or null when the capture holds no
 * outcome for that URL (the listeners then may have run by the snapshot).
 */
export const settleImageSource = (
  image: StaticNativeObjectValue,
  source: StaticValue,
  resolveUrl: (url: string) => string | null,
  outcomes: Record<string, ImageLoadOutcome> | undefined,
): "load" | "error" | null => {
  if (!isImageElement(image.host, image.value)) return null;
  const url =
    source.kind === "primitive" && typeof source.value === "string"
      ? resolveUrl(source.value)
      : null;
  const outcome = url === null ? undefined : outcomes?.[url];
  imageSources.set(image.value, outcome === undefined ? "unobserved" : "observed");
  return outcome === undefined ? null : outcome === "loaded" ? "load" : "error";
};
