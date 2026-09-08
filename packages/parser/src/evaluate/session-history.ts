import type { CapturedPageState, SourceLocation, StaticValue } from "../types.js";
import {
  NULL_VALUE,
  UNDEFINED_VALUE,
  capturedValue,
  isNullish,
  unknownPrimitiveValue,
  unknownValue,
} from "./values.js";

/**
 * The session history entry the page is on: its URL (relative to the origin)
 * and `history.state`, as the capture recorded them before any script ran and
 * then as the interpreted code's `pushState`/`replaceState` calls set them.
 * Either is null/unknown while the page it came from was not recorded, or after
 * a navigation the interpreter cannot follow.
 */
export interface SessionHistory {
  route: string | null;
  state: StaticValue;
  /** `popstate`/`hashchange` listeners: they fire only when the entry is traversed, not on `pushState`/`replaceState`. */
  traversalListeners: Set<StaticValue>;
}

export const HISTORY_TRAVERSAL_EVENTS: ReadonlySet<string> = new Set(["popstate", "hashchange"]);

const HISTORY_NAME = /^(?:(?:window|globalThis|self)\.)?history$/;

export const isHistoryName = (globalName: string): boolean => HISTORY_NAME.test(globalName);

export const createSessionHistory = (
  page: CapturedPageState | null,
  route: string | null,
): SessionHistory => ({
  route,
  state:
    page?.historyState === undefined
      ? unknownValue("history.state")
      : capturedValue(page.historyState, "history.state"),
  traversalListeners: new Set(),
});

export const getHistoryMember = (history: SessionHistory, name: string): StaticValue | null => {
  switch (name) {
    case "state":
      return history.state;
    case "length":
      return unknownPrimitiveValue("number", "history.length");
    case "scrollRestoration":
      return unknownPrimitiveValue("string", "history.scrollRestoration");
    default:
      return null;
  }
};

const resolveRoute = (route: string, origin: string | null, url: string): string => {
  const resolved = new URL(url, new URL(route, origin ?? "http://origin.invalid"));
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
};

export const callHistoryMethod = (
  history: SessionHistory,
  origin: string | null,
  methodName: string,
  args: StaticValue[],
  location: SourceLocation | null,
  markEscaped: (value: StaticValue) => void,
): StaticValue | null => {
  const [state = UNDEFINED_VALUE, , url] = args;
  switch (methodName) {
    case "pushState":
    case "replaceState":
      history.state = isNullish(state) === true ? NULL_VALUE : state;
      if (url !== undefined && isNullish(url) !== true) {
        history.route =
          url.kind === "primitive" && typeof url.value === "string" && history.route !== null
            ? resolveRoute(history.route, origin, url.value)
            : null;
      }
      return UNDEFINED_VALUE;
    case "back":
    case "forward":
    case "go":
      history.route = null;
      history.state = unknownValue(`history.state after history.${methodName}()`, location);
      for (const listener of history.traversalListeners) markEscaped(listener);
      return UNDEFINED_VALUE;
    default:
      return null;
  }
};
