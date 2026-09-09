import type { SourceLocation, StaticValue } from "../types.js";
import type { HostDocument } from "../host/host-document.js";
import { type HostRealm, loadHostRealm } from "../host/host-realm.js";
import type { EvaluationContext } from "./context.js";
import type { Interpreter } from "./interpreter.js";
import { toNativeArguments } from "./native-values.js";
import { HISTORY_TRAVERSAL_EVENTS } from "./session-history.js";
import { UNDEFINED_VALUE, getObjectProperty, unknownValue } from "./values.js";

/**
 * Event interfaces only an input device dispatches (lib.dom's `UIEvent` family
 * minus `UIEvent` itself, which also types `resize` and `load`): whichever
 * event the DOM declares with one of them never fires before the runtime
 * snapshot. Pointer arrival events (`pointerover`, `pointerenter`,
 * `pointermove` and their mouse twins) are covered: Chromium only synthesizes
 * them once a real pointer event has told it where the pointer is, which never
 * happens in the headless capture. Focus moves only for a user or a script
 * (`element.focus()`); script moves reach the native listeners below.
 */
const INPUT_DEVICE_EVENT_INTERFACES = [
  "KeyboardEvent",
  "MouseEvent",
  "TouchEvent",
  "InputEvent",
  "CompositionEvent",
  "ClipboardEvent",
  "FocusEvent",
];

/** Events the browser dispatches only when the page is being left, after any snapshot. */
const PAGE_UNLOAD_EVENTS = new Set(["pagehide", "beforeunload", "unload"]);

/** Fires after `requestFullscreen()`/`exitFullscreen()`, which need transient user activation. */
const FULLSCREEN_EVENTS = new Set(["fullscreenchange"]);

/** The capture viewport never changes, so `window` never fires these before the snapshot. */
const VIEWPORT_EVENTS = new Set(["resize", "orientationchange"]);

/** `storage` fires only in *other* documents sharing the storage area; the capture is one document. */
const CROSS_DOCUMENT_EVENTS = new Set(["storage"]);

/** The captured page stays the visible, foreground tab from load to snapshot. */
const DOCUMENT_VISIBILITY_EVENTS = new Set(["visibilitychange"]);

/**
 * `window` fires these for the program's own uncaught throws and unhandled
 * rejections, which the analysis evaluates itself rather than receives from the
 * host; a capturing listener also sees resource load failures, which it does not.
 */
const PROGRAM_FAULT_EVENTS = new Set(["error", "unhandledrejection", "rejectionhandled"]);

const isCapturingListenerOption = (options: StaticValue | undefined): boolean => {
  if (options === undefined) return false;
  if (options.kind === "primitive") return Boolean(options.value);
  if (options.kind !== "object") return true;
  const capture = getObjectProperty(options, "capture");
  return capture.kind !== "primitive" || Boolean(capture.value);
};

/** A freshly loaded page sits at its initial scroll offset until a user or script scrolls it. */
const SCROLL_EVENTS = new Set(["scroll", "scrollend"]);

/** The selection moves only for a user or a script (`Selection.addRange()`), declared as plain `Event`s. */
const SELECTION_EVENTS = new Set(["select", "selectionchange", "selectstart"]);

/** Components may report a value they settle on at mount through these, unlike a real DOM event. */
const VALUE_EVENTS = new Set(["input", "beforeinput", "change", "select"]);

/** WebKit-only gesture and fullscreen events lib.dom leaves undeclared. */
const VENDOR_USER_EVENTS = new Set([
  "gesturestart",
  "gesturechange",
  "gestureend",
  "webkitfullscreenchange",
]);

/** Browser-dispatched event types are bare words; namespaced names are app-defined and only fire on `dispatchEvent`. */
const isCustomEventType = (type: string): boolean => /[^a-zA-Z]/.test(type);

/** Which interface an event is dispatched with is the DOM's own declaration (lib.dom), whichever host runs the program. */
const isInputDeviceEventType = (type: string): boolean => {
  const dom = loadHostRealm("browser");
  return INPUT_DEVICE_EVENT_INTERFACES.some((interfaceName) =>
    dom.isEventOfType(type, interfaceName),
  );
};

const isUserDrivenEventType = (type: string): boolean =>
  isInputDeviceEventType(type) ||
  VALUE_EVENTS.has(type) ||
  PAGE_UNLOAD_EVENTS.has(type) ||
  SCROLL_EVENTS.has(type) ||
  SELECTION_EVENTS.has(type) ||
  FULLSCREEN_EVENTS.has(type) ||
  VENDOR_USER_EVENTS.has(type);

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

interface NativeEventTarget {
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

const isEventTarget = (realm: HostRealm, receiver: StaticValue): boolean =>
  isNativeEventTarget(receiver) ||
  (receiver.kind === "global" && realm.isGlobalInstanceOf(receiver.name, "EventTarget"));

const isEventBeforeCapture = (
  realm: HostRealm,
  receiver: StaticValue,
  type: StaticValue | undefined,
  options: StaticValue | undefined,
): boolean => {
  if (receiver.kind === "global" && receiver.name === "MediaQueryList") return false;
  if (type?.kind !== "primitive" || typeof type.value !== "string") return true;
  if (receiver.kind === "global" && realm.isGlobalAlias(receiver.name)) {
    if (VIEWPORT_EVENTS.has(type.value) || CROSS_DOCUMENT_EVENTS.has(type.value)) return false;
    if (PROGRAM_FAULT_EVENTS.has(type.value) && !isCapturingListenerOption(options)) return false;
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

/** Listener registration on `window`/`document`/DOM nodes/`MediaQueryList`; only listeners the host may dispatch before capture run, at unknown times. */
export const callEventTargetMethod = (
  interpreter: Interpreter,
  realm: HostRealm,
  receiver: StaticValue,
  name: string,
  args: StaticValue[],
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue | null => {
  if (!EVENT_LISTENER_METHODS.has(name) || !isEventTarget(realm, receiver)) return null;
  const [type, listener, options] = args;
  if (!listener) return UNDEFINED_VALUE;
  const isRegistration = name === "addEventListener" || name === "addListener";
  if (isHistoryTraversalListener(realm, receiver, type)) {
    if (isRegistration) interpreter.history.traversalListeners.add(listener);
    else interpreter.history.traversalListeners.delete(listener);
    return UNDEFINED_VALUE;
  }
  if (isRegistration && isEventBeforeCapture(realm, receiver, type, options)) {
    interpreter.runHostDispatches(
      listener,
      [unknownValue("event dispatched by the host", location)],
      context,
      location,
    );
  }
  const target = toNativeEventTarget(receiver, interpreter.hostDocument);
  if (target && type?.kind === "primitive" && typeof type.value === "string") {
    if (isRegistration) attachNativeListener(interpreter, target, type.value, listener);
    else detachNativeListener(target, type.value, listener);
  }
  return UNDEFINED_VALUE;
};
