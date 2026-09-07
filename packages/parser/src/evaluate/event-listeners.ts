import type { StaticValue } from "../types.js";
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

const EVENT_TARGET_GLOBALS = new Set(["window", "globalThis", "document", "MediaQueryList"]);

export const EVENT_LISTENER_METHODS = new Set([
  "addEventListener",
  "removeEventListener",
  "addListener",
  "removeListener",
]);

export const isEventTarget = (receiver: StaticValue): boolean =>
  receiver.kind === "host-node" ||
  (receiver.kind === "global" && EVENT_TARGET_GLOBALS.has(receiver.name));

const isUserGestureEvent = (type: StaticValue | undefined): boolean =>
  type?.kind === "primitive" &&
  typeof type.value === "string" &&
  USER_GESTURE_EVENTS.has(type.value);

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
  const isStaticViewport = receiver.kind === "global" && receiver.name === "MediaQueryList";
  if (isRegistration && listener && !isUserGestureEvent(type) && !isStaticViewport) {
    interpreter.markEscaped(listener);
  }
  return UNDEFINED_VALUE;
};
