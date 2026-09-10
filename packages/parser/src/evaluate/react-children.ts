import type { SourceLocation, StaticElementValue, StaticValue } from "../types.js";
import type { EvaluationContext } from "./context.js";
import type { Interpreter } from "./interpreter.js";
import { getFlightDeferralPredicate } from "./predicates.js";
import {
  branchValue,
  type CallableValue,
  isNullish,
  listValue,
  mapValue,
  primitiveValue,
} from "./values.js";

/** Mirrors react/src/ReactChildren.js: `mapIntoArray` flattens nested arrays and assigns `.0`, `.1:0`, `$key/…` keys. */

const SEPARATOR = ".";
const SUBSEPARATOR = ":";

const escapeKey = (key: string): string =>
  `$${key.replace(/[=:]/g, (match) => (match === "=" ? "=0" : "=2"))}`;

const escapeUserProvidedKey = (text: string): string => text.replace(/\/+/g, "$&/");

const getPrimitiveKey = (element: StaticElementValue): string | null => {
  const { key } = element;
  if (!key || key.kind !== "primitive" || key.value === null || key.value === undefined)
    return null;
  return String(key.value);
};

const NOTHING_DEFERRED: ReadonlySet<StaticValue> = new Set();

/** Elements Flight deferred reach the client as `React.lazy` objects, which carry no `key`. */
const getElementKey = (
  child: StaticValue | null,
  index: number,
  deferred: ReadonlySet<StaticValue>,
): string => {
  if (child?.kind === "element" && !deferred.has(child)) {
    const key = getPrimitiveKey(child);
    if (key !== null) return escapeKey(key);
  }
  return index.toString(36);
};

/** Whether every node of `children` is a primitive, an element with a static key, or an array of those. */
const isStaticallyShaped = (value: StaticValue): boolean => {
  switch (value.kind) {
    case "primitive":
      return true;
    case "element":
      return value.key === null || value.key.kind === "primitive";
    case "list":
      return value.items.every(isStaticallyShaped);
    default:
      return false;
  }
};

/** `undefined` and booleans are perceived as null. */
const toReactChild = (value: StaticValue): StaticValue | null =>
  value.kind === "primitive" &&
  (value.value === undefined || value.value === null || typeof value.value === "boolean")
    ? null
    : value;

const withMappedKey = (
  mappedChild: StaticValue,
  child: StaticValue | null,
  escapedPrefix: string,
  childKey: string,
): StaticValue =>
  mapValue(mappedChild, (alternative) => {
    if (alternative.kind !== "element") return alternative;
    const mappedKey = getPrimitiveKey(alternative);
    const originalKey = child?.kind === "element" ? getPrimitiveKey(child) : null;
    const keptMappedKey =
      mappedKey !== null && (child === null || originalKey !== mappedKey)
        ? `${escapeUserProvidedKey(mappedKey)}/`
        : "";
    return {
      ...alternative,
      key: primitiveValue(`${escapedPrefix}${keptMappedKey}${childKey}`),
    };
  });

const mapIntoArray = (
  array: StaticValue[],
  children: StaticValue,
  escapedPrefix: string,
  nameSoFar: string,
  deferred: ReadonlySet<StaticValue>,
  callback: (child: StaticValue | null) => StaticValue,
): number => {
  const child = toReactChild(children);
  if (child?.kind === "list") {
    const nextNamePrefix = nameSoFar === "" ? SEPARATOR : `${nameSoFar}${SUBSEPARATOR}`;
    let subtreeCount = 0;
    child.items.forEach((item, index) => {
      subtreeCount += mapIntoArray(
        array,
        item,
        escapedPrefix,
        `${nextNamePrefix}${getElementKey(toReactChild(item), index, deferred)}`,
        deferred,
        callback,
      );
    });
    return subtreeCount;
  }
  const mappedChild = callback(child);
  const childKey =
    nameSoFar === "" ? `${SEPARATOR}${getElementKey(child, 0, deferred)}` : nameSoFar;
  if (mappedChild.kind === "list" && isStaticallyShaped(mappedChild)) {
    mapIntoArray(
      array,
      mappedChild,
      `${escapeUserProvidedKey(childKey)}/`,
      "",
      deferred,
      (innerChild) => innerChild ?? primitiveValue(null),
    );
    return 1;
  }
  if (isNullish(mappedChild) !== true) {
    array.push(withMappedKey(mappedChild, child, escapedPrefix, childKey));
  }
  return 1;
};

const collectElements = (children: StaticValue, elements: StaticElementValue[]): void => {
  const child = toReactChild(children);
  if (child?.kind === "list") {
    for (const item of child.items) collectElements(item, elements);
  } else if (child?.kind === "element") {
    elements.push(child);
  }
};

/**
 * Flight defers every element it reaches once a row exceeds `MAX_ROW_SIZE`
 * (`renderModelDestructive` in ReactFlightServer), so the server elements a
 * client component receives as lazy references are a suffix of the traversal
 * order; where the row overflowed depends on the serialized payload size. A cut
 * at a key-less element is indistinguishable from the cut at the next keyed one.
 */
const flightDeferralAlternatives = (
  elements: StaticElementValue[],
  context: EvaluationContext,
): ReadonlySet<StaticValue>[] => {
  if (context.environment !== "client") return [];
  return elements.flatMap((element, cut) =>
    element.environment === "server" && getPrimitiveKey(element) !== null
      ? [new Set(elements.filter((later, index) => index >= cut && later.environment === "server"))]
      : [],
  );
};

/** `React.Children.map(children, callback, thisArg)`; null when the children shape is not statically known. */
export const mapChildrenExactly = (
  interpreter: Interpreter,
  children: StaticValue,
  callback: CallableValue,
  thisArg: StaticValue | undefined,
  context: EvaluationContext,
  location: SourceLocation | null,
): StaticValue | null => {
  if (isNullish(children) === true) return children;
  if (!isStaticallyShaped(children)) return null;
  const mapped: StaticValue[] = [];
  const array: StaticValue[] = [];
  mapIntoArray(array, children, "", "", NOTHING_DEFERRED, (child) => {
    const result = interpreter.callValue(
      callback,
      [child ?? primitiveValue(null), primitiveValue(mapped.length)],
      context,
      null,
      { thisValue: thisArg ?? null },
    );
    mapped.push(result);
    return result;
  });
  const elements: StaticElementValue[] = [];
  collectElements(children, elements);
  const deferrals = flightDeferralAlternatives(elements, context);
  if (deferrals.length === 0) return listValue(array);
  const alternatives = deferrals.map((deferred) => {
    const deferredArray: StaticValue[] = [];
    let index = 0;
    mapIntoArray(deferredArray, children, "", "", deferred, () => mapped[index++]);
    return listValue(deferredArray);
  });
  return branchValue(
    [listValue(array), ...alternatives],
    "Flight deferred the elements past its row size limit",
    location,
    0,
    getFlightDeferralPredicate(children),
  );
};

/** `React.Children.count`: how many times a mapper would be invoked; null when the shape is not statically known. */
export const countChildrenExactly = (children: StaticValue): number | null => {
  if (isNullish(children) === true) return 0;
  if (!isStaticallyShaped(children)) return null;
  return mapIntoArray([], children, "", "", NOTHING_DEFERRED, () => primitiveValue(null));
};
