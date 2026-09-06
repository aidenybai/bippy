import type { EvaluationContext, Interpreter } from "./interpreter.js";
import { hasLocalBinding } from "./scope.js";
import { type GlobalValue, literal, type Primitive, type StaticValue, unknown } from "./values.js";

/** Globals the ECMAScript standard defines, so the analysis host has the same members. */
const STANDARD_NAMESPACES = new Set([
  "Object",
  "Array",
  "JSON",
  "Math",
  "String",
  "Number",
  "Boolean",
  "Date",
  "Promise",
  "Symbol",
  "Reflect",
  "Intl",
]);

export const GLOBAL_NAMESPACES = new Set([
  ...STANDARD_NAMESPACES,
  "console",
  "window",
  "document",
  "globalThis",
  "navigator",
  "process",
]);

/** Browser globals the analysis host (Node) does not define. */
const DOM_GLOBALS = new Set([
  "location",
  "history",
  "screen",
  "self",
  "parent",
  "top",
  "frames",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "caches",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "requestIdleCallback",
  "cancelIdleCallback",
  "matchMedia",
  "getComputedStyle",
  "getSelection",
  "scrollTo",
  "scrollBy",
  "alert",
  "confirm",
  "prompt",
  "open",
  "print",
  "innerWidth",
  "innerHeight",
  "devicePixelRatio",
  "Image",
  "Audio",
  "Option",
  "FileReader",
  "XMLHttpRequest",
  "Worker",
  "DOMParser",
  "XMLSerializer",
  "Notification",
  "MutationObserver",
  "IntersectionObserver",
  "ResizeObserver",
  "CSS",
  "Node",
  "Text",
  "Element",
  "Range",
  "Selection",
  "NodeList",
  "DocumentFragment",
  "ShadowRoot",
  "DataTransfer",
  "MediaQueryList",
  "ImageData",
  "Path2D",
  "OffscreenCanvas",
  "AudioContext",
  "MediaRecorder",
  "MediaStream",
  "IDBKeyRange",
]);

const DOM_GLOBAL_PATTERN = /^(?:HTML|SVG|CSS|Webkit|WebKit)[A-Z]|Event$|Element$/;

/**
 * Whether a free identifier names a value the runtime provides. Anything
 * ECMAScript or the web platform defines in Node is checked against the host,
 * so the list only has to cover what browsers add on top.
 */
export const isKnownGlobal = (name: string): boolean =>
  GLOBAL_NAMESPACES.has(name) ||
  DOM_GLOBALS.has(name) ||
  DOM_GLOBAL_PATTERN.test(name) ||
  name in globalThis;

/** Whether an access chain starts at a global namespace rather than a binding that shadows it. */
export const isGlobalChain = (chain: string[], context: EvaluationContext): boolean =>
  GLOBAL_NAMESPACES.has(chain[0]) &&
  !hasLocalBinding(context.scope, chain[0]) &&
  !context.module.bindings.has(chain[0]);

/**
 * `process.env.<NAME>` as a bundler substitutes it: the configured value, or
 * unknown for a variable the analysis was not told about.
 */
export const readEnvironmentVariable = (interpreter: Interpreter, name: string): StaticValue => {
  const value = interpreter.environment[name];
  return value === undefined ? unknown(`process.env.${name}`) : literal(value);
};

const isHostObject = (value: unknown): value is object =>
  typeof value === "function" || (typeof value === "object" && value !== null);

const isHostPrimitive = (value: unknown): value is Primitive => !isHostObject(value);

/** The host's own value at `chain`, or `undefined` when the path is not defined or cannot be read. */
const getHostValue = (chain: string[]): unknown => {
  let current: unknown = globalThis;
  for (const key of chain) {
    if (!isHostObject(current) || !(key in current)) return undefined;
    try {
      current = Reflect.get(current, key);
    } catch {
      return undefined;
    }
  }
  return current;
};

const toGlobal = (chain: string[], host: object): GlobalValue => ({
  kind: "global",
  chain,
  typeName: typeof host === "function" ? "function" : "object",
});

/** A free identifier naming a standard global, as a value. */
export const getStandardGlobal = (name: string): GlobalValue | null => {
  const host = getHostValue([name]);
  return STANDARD_NAMESPACES.has(name) && isHostObject(host) ? toGlobal([name], host) : null;
};

/** Whether the standard method at `chain` is one `Namespace.prototype.method` that a `.call` hands a receiver. */
export const getPrototypeMethod = (value: GlobalValue): string | null =>
  value.chain.length === 3 && value.chain[1] === "prototype" ? value.chain[2] : null;

/**
 * A member of a standard global: functions and namespaces stay globals,
 * constants (`Math.PI`, `Symbol.iterator`) fold to what the host holds.
 */
export const getGlobalMember = (target: GlobalValue, key: string): StaticValue => {
  const chain = [...target.chain, key];
  const host = getHostValue(chain);
  if (isHostObject(host)) return toGlobal(chain, host);
  return host !== undefined && isHostPrimitive(host) ? literal(host) : unknown(chain.join("."));
};
