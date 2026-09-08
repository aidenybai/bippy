import type { StaticValue } from "../types.js";
import { isWindowAlias } from "./browser-globals.js";
import type { Interpreter } from "./interpreter.js";
import { toNativeArguments } from "./native-values.js";
import { UNDEFINED_VALUE } from "./values.js";

/** Events only a user gesture dispatches; none fires before the runtime snapshot is captured. */
const USER_GESTURE_EVENTS = new Set([
  "keydown",
  "keyup",
  "keypress",
  "click",
  "dblclick",
  "auxclick",
  "contextmenu",
  "mousedown",
  "mouseup",
  "mousemove",
  "mouseenter",
  "mouseleave",
  "mouseover",
  "mouseout",
  "pointerdown",
  "pointerup",
  "pointermove",
  "pointerenter",
  "pointerleave",
  "pointerover",
  "pointerout",
  "pointercancel",
  "touchstart",
  "touchend",
  "touchmove",
  "touchcancel",
  "wheel",
  "drag",
  "dragstart",
  "dragend",
  "dragenter",
  "dragleave",
  "dragover",
  "drop",
  "input",
  "beforeinput",
  "change",
  "compositionstart",
  "compositionupdate",
  "compositionend",
  "copy",
  "cut",
  "paste",
]);

/** Events the browser dispatches only when the page is being left, after any snapshot. */
const PAGE_UNLOAD_EVENTS = new Set(["pagehide", "beforeunload", "unload"]);

/** The capture viewport never changes, so `window` never fires these before the snapshot. */
const VIEWPORT_EVENTS = new Set(["resize", "orientationchange"]);

/** `storage` fires only in *other* documents sharing the storage area; the capture is one document. */
const CROSS_DOCUMENT_EVENTS = new Set(["storage"]);

/** A freshly loaded page sits at its initial scroll offset until a user or script scrolls it. */
const SCROLL_EVENTS = new Set(["scroll", "scrollend"]);

/** Focus and selection move only for a user or a script (`element.focus()`, `Selection.addRange()`); script moves reach the native listeners below. */
const FOCUS_EVENTS = new Set([
  "focus",
  "blur",
  "focusin",
  "focusout",
  "selectionchange",
  "selectstart",
]);

/** Browser-dispatched event types are bare words; namespaced names are app-defined and only fire on `dispatchEvent`. */
const isCustomEventType = (type: string): boolean => /[^a-zA-Z]/.test(type);

const EVENT_TARGET_GLOBALS = new Set(["window", "globalThis", "document", "MediaQueryList"]);

export interface NativeEventTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

// happy-dom nodes come from the renderer's own `EventTarget`, not this realm's.
const isNativeEventTargetObject = (value: unknown): value is NativeEventTarget =>
  typeof value === "object" &&
  value !== null &&
  "addEventListener" in value &&
  typeof value.addEventListener === "function" &&
  "removeEventListener" in value &&
  typeof value.removeEventListener === "function";

const isNativeEventTarget = (receiver: StaticValue): boolean =>
  receiver.kind === "native-object" && isNativeEventTargetObject(receiver.value);

const toNativeEventTarget = (receiver: StaticValue): NativeEventTarget | null => {
  const [native] = toNativeArguments([receiver]) ?? [];
  return isNativeEventTargetObject(native) ? native : null;
};

/**
 * Real listeners standing in for interpreted ones, per target, listener and
 * type: an event the program dispatches itself (`element.focus()`, React's
 * `autoFocus`, `dispatchEvent`) reaches its handler through the DOM, so the
 * handler escapes exactly when such a dispatch happens.
 */
const nativeListeners = new WeakMap<NativeEventTarget, Map<StaticValue, Map<string, () => void>>>();

const attachNativeListener = (
  interpreter: Interpreter,
  target: NativeEventTarget,
  type: string,
  listener: StaticValue,
): void => {
  let byListener = nativeListeners.get(target);
  if (!byListener) {
    byListener = new Map();
    nativeListeners.set(target, byListener);
  }
  let byType = byListener.get(listener);
  if (!byType) {
    byType = new Map();
    byListener.set(listener, byType);
  }
  if (byType.has(type)) return;
  const native = (): void => interpreter.markEscaped(listener);
  byType.set(type, native);
  target.addEventListener(type, native);
};

const detachNativeListener = (
  target: NativeEventTarget,
  type: string,
  listener: StaticValue,
): void => {
  const byType = nativeListeners.get(target)?.get(listener);
  const native = byType?.get(type);
  if (!byType || !native) return;
  byType.delete(type);
  target.removeEventListener(type, native);
};

export const EVENT_LISTENER_METHODS = new Set([
  "addEventListener",
  "removeEventListener",
  "addListener",
  "removeListener",
]);

export const isEventTarget = (receiver: StaticValue): boolean =>
  isNativeEventTarget(receiver) ||
  (receiver.kind === "global" && EVENT_TARGET_GLOBALS.has(receiver.name));

const isEventBeforeCapture = (receiver: StaticValue, type: StaticValue | undefined): boolean => {
  if (receiver.kind === "global" && receiver.name === "MediaQueryList") return false;
  if (type?.kind !== "primitive" || typeof type.value !== "string") return true;
  if (
    receiver.kind === "global" &&
    isWindowAlias(receiver.name) &&
    (VIEWPORT_EVENTS.has(type.value) || CROSS_DOCUMENT_EVENTS.has(type.value))
  ) {
    return false;
  }
  return !(
    USER_GESTURE_EVENTS.has(type.value) ||
    PAGE_UNLOAD_EVENTS.has(type.value) ||
    SCROLL_EVENTS.has(type.value) ||
    FOCUS_EVENTS.has(type.value) ||
    isCustomEventType(type.value)
  );
};

/** Listener registration on `window`/`document`/DOM nodes/`MediaQueryList`; only listeners that may fire before capture escape. */
export const callEventTargetMethod = (
  interpreter: Interpreter,
  receiver: StaticValue,
  name: string,
  args: StaticValue[],
): StaticValue | null => {
  if (!EVENT_LISTENER_METHODS.has(name) || !isEventTarget(receiver)) return null;
  const [type, listener] = args;
  if (!listener) return UNDEFINED_VALUE;
  const isRegistration = name === "addEventListener" || name === "addListener";
  if (isRegistration && isEventBeforeCapture(receiver, type)) interpreter.markEscaped(listener);
  const target = toNativeEventTarget(receiver);
  if (target && type?.kind === "primitive" && typeof type.value === "string") {
    if (isRegistration) attachNativeListener(interpreter, target, type.value, listener);
    else detachNativeListener(target, type.value, listener);
  }
  return UNDEFINED_VALUE;
};
