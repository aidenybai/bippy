import type { StaticNativeObjectValue, StaticValue } from "../types.js";
import type { HostDocument } from "../host/host-document.js";
import type { EvaluationContext } from "./context.js";
import { type HostRealm, loadHostRealm } from "../host/host-realm.js";
import { IMAGE_LOAD_EVENTS, isAwaitingImageSource, settleImageSource } from "./image-loading.js";
import type { Interpreter } from "./interpreter.js";
import { fromNativeValue, toNativeArguments } from "./native-values.js";
import { HISTORY_TRAVERSAL_EVENTS } from "./session-history.js";
import { UNDEFINED_VALUE, isCallable, primitiveValue } from "./values.js";

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

interface NativeEventListener {
  (event: object): void;
}

interface NativeEventTarget {
  addEventListener(type: string, listener: NativeEventListener): void;
  removeEventListener(type: string, listener: NativeEventListener): void;
  dispatchEvent(event: object): boolean;
}

// happy-dom nodes come from the renderer's own `EventTarget`, not this realm's.
const isNativeEventTargetObject = (value: unknown): value is NativeEventTarget =>
  typeof value === "object" &&
  value !== null &&
  "addEventListener" in value &&
  typeof value.addEventListener === "function" &&
  "removeEventListener" in value &&
  typeof value.removeEventListener === "function" &&
  "dispatchEvent" in value &&
  typeof value.dispatchEvent === "function";

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
 * handler escapes exactly when such a dispatch happens. An event the capture
 * observed (an image settling) is dispatched with the context it runs in, and
 * the handler runs then like any timer task.
 */
const nativeListeners = new WeakMap<
  NativeEventTarget,
  Map<StaticValue, Map<string, NativeEventListener>>
>();

let observedDispatch: { context: EvaluationContext; host: HostDocument } | null = null;
let isSettingImageSource = false;

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
  const native = (event: object): void => {
    // HACK: happy-dom settles `data:` and unparsable sources inside the `src` setter; a browser fires load/error in a later task, which the observed outcome stands for.
    if (isSettingImageSource && IMAGE_LOAD_EVENTS.has(type)) return;
    if (observedDispatch === null) {
      interpreter.markEscaped(listener);
      return;
    }
    const args = [fromNativeValue(event, type, observedDispatch.host)];
    if (interpreter.timers.isDeferred)
      interpreter.callDeferred(listener, args, observedDispatch.context, null);
    else interpreter.callValue(listener, args, observedDispatch.context, null);
  };
  byType.set(type, native);
  target.addEventListener(type, native);
};

/** Dispatches `type` on a node as the browser did before the snapshot: its listeners run now, in `context`. */
const dispatchObservedEvent = (
  target: StaticNativeObjectValue,
  type: string,
  context: EvaluationContext,
): void => {
  const { host } = target;
  const eventConstructor: unknown = host === null ? null : Reflect.get(host.globalObject, "Event");
  if (typeof eventConstructor !== "function" || host === null) return;
  const native = toNativeEventTarget(target, host);
  if (native === null) return;
  const previous = observedDispatch;
  observedDispatch = { context, host };
  try {
    native.dispatchEvent(Reflect.construct(eventConstructor, [type]));
  } finally {
    observedDispatch = previous;
  }
};

/** Escapes the listeners attached to a node for `types`: the events may fire before the snapshot after all. */
const escapeAttachedListeners = (
  interpreter: Interpreter,
  target: StaticNativeObjectValue,
  types: ReadonlySet<string>,
): void => {
  const native = toNativeEventTarget(target, target.host);
  const byListener = native === null ? undefined : nativeListeners.get(native);
  if (!byListener) return;
  for (const [listener, byType] of byListener) {
    if ([...byType.keys()].some((type) => types.has(type))) interpreter.markEscaped(listener);
  }
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

const registerListener = (
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
  if (
    isRegistration &&
    isEventBeforeCapture(realm, receiver, type) &&
    !isAwaitingImageSource(receiver, type)
  )
    interpreter.markEscaped(listener);
  const target = toNativeEventTarget(receiver, interpreter.hostDocument);
  if (target && type?.kind === "primitive" && typeof type.value === "string") {
    if (isRegistration) attachNativeListener(interpreter, target, type.value, listener);
    else detachNativeListener(target, type.value, listener);
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
  registerListener(interpreter, realm, receiver, type, listener, isRegistration);
  return UNDEFINED_VALUE;
};

/**
 * `image.src = url`: the browser fetches the source and fires `load` or
 * `error` in a later task. With the outcome the capture observed for that URL
 * the event is dispatched in the next task round; without one, the listeners
 * attached so far (and any attached later) may have run by the snapshot.
 */
export const assignImageSource = (
  interpreter: Interpreter,
  image: StaticNativeObjectValue,
  source: StaticValue,
  context: EvaluationContext,
  assign: () => void,
): void => {
  isSettingImageSource = true;
  try {
    assign();
  } finally {
    isSettingImageSource = false;
  }
  const settled = settleImageSource(
    image,
    source,
    (url) => interpreter.resolvePageUrl(url),
    interpreter.pageState?.images,
  );
  if (settled === null) {
    escapeAttachedListeners(interpreter, image, IMAGE_LOAD_EVENTS);
    return;
  }
  const dispatch = (): void => dispatchObservedEvent(image, settled, context);
  interpreter.timers.enqueue(
    interpreter.timers.isDeferred ? () => interpreter.timers.runDeferred(dispatch) : dispatch,
  );
};

const EVENT_HANDLER_ATTRIBUTE = /^on([a-z]+)$/;

/** The handler each node's `on<event>` attribute holds, so reassigning it replaces the previous listener. */
const eventHandlerAttributes = new WeakMap<object, Map<string, StaticValue>>();

/**
 * `node.onload = handler`: an event handler IDL attribute registers its
 * callable value as a listener for the event, and a later assignment (or
 * null) removes the one before; true when `key` is such an attribute of a
 * DOM node.
 */
export const assignEventHandlerAttribute = (
  interpreter: Interpreter,
  realm: HostRealm,
  receiver: StaticNativeObjectValue,
  key: string,
  value: StaticValue,
): boolean => {
  const type = EVENT_HANDLER_ATTRIBUTE.exec(key)?.[1];
  if (type === undefined || !isNativeEventTarget(receiver) || !(key in receiver.value))
    return false;
  let handlers = eventHandlerAttributes.get(receiver.value);
  if (!handlers) {
    handlers = new Map();
    eventHandlerAttributes.set(receiver.value, handlers);
  }
  const typeValue = primitiveValue(type);
  const previous = handlers.get(key);
  if (previous) registerListener(interpreter, realm, receiver, typeValue, previous, false);
  handlers.delete(key);
  if (!isCallable(value)) return true;
  handlers.set(key, value);
  registerListener(interpreter, realm, receiver, typeValue, value, true);
  return true;
};
