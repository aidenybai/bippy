const MOUSE_BLOCKED_EVENTS = new Set([
  "onClick",
  "onDoubleClick",
  "onMouseDown",
  "onMouseMove",
  "onMouseUp",
  "onMouseEnter",
]);

const UNREACHABLE_EVENTS = new Set([
  "onFocus",
  "onKeyDown",
  "onKeyUp",
  "onKeyPress",
  "onChange",
  "onInput",
  "onBeforeInput",
]);

const CAPTURE_SUFFIX = "Capture";

export const getBaseEvent = (propName: string): string =>
  propName.endsWith(CAPTURE_SUFFIX) ? propName.slice(0, -CAPTURE_SUFFIX.length) : propName;

export const isMouseBlockedEvent = (propName: string): boolean =>
  MOUSE_BLOCKED_EVENTS.has(getBaseEvent(propName));

export const isDisabledEvent = (propName: string): boolean =>
  isMouseBlockedEvent(propName) || UNREACHABLE_EVENTS.has(getBaseEvent(propName));
