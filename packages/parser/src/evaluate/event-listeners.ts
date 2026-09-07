import type { StaticValue } from "../types.js";
import { isWindowAlias } from "./browser-globals.js";
import type { Interpreter } from "./interpreter.js";
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

const EVENT_TARGET_GLOBALS = new Set(["window", "globalThis", "document", "MediaQueryList"]);

const getNativeEventTarget = (receiver: StaticValue): EventTarget | null =>
  receiver.kind === "native-object" &&
  typeof EventTarget !== "undefined" &&
  receiver.value instanceof EventTarget
    ? receiver.value
    : null;

export const EVENT_LISTENER_METHODS = new Set([
  "addEventListener",
  "removeEventListener",
  "addListener",
  "removeListener",
]);

export const isEventTarget = (receiver: StaticValue): boolean =>
  getNativeEventTarget(receiver) !== null ||
  (receiver.kind === "global" && EVENT_TARGET_GLOBALS.has(receiver.name));

const isEventBeforeCapture = (receiver: StaticValue, type: StaticValue | undefined): boolean => {
  if (receiver.kind === "global" && receiver.name === "MediaQueryList") return false;
  if (type?.kind !== "primitive" || typeof type.value !== "string") return true;
  if (
    receiver.kind === "global" &&
    isWindowAlias(receiver.name) &&
    VIEWPORT_EVENTS.has(type.value)
  ) {
    return false;
  }
  return !(USER_GESTURE_EVENTS.has(type.value) || PAGE_UNLOAD_EVENTS.has(type.value));
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
  const isRegistration = name === "addEventListener" || name === "addListener";
  if (isRegistration && listener && isEventBeforeCapture(receiver, type)) {
    interpreter.markEscaped(listener);
  }
  return UNDEFINED_VALUE;
};
