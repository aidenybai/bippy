import type { StaticValue } from "../types.js";
import { recordInputSource } from "./predicates.js";
import { objectValue, primitiveValue, unknownPrimitiveValue } from "./values.js";

/** The user-agent state media queries observe; defaults match a fresh Playwright Chromium context. */
interface BrowserEnvironment {
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  colorScheme: "light" | "dark";
  reducedMotion: "no-preference" | "reduce";
  displayMode: "browser" | "standalone" | "minimal-ui" | "fullscreen";
  hover: "hover" | "none";
  pointer: "fine" | "coarse" | "none";
}

export const DEFAULT_BROWSER_ENVIRONMENT: BrowserEnvironment = {
  viewportWidth: 1280,
  viewportHeight: 720,
  devicePixelRatio: 1,
  colorScheme: "light",
  reducedMotion: "no-preference",
  displayMode: "browser",
  hover: "hover",
  pointer: "fine",
};

const ROOT_FONT_SIZE_PX = 16;

const parseLength = (raw: string): number | null => {
  const match = /^(-?\d*\.?\d+)(px|em|rem)?$/.exec(raw.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === "em" || match[2] === "rem" ? amount * ROOT_FONT_SIZE_PX : amount;
};

const parseResolution = (raw: string): number | null => {
  const match = /^(-?\d*\.?\d+)(dppx|x|dpi)$/.exec(raw.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  return match[2] === "dpi" ? amount / 96 : amount;
};

const compare = (left: number, operator: string, right: number): boolean => {
  switch (operator) {
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    default:
      return left === right;
  }
};

const dimension = (feature: string, environment: BrowserEnvironment): number | null => {
  switch (feature) {
    case "width":
    case "device-width":
      return environment.viewportWidth;
    case "height":
    case "device-height":
      return environment.viewportHeight;
    case "resolution":
      return environment.devicePixelRatio;
    default:
      return null;
  }
};

const parseFeatureValue = (feature: string, raw: string): number | null =>
  feature === "resolution" ? parseResolution(raw) : parseLength(raw);

const evaluateDiscrete = (
  feature: string,
  value: string | null,
  environment: BrowserEnvironment,
): boolean | null => {
  switch (feature) {
    case "display-mode":
      return value === environment.displayMode;
    case "prefers-color-scheme":
      return value === environment.colorScheme;
    case "prefers-reduced-motion":
      return value === null
        ? environment.reducedMotion === "reduce"
        : value === environment.reducedMotion;
    case "hover":
    case "any-hover":
      return value === null ? environment.hover !== "none" : value === environment.hover;
    case "pointer":
    case "any-pointer":
      return value === null ? environment.pointer !== "none" : value === environment.pointer;
    case "orientation":
      return (
        value ===
        (environment.viewportWidth >= environment.viewportHeight ? "landscape" : "portrait")
      );
    case "prefers-contrast":
    case "forced-colors":
    case "inverted-colors":
    case "prefers-reduced-transparency":
      return value === null ? false : value === "none" || value === "no-preference";
    default:
      return null;
  }
};

const evaluateFeature = (body: string, environment: BrowserEnvironment): boolean | null => {
  const range = /^([a-z-]+)\s*(<=|>=|<|>|=)\s*(.+)$/.exec(body);
  if (range) {
    const [, feature, operator, raw] = range;
    const actual = dimension(feature, environment);
    const expected = parseFeatureValue(feature, raw);
    return actual === null || expected === null ? null : compare(actual, operator, expected);
  }
  const reversed = /^(.+?)\s*(<=|>=|<|>)\s*([a-z-]+)$/.exec(body);
  if (reversed) {
    const [, raw, operator, feature] = reversed;
    const actual = dimension(feature, environment);
    const expected = parseFeatureValue(feature, raw);
    return actual === null || expected === null ? null : compare(expected, operator, actual);
  }
  const separator = body.indexOf(":");
  const name = (separator === -1 ? body : body.slice(0, separator)).trim();
  const value = separator === -1 ? null : body.slice(separator + 1).trim();
  const bounded = /^(min|max)-(.+)$/.exec(name);
  if (bounded && value !== null) {
    const [, bound, feature] = bounded;
    const actual = dimension(feature, environment);
    const expected = parseFeatureValue(feature, value);
    if (actual === null || expected === null) return null;
    return bound === "min" ? actual >= expected : actual <= expected;
  }
  const actual = dimension(name, environment);
  if (actual !== null) {
    if (value === null) return actual > 0;
    const expected = parseFeatureValue(name, value);
    return expected === null ? null : actual === expected;
  }
  return evaluateDiscrete(name, value, environment);
};

const splitTopLevel = (query: string, separator: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  const tokens = query.split(/(\(|\)|\s+)/).filter((token) => token !== undefined && token !== "");
  for (const token of tokens) {
    if (token === "(") depth++;
    if (token === ")") depth--;
    if (depth === 0 && token.trim().toLowerCase() === separator) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += token;
  }
  parts.push(current.trim());
  return parts;
};

const evaluateCondition = (condition: string, environment: BrowserEnvironment): boolean | null => {
  const trimmed = condition.trim();
  if (trimmed === "") return true;
  if (/^not\s/i.test(trimmed)) {
    const inner = evaluateCondition(trimmed.slice(4), environment);
    return inner === null ? null : !inner;
  }
  const disjuncts = splitTopLevel(trimmed, "or");
  if (disjuncts.length > 1) return combine(disjuncts, environment, "or");
  const conjuncts = splitTopLevel(trimmed, "and");
  if (conjuncts.length > 1) return combine(conjuncts, environment, "and");
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    const body = trimmed.slice(1, -1).trim();
    if (body.startsWith("(") || /\s(and|or)\s/i.test(body) || /^not\s/i.test(body)) {
      return evaluateCondition(body, environment);
    }
    return evaluateFeature(body.toLowerCase(), environment);
  }
  const type = trimmed.toLowerCase();
  if (type === "all" || type === "screen") return true;
  if (type === "print" || type === "speech") return false;
  return null;
};

const combine = (
  parts: string[],
  environment: BrowserEnvironment,
  operator: "and" | "or",
): boolean | null => {
  const results = parts.map((part) => evaluateCondition(part, environment));
  const decisive = operator === "and" ? false : true;
  if (results.includes(decisive)) return decisive;
  return results.includes(null) ? null : !decisive;
};

/** `window.matchMedia(query).matches` for the modeled browser, or null when the query is not understood. */
export const evaluateMediaQuery = (
  query: string,
  environment: BrowserEnvironment = DEFAULT_BROWSER_ENVIRONMENT,
): boolean | null => {
  const results = splitTopLevel(query, ",").map((part) => {
    const withoutOnly = part.replace(/^only\s+/i, "");
    return evaluateCondition(withoutOnly, environment);
  });
  if (results.includes(true)) return true;
  return results.includes(null) ? null : false;
};

export const mediaQueryListValue = (query: StaticValue | undefined): StaticValue => {
  const media = query?.kind === "primitive" && typeof query.value === "string" ? query.value : null;
  const matches = media === null ? null : evaluateMediaQuery(media);
  const listener = (name: string): StaticValue => ({
    kind: "method",
    receiver: { kind: "global", name: "MediaQueryList" },
    name,
  });
  return objectValue([
    {
      kind: "property",
      key: "matches",
      value:
        matches === null
          ? recordInputSource(
              unknownPrimitiveValue("boolean", `matchMedia(${media ?? "dynamic query"})`),
              "viewport",
            )
          : primitiveValue(matches),
    },
    {
      kind: "property",
      key: "media",
      value:
        media === null ? unknownPrimitiveValue("string", "media query") : primitiveValue(media),
    },
    { kind: "property", key: "onchange", value: primitiveValue(null) },
    { kind: "property", key: "addEventListener", value: listener("addEventListener") },
    { kind: "property", key: "removeEventListener", value: listener("removeEventListener") },
    { kind: "property", key: "addListener", value: listener("addListener") },
    { kind: "property", key: "removeListener", value: listener("removeListener") },
  ]);
};
