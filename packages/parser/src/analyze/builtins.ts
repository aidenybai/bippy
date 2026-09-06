import { flattenInto, forgetArrayItems, getIterationItem } from "./access.js";
import { type EvaluationContext, isEffectUndecided } from "./interpreter.js";
import type { CallbackInvoker } from "./react-calls.js";
import {
  array,
  assignStatic,
  conditional,
  FALSE,
  getTruthiness,
  list,
  literal,
  mergeObjects,
  object,
  optional,
  SELECTION_LIMIT,
  selectItem,
  type StaticValue,
  text,
  TRUE,
  UNDEFINED,
  unknown,
} from "./values.js";

export const GLOBAL_NAMESPACES = new Set([
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

const ARRAY_LIKE_METHODS = new Set([
  "map",
  "flatMap",
  "filter",
  "forEach",
  "slice",
  "concat",
  "reverse",
  "toReversed",
  "sort",
  "toSorted",
  "flat",
  "join",
  "find",
  "findLast",
  "at",
  "some",
  "every",
  "includes",
  "indexOf",
  "findIndex",
  "reduce",
  "reduceRight",
  "push",
  "unshift",
  "pop",
  "shift",
  "splice",
  "entries",
  "keys",
  "values",
]);

const isCallable = (value: StaticValue | undefined): value is StaticValue =>
  value !== undefined && value.kind === "function";

type Verdict = boolean | null;

const presentValue = (item: StaticValue): StaticValue =>
  item.kind === "optional" ? item.value : item;

/**
 * The first item, in `order`, whose verdict holds. Undecided verdicts and
 * items that may be absent each add a branch that falls through to the next
 * candidate, which is how `find` reads on a filtered array; `null` once the
 * branching would outgrow its usefulness.
 */
const findMatch = (
  items: StaticValue[],
  verdicts: Verdict[],
  order: number[],
  describeTest: (index: number) => string,
): StaticValue | null => {
  const candidates: number[] = [];
  for (const index of order) {
    if (verdicts[index] === false) continue;
    candidates.push(index);
    if (verdicts[index] === true && items[index].kind !== "optional") break;
  }
  if (candidates.length > SELECTION_LIMIT) return null;
  let fallthrough: StaticValue = UNDEFINED;
  for (const index of candidates.reverse()) {
    const item = items[index];
    const candidate = presentValue(item);
    const matched: StaticValue =
      verdicts[index] === true
        ? candidate
        : conditional(describeTest(index), candidate, fallthrough);
    fallthrough = item.kind === "optional" ? conditional(item.test, matched, fallthrough) : matched;
  }
  return fallthrough;
};

/** `some`/`every` decided from per-item verdicts; an absent item cannot decide either. */
const quantify = (items: StaticValue[], verdicts: Verdict[], isEvery: boolean): StaticValue => {
  const decides = (verdict: Verdict, index: number): boolean =>
    verdict === !isEvery && items[index].kind !== "optional";
  if (verdicts.some(decides)) return literal(!isEvery);
  if (verdicts.every((verdict) => verdict === isEvery)) return literal(isEvery);
  return unknown(isEvery ? "every()" : "some()");
};

/**
 * Array method semantics on the three iterable shapes: known arrays keep
 * per-item precision, lists stay lists and unknown receivers become lists
 * of whatever the callback produces from an unknown item.
 */
export const evaluateArrayMethod = (
  target: StaticValue,
  method: string,
  callArguments: StaticValue[],
  invoke: CallbackInvoker,
  description: string,
  context: EvaluationContext,
): StaticValue | null => {
  if (!ARRAY_LIKE_METHODS.has(method)) return null;
  const callDescription = `${description}.${method}()`;
  const items = target.kind === "array" ? target.items : null;
  const itemShape = getIterationItem(target, description);
  const [callback, secondArgument] = callArguments;
  /** Positions are certain only up to the first item that may be absent. */
  const hasOptionalBefore = (index: number): boolean =>
    items !== null && items.slice(0, index).some((item) => item.kind === "optional");
  const indexAt = (index: number): StaticValue =>
    hasOptionalBefore(index) ? unknown("index") : literal(index);
  /** Applies `mapper` to every item; an item that may be absent yields a result that may be absent. */
  const mapItems = (
    mapper: (item: StaticValue, index: StaticValue) => StaticValue,
    isFlat: boolean,
  ): StaticValue => {
    if (!items) return list(mapper(itemShape, unknown("index")), description, isFlat);
    const mapped = items.map((item, index) =>
      item.kind === "optional"
        ? optional(item.test, mapper(item.value, indexAt(index)))
        : mapper(item, indexAt(index)),
    );
    if (!isFlat) return array(mapped);
    const flattened: StaticValue[] = [];
    for (const mappedItem of mapped) flattenInto(flattened, mappedItem);
    return array(flattened);
  };
  /** Runs a predicate over every present item, in source order. */
  const testItems = (predicate: StaticValue): Verdict[] =>
    (items ?? []).map((item, index) =>
      getTruthiness(invoke(predicate, [presentValue(item), indexAt(index), target])),
    );
  const asIndex = (value: StaticValue | undefined, fallback: number): number | null => {
    if (value === undefined) return fallback;
    return value.kind === "literal" && typeof value.value === "number" ? value.value : null;
  };
  switch (method) {
    case "map":
    case "flatMap":
      if (!isCallable(callback)) return unknown(callDescription);
      return mapItems(
        (item, index) => invoke(callback, [item, index, target]),
        method === "flatMap",
      );
    case "filter": {
      if (!isCallable(callback)) return unknown(callDescription);
      if (!items) return target.kind === "list" ? target : unknown(callDescription);
      const verdicts = testItems(callback);
      const kept: StaticValue[] = [];
      items.forEach((item, index) => {
        const verdict = verdicts[index];
        if (verdict === true) kept.push(item);
        else if (verdict === null) kept.push(optional(`${callDescription} keeps [${index}]`, item));
      });
      return array(kept);
    }
    case "find":
    case "findLast": {
      if (!isCallable(callback)) return unknown(callDescription);
      if (!items) return unknown(callDescription);
      const order = items.map((_item, index) => index);
      if (method === "findLast") order.reverse();
      return (
        findMatch(
          items,
          testItems(callback),
          order,
          (index) => `${callDescription} matches [${index}]`,
        ) ?? unknown(callDescription)
      );
    }
    case "forEach":
      if (!isCallable(callback)) return UNDEFINED;
      if (items) mapItems((item, index) => invoke(callback, [item, index, target]), false);
      else invoke(callback, [itemShape, unknown("index"), target]);
      return UNDEFINED;
    case "slice": {
      if (!items) return target.kind === "list" ? target : unknown(callDescription);
      const start = asIndex(callback, 0);
      const end = asIndex(secondArgument, items.length);
      if (start === null || end === null || hasOptionalBefore(end)) {
        return list(itemShape, description);
      }
      return array(items.slice(start, end));
    }
    case "concat": {
      if (!items) return unknown(callDescription);
      const combined = [...items];
      for (const argument of callArguments) flattenInto(combined, argument);
      return array(combined);
    }
    case "reverse":
    case "toReversed":
      return items
        ? array([...items].reverse())
        : target.kind === "list"
          ? target
          : unknown(callDescription);
    case "sort":
    case "toSorted":
      if (items && items.length <= 1) return array(items);
      return target.kind === "list" ? target : list(itemShape, description);
    case "flat": {
      if (!items) {
        return target.kind === "list"
          ? list(target.item, description, true)
          : unknown(callDescription);
      }
      const flattened: StaticValue[] = [];
      for (const item of items) flattenInto(flattened, item);
      return array(flattened);
    }
    case "join":
      return text(callDescription);
    case "push":
    case "unshift": {
      if (target.kind !== "array") return unknown(callDescription);
      const undecided = context.undecided;
      const pushed =
        undecided && isEffectUndecided(context, target.depth)
          ? callArguments.map((argument) => ({
              ...list(argument, `${callDescription} under ${undecided.test}`),
              isInline: true,
            }))
          : callArguments;
      if (method === "push") target.items.push(...pushed);
      else target.items.unshift(...pushed);
      return literal(target.items.length);
    }
    case "reduce":
    case "reduceRight": {
      if (!items || !isCallable(callback) || hasOptionalBefore(items.length)) {
        return unknown(callDescription);
      }
      const order = items.map((_item, index) => index);
      if (method === "reduceRight") order.reverse();
      const hasInitial = callArguments.length > 1;
      if (!hasInitial && order.length === 0) return unknown(callDescription);
      let accumulator = hasInitial ? (secondArgument ?? UNDEFINED) : items[order[0]];
      for (const index of order.slice(hasInitial ? 0 : 1)) {
        accumulator = invoke(callback, [accumulator, items[index], literal(index), target]);
      }
      return accumulator;
    }
    case "pop":
    case "shift": {
      if (target.kind !== "array") return unknown(callDescription);
      if (isEffectUndecided(context, target.depth) || hasOptionalBefore(target.items.length)) {
        return forgetArrayItems(target, description);
      }
      return (method === "pop" ? target.items.pop() : target.items.shift()) ?? UNDEFINED;
    }
    case "splice": {
      if (target.kind !== "array") return unknown(callDescription);
      const [start, deleteCount, ...added] = callArguments;
      const startIndex = asIndex(start, 0);
      const deleteCountIndex = asIndex(deleteCount, target.items.length);
      if (
        isEffectUndecided(context, target.depth) ||
        startIndex === null ||
        deleteCountIndex === null
      ) {
        return forgetArrayItems(target, description);
      }
      return array(target.items.splice(startIndex, deleteCountIndex, ...added));
    }
    case "at": {
      if (!items || callback?.kind !== "literal" || typeof callback.value !== "number") {
        return unknown(callDescription);
      }
      if (callback.value >= 0) return selectItem(items, callback.value);
      return hasOptionalBefore(items.length)
        ? unknown(callDescription)
        : (items.at(callback.value) ?? UNDEFINED);
    }
    case "includes": {
      if (!items || !callback) return unknown(callDescription);
      const verdicts: Verdict[] = items.map((item) => {
        const candidate = presentValue(item);
        return candidate.kind === "literal" && callback.kind === "literal"
          ? Object.is(candidate.value, callback.value)
          : null;
      });
      return quantify(items, verdicts, false);
    }
    case "some":
    case "every":
      if (!items || !isCallable(callback)) return unknown(callDescription);
      return quantify(items, testItems(callback), method === "every");
    default:
      return unknown(callDescription);
  }
};

const toStringValue = (value: StaticValue, description: string): StaticValue => {
  if (value.kind === "literal") return literal(String(value.value));
  return value.kind === "text" ? value : text(description);
};

/**
 * Calls on well-known globals (`Object.keys`, `Array.from`, `String(x)`…)
 * that appear in render code. Returns `null` for anything unmodelled.
 */
export const evaluateGlobalCall = (
  chain: string[],
  callArguments: StaticValue[],
  invoke: CallbackInvoker,
  description: string,
): StaticValue | null => {
  const [first, second] = callArguments;
  switch (chain.join(".")) {
    case "Object.keys":
      if (first?.kind === "object" && !first.hasUnknownSpread) {
        return array([...first.properties.keys()].map((key) => literal(key)));
      }
      return unknown(description);
    case "Object.values":
      if (first?.kind === "object" && !first.hasUnknownSpread) {
        return array([...first.properties.values()]);
      }
      return unknown(description);
    case "Object.entries":
      if (first?.kind === "object" && !first.hasUnknownSpread) {
        return array(
          [...first.properties.entries()].map(([key, value]) => array([literal(key), value])),
        );
      }
      return unknown(description);
    case "Object.assign": {
      if (!first) return UNDEFINED;
      for (const source of callArguments.slice(1)) {
        if (first.kind === "object") {
          if (source.kind === "object") mergeObjects(first, source);
          else if (source.kind !== "literal") first.hasUnknownSpread = true;
        } else if (source.kind === "object") {
          for (const [key, member] of source.properties) assignStatic(first, key, member);
        }
      }
      return first;
    }
    case "Object.freeze":
    case "Object.seal":
    case "structuredClone":
    case "Promise.resolve":
      return first ?? UNDEFINED;
    case "Object.defineProperty": {
      const descriptor = callArguments[2];
      if (!first || second?.kind !== "literal" || descriptor?.kind !== "object") {
        return first ?? UNDEFINED;
      }
      const key = String(second.value);
      const value =
        descriptor.properties.get("value") ??
        (descriptor.properties.has("get") ? unknown(`accessor ${key}`) : UNDEFINED);
      if (first.kind === "object") first.properties.set(key, value);
      else assignStatic(first, key, value);
      return first;
    }
    case "Object.fromEntries": {
      if (first?.kind !== "array") return unknown(description);
      const result = object();
      for (const entry of first.items) {
        if (entry.kind !== "array" || entry.items[0]?.kind !== "literal") {
          result.hasUnknownSpread = true;
          continue;
        }
        result.properties.set(String(entry.items[0].value), entry.items[1] ?? UNDEFINED);
      }
      return result;
    }
    case "Object.create":
      return object();
    case "Array.isArray":
      if (!first || first.kind === "unknown" || first.kind === "conditional")
        return unknown(description);
      return first.kind === "array" || first.kind === "list" ? TRUE : FALSE;
    case "Array.of":
      return array(callArguments);
    case "Array.from": {
      if (!first) return array([]);
      const mapper = second;
      if (first.kind === "array") {
        return isCallable(mapper)
          ? array(first.items.map((item, index) => invoke(mapper, [item, literal(index)])))
          : first;
      }
      const item = first.kind === "list" ? first.item : unknown(`item of ${description}`);
      return list(
        isCallable(mapper) ? invoke(mapper, [item, unknown("index")]) : item,
        description,
      );
    }
    case "String":
      return first ? toStringValue(first, description) : literal("");
    case "String.raw":
      return text(description);
    case "Number":
    case "parseInt":
    case "parseFloat":
      if (first?.kind === "literal" && typeof first.value !== "symbol") {
        return literal(Number(first.value));
      }
      return unknown(description);
    case "Symbol":
      return literal(Symbol(first?.kind === "literal" ? String(first.value) : description));
    case "Symbol.for":
      if (first?.kind === "literal" && typeof first.value === "string") {
        return literal(Symbol.for(first.value));
      }
      return unknown(description);
    case "Boolean": {
      if (!first) return FALSE;
      const truthiness = getTruthiness(first);
      return truthiness === null ? unknown(description) : literal(truthiness);
    }
    case "JSON.stringify":
      if (first?.kind === "literal") return literal(JSON.stringify(first.value) ?? "undefined");
      return text(description);
    case "console.log":
    case "console.warn":
    case "console.error":
    case "console.info":
    case "console.debug":
      return UNDEFINED;
    default:
      return chain[0] === "Math" || chain[0] === "Date" || chain[0] === "Intl"
        ? unknown(description)
        : null;
  }
};
