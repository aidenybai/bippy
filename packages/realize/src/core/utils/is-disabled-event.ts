import { getBaseEvent } from "../dom-events";

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

export const isMouseBlockedEvent = (propName: string): boolean =>
  MOUSE_BLOCKED_EVENTS.has(getBaseEvent(propName));

export const isDisabledEvent = (propName: string): boolean =>
  isMouseBlockedEvent(propName) || UNREACHABLE_EVENTS.has(getBaseEvent(propName));
