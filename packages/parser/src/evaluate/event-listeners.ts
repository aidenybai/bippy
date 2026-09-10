import type { SourceLocation, StaticNativeObjectValue, StaticValue } from "../types.js";
import type { HostDocument } from "../host/host-document.js";
import { type HostRealm, loadHostRealm } from "../host/host-realm.js";
import type { EvaluationContext } from "./context.js";
import type { Interpreter } from "./interpreter.js";
import { fromNativeValue, toNativeArguments } from "./native-values.js";
import { registerResourceListener } from "./resource-loading.js";
import { HISTORY_TRAVERSAL_EVENTS } from "./session-history.js";
import { isNullish, primitiveValue, UNDEFINED_VALUE } from "./values.js";

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

/** Events the browser fires from a queued task rather than at the moment the state changes. */
const TASK_QUEUED_EVENTS = new Set(["selectionchange"]);

interface NativeEventTarget {
  addEventListener(type: string, listener: (event: object) => void): void;
  removeEventListener(type: string, listener: (event: object) => void): void;
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
 * `autoFocus`, `Selection.setBaseAndExtent()`, `dispatchEvent`) reaches its
 * handler through the DOM, so the handler runs exactly when such a dispatch
 * happens, on the event the DOM built. A task-queued event fires once per
 * task however many times the state changed, as the document's "has scheduled
 * selectionchange event" flag arranges; a listener removed before the task
 * runs no longer hears it.
 */
const nativeListeners = new WeakMap<
  NativeEventTarget,
  Map<StaticValue, Map<string, (event: object) => void>>
>();

const attachNativeListener = (
  interpreter: Interpreter,
  target: NativeEventTarget,
  type: string,
  listener: StaticValue,
  context: EvaluationContext,
  location: SourceLocation | null,
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
  const dispatch = (event: object): void => {
    interpreter.callValue(
      listener,
      [fromNativeValue(event, `${type} event`, interpreter.hostDocument)],
      context,
      location,
      { thisValue: fromNativeValue(target, `${type} event target`, interpreter.hostDocument) },
    );
  };
  let isScheduled = false;
  const native = (event: object): void => {
    if (!TASK_QUEUED_EVENTS.has(type)) {
      dispatch(event);
      return;
    }
    if (isScheduled) return;
    isScheduled = true;
    const isDeferred = interpreter.timers.isDeferred;
    interpreter.timers.enqueue(() => {
      isScheduled = false;
      if (byType.get(type) !== native) return;
      if (isDeferred) interpreter.timers.runDeferred(() => dispatch(event));
      else dispatch(event);
    });
  };
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
  context: EvaluationContext,
  location: SourceLocation | null,
): void => {
  if (isHistoryTraversalListener(realm, receiver, type)) {
    if (isRegistration) interpreter.history.traversalListeners.add(listener);
    else interpreter.history.traversalListeners.delete(listener);
    return;
  }
  const target = toNativeEventTarget(receiver, interpreter.hostDocument);
  const typeName = type?.kind === "primitive" && typeof type.value === "string" ? type.value : null;
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
    if (isRegistration) {
      attachNativeListener(interpreter, target, typeName, listener, context, location);
    } else detachNativeListener(target, typeName, listener);
  }
};

/** Listener registration on `window`/`document`/DOM nodes/`MediaQueryList`; only listeners that may fire before capture escape. */
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
  const [type, listener] = args;
  if (!listener) return UNDEFINED_VALUE;
  const isRegistration = name === "addEventListener" || name === "addListener";
  updateListener(interpreter, realm, receiver, type, listener, isRegistration, context, location);
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
  context: EvaluationContext,
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
  if (previous) updateListener(interpreter, realm, receiver, type, previous, false, context, null);
  if (isNullish(value) === true) {
    handlers.delete(match[1]);
  } else {
    handlers.set(match[1], value);
    updateListener(interpreter, realm, receiver, type, value, true, context, null);
  }
  return true;
};
