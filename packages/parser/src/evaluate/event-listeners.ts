import type { StaticNativeObjectValue, StaticValue } from "../types.js";
import type { HostDocument } from "../host/host-document.js";
import type { HostRealm } from "../host/host-realm.js";
import type { Interpreter } from "./interpreter.js";
import { toNativeArguments } from "./native-values.js";
import { registerResourceListener } from "./resource-loading.js";
import { HISTORY_TRAVERSAL_EVENTS } from "./session-history.js";
import { isNullish, primitiveValue, UNDEFINED_VALUE } from "./values.js";

/**
 * Events only a user gesture dispatches; none fires before the runtime snapshot
 * is captured. Pointer arrival events (`pointerover`, `pointerenter`,
 * `pointermove` and their mouse twins) are included: Chromium only synthesizes
 * them once a real pointer event has told it where the pointer is, which never
 * happens in the headless capture.
 */
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
  "gesturestart",
  "gesturechange",
  "gestureend",
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

/** Fires after `requestFullscreen()`/`exitFullscreen()`, which need transient user activation. */
const FULLSCREEN_EVENTS = new Set(["fullscreenchange", "webkitfullscreenchange"]);

/** The capture viewport never changes, so `window` never fires these before the snapshot. */
const VIEWPORT_EVENTS = new Set(["resize", "orientationchange"]);

/** `storage` fires only in *other* documents sharing the storage area; the capture is one document. */
const CROSS_DOCUMENT_EVENTS = new Set(["storage"]);

/** The captured page stays the visible, foreground tab from load to snapshot. */
const DOCUMENT_VISIBILITY_EVENTS = new Set(["visibilitychange"]);

/** A freshly loaded page sits at its initial scroll offset until a user or script scrolls it. */
const SCROLL_EVENTS = new Set(["scroll", "scrollend"]);

/** Focus and selection move only for a user or a script (`element.focus()`, `Selection.addRange()`); script moves reach the native listeners below. */
const FOCUS_EVENTS = new Set([
  "focus",
  "blur",
  "focusin",
  "focusout",
  "select",
  "selectionchange",
  "selectstart",
]);

/** Browser-dispatched event types are bare words; namespaced names are app-defined and only fire on `dispatchEvent`. */
const isCustomEventType = (type: string): boolean => /[^a-zA-Z]/.test(type);

const isUserDrivenEventType = (type: string): boolean =>
  USER_GESTURE_EVENTS.has(type) ||
  PAGE_UNLOAD_EVENTS.has(type) ||
  SCROLL_EVENTS.has(type) ||
  FOCUS_EVENTS.has(type) ||
  FULLSCREEN_EVENTS.has(type);

/** Components may report a value they settle on at mount through these, unlike a real DOM event. */
const VALUE_EVENTS = new Set(["input", "beforeinput", "change", "select"]);

/**
 * `onClick`, `onKeyDownCapture`, `onDoubleClick`: a React event handler prop
 * named after an event only a user drives, so whichever component it is
 * handed to, it does not run before the runtime snapshot.
 */
export const isUserDrivenEventHandlerProp = (name: string): boolean => {
  const match = /^on([A-Z][a-zA-Z]*?)(Capture)?$/.exec(name);
  if (!match) return false;
  const reactName = match[1].toLowerCase();
  const type = reactName === "doubleclick" ? "dblclick" : reactName;
  return isUserDrivenEventType(type) && !VALUE_EVENTS.has(type);
};

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

const toNativeEventTarget = (
  receiver: StaticValue,
  host: HostDocument | null,
): NativeEventTarget | null => {
  const [native] = toNativeArguments([receiver], host) ?? [];
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

export const isEventTarget = (realm: HostRealm, receiver: StaticValue): boolean =>
  isNativeEventTarget(receiver) ||
  (receiver.kind === "global" && realm.isGlobalInstanceOf(receiver.name, "EventTarget"));

const isEventBeforeCapture = (
  realm: HostRealm,
  receiver: StaticValue,
  type: StaticValue | undefined,
): boolean => {
  if (receiver.kind === "global" && receiver.name === "MediaQueryList") return false;
  if (type?.kind !== "primitive" || typeof type.value !== "string") return true;
  if (
    receiver.kind === "global" &&
    realm.isGlobalAlias(receiver.name) &&
    (VIEWPORT_EVENTS.has(type.value) || CROSS_DOCUMENT_EVENTS.has(type.value))
  ) {
    return false;
  }
  if (
    receiver.kind === "global" &&
    receiver.name === "document" &&
    DOCUMENT_VISIBILITY_EVENTS.has(type.value)
  ) {
    return false;
  }
  return !(isUserDrivenEventType(type.value) || isCustomEventType(type.value));
};

const isHistoryTraversalListener = (
  realm: HostRealm,
  receiver: StaticValue,
  type: StaticValue | undefined,
): boolean =>
  receiver.kind === "global" &&
  realm.isGlobalAlias(receiver.name) &&
  type?.kind === "primitive" &&
  typeof type.value === "string" &&
  HISTORY_TRAVERSAL_EVENTS.has(type.value);

const updateListener = (
  interpreter: Interpreter,
  realm: HostRealm,
  receiver: StaticValue,
  type: StaticValue | undefined,
  listener: StaticValue,
  isRegistration: boolean,
): void => {
  if (isHistoryTraversalListener(realm, receiver, type)) {
    if (isRegistration) interpreter.history.traversalListeners.add(listener);
    else interpreter.history.traversalListeners.delete(listener);
    return;
  }
  const target = toNativeEventTarget(receiver, interpreter.hostDocument);
  const typeName =
    type?.kind === "primitive" && typeof type.value === "string" ? type.value : null;
  if (
    receiver.kind === "native-object" &&
    typeName !== null &&
    registerResourceListener(interpreter, receiver, typeName, listener, isRegistration)
  ) {
    return;
  }
  if (isRegistration && isEventBeforeCapture(realm, receiver, type))
    interpreter.markEscaped(listener);
  if (target && typeName !== null) {
    if (isRegistration) attachNativeListener(interpreter, target, typeName, listener);
    else detachNativeListener(target, typeName, listener);
  }
};

/** Listener registration on `window`/`document`/DOM nodes/`MediaQueryList`; only listeners that may fire before capture escape. */
export const callEventTargetMethod = (
  interpreter: Interpreter,
  realm: HostRealm,
  receiver: StaticValue,
  name: string,
  args: StaticValue[],
): StaticValue | null => {
  if (!EVENT_LISTENER_METHODS.has(name) || !isEventTarget(realm, receiver)) return null;
  const [type, listener] = args;
  if (!listener) return UNDEFINED_VALUE;
  const isRegistration = name === "addEventListener" || name === "addListener";
  updateListener(interpreter, realm, receiver, type, listener, isRegistration);
  return UNDEFINED_VALUE;
};

const eventHandlerProperties = new WeakMap<object, Map<string, StaticValue>>();

/**
 * `target.onload = handler`: the event handler IDL attribute of a DOM node,
 * which registers `handler` for the event named after it in place of the
 * handler set before, or unregisters that one for a nullish value.
 */
export const assignEventHandlerProperty = (
  interpreter: Interpreter,
  realm: HostRealm,
  receiver: StaticNativeObjectValue,
  key: string,
  value: StaticValue,
): boolean => {
  const match = /^on([a-z]+)$/.exec(key);
  if (!match || !(key in receiver.value) || !isNativeEventTarget(receiver)) return false;
  const type = primitiveValue(match[1]);
  let handlers = eventHandlerProperties.get(receiver.value);
  if (!handlers) {
    handlers = new Map();
    eventHandlerProperties.set(receiver.value, handlers);
  }
  const previous = handlers.get(match[1]);
  if (previous) updateListener(interpreter, realm, receiver, type, previous, false);
  if (isNullish(value) === true) {
    handlers.delete(match[1]);
  } else {
    handlers.set(match[1], value);
    updateListener(interpreter, realm, receiver, type, value, true);
  }
  return true;
};
