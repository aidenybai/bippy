import type { CallbackInvoker } from "./react-calls.js";
import {
  array,
  type ElementValue,
  list,
  literal,
  NULL,
  type StaticValue,
  UNDEFINED,
  unknown,
} from "./values.js";

/**
 * Mirrors `mapIntoArray` from React's `ReactChildren.js`: leaves are visited
 * depth-first, the callback sees a running count as its index, and every
 * mapped element is re-keyed with the `.0` / `.$key` / `prefix/` scheme.
 * Keys become `null` (statically unknown) as soon as any part depends on a
 * runtime value.
 */
interface ChildTraversal {
  invoke: CallbackInvoker;
  results: StaticValue[];
  count: number;
  isPrecise: boolean;
}

const SEPARATOR = ".";
const SUBSEPARATOR = ":";

const escapeKey = (key: string): string =>
  `$${key.replace(/[=:]/g, (match) => (match === "=" ? "=0" : "=2"))}`;

const escapeUserProvidedKey = (key: string): string => key.replace(/\/+/g, "$&/");

const joinKeys = (...parts: (string | null)[]): string | null =>
  parts.every((part) => part !== null) ? parts.join("") : null;

/** A key React would coerce with `"" + key`; `undefined` when the element has no key, `null` when unknowable. */
const getLiteralKey = (element: ElementValue): string | null | undefined => {
  if (element.key === null) return undefined;
  if (element.key.kind !== "literal") return null;
  return element.key.value == null ? undefined : String(element.key.value);
};

const getElementKey = (child: StaticValue, index: number): string | null => {
  if (child.kind !== "element") return index.toString(36);
  const key = getLiteralKey(child);
  if (key === null) return null;
  return key === undefined ? index.toString(36) : escapeKey(key);
};

const isNullishChild = (value: StaticValue): boolean =>
  value.kind === "literal" && (value.value == null || typeof value.value === "boolean");

const isLeafChild = (value: StaticValue): boolean =>
  value.kind === "literal" || value.kind === "text" || value.kind === "element";

const toKeyValue = (key: string | null): StaticValue =>
  key === null ? unknown("Children key") : literal(key);

const withRuntimeKey = (value: StaticValue): StaticValue => {
  if (value.kind === "element") return { ...value, key: unknown("Children key") };
  if (value.kind === "array") return array(value.items.map(withRuntimeKey));
  return value;
};

const getMappedKey = (
  child: StaticValue,
  mapped: ElementValue,
  childKey: string | null,
): string | null => {
  const mappedKey = getLiteralKey(mapped);
  if (mappedKey === null) return null;
  if (mappedKey === undefined) return childKey;
  const originalKey = child.kind === "element" ? getLiteralKey(child) : undefined;
  if (originalKey === null) return null;
  const isSameKey = originalKey === mappedKey;
  return joinKeys(isSameKey ? "" : `${escapeUserProvidedKey(mappedKey)}/`, childKey);
};

const mapLeaf = (
  child: StaticValue,
  traversal: ChildTraversal,
  callback: StaticValue | null,
  escapedPrefix: string | null,
  nameSoFar: string | null,
): void => {
  const normalized = isNullishChild(child) ? NULL : child;
  const mapped = callback
    ? traversal.invoke(callback, [normalized, literal(traversal.count)])
    : normalized;
  traversal.count += 1;
  const childKey = nameSoFar === "" ? joinKeys(SEPARATOR, getElementKey(normalized, 0)) : nameSoFar;
  if (mapped.kind === "array") {
    const escapedChildKey = childKey === null ? null : `${escapeUserProvidedKey(childKey)}/`;
    mapIntoArray(mapped, traversal, null, escapedChildKey, "");
    return;
  }
  if (isNullishChild(mapped)) return;
  if (mapped.kind === "element") {
    const key = joinKeys(escapedPrefix, getMappedKey(normalized, mapped, childKey));
    traversal.results.push({ ...mapped, key: toKeyValue(key) });
    return;
  }
  traversal.results.push(mapped);
};

const mapIntoArray = (
  children: StaticValue,
  traversal: ChildTraversal,
  callback: StaticValue | null,
  escapedPrefix: string | null,
  nameSoFar: string | null,
): void => {
  if (isLeafChild(children)) {
    mapLeaf(children, traversal, callback, escapedPrefix, nameSoFar);
    return;
  }
  if (children.kind === "array") {
    const nextNamePrefix = nameSoFar === "" ? SEPARATOR : joinKeys(nameSoFar, SUBSEPARATOR);
    children.items.forEach((child, index) => {
      mapIntoArray(
        child,
        traversal,
        callback,
        escapedPrefix,
        joinKeys(nextNamePrefix, getElementKey(child, index)),
      );
    });
    return;
  }
  traversal.isPrecise = false;
  const item = children.kind === "list" ? children.item : unknown("child");
  const mapped = callback ? traversal.invoke(callback, [item, unknown("index")]) : item;
  traversal.results.push({ ...list(withRuntimeKey(mapped), "Children.map()"), isInline: true });
};

const traverseChildren = (
  children: StaticValue,
  callback: StaticValue | null,
  invoke: CallbackInvoker,
): ChildTraversal => {
  const traversal: ChildTraversal = { invoke, results: [], count: 0, isPrecise: true };
  mapIntoArray(children, traversal, callback, "", "");
  return traversal;
};

const mapChildren = (
  children: StaticValue,
  callback: StaticValue | null,
  invoke: CallbackInvoker,
): StaticValue => {
  if (children.kind === "literal" && children.value == null) return children;
  const traversal = traverseChildren(children, callback, invoke);
  const [only] = traversal.results;
  if (!traversal.isPrecise && traversal.results.length === 1 && only.kind === "list") {
    return { ...only, isInline: false };
  }
  return array(traversal.results);
};

/** `React.Children.*`: `map`, `forEach`, `toArray`, `count` and `only`. */
export const evaluateChildrenApi = (
  method: string,
  callArguments: StaticValue[],
  invoke: CallbackInvoker,
  description: string,
): StaticValue => {
  const [children = UNDEFINED, callback = null] = callArguments;
  switch (method) {
    case "map":
      return mapChildren(children, callback, invoke);
    case "forEach":
      mapChildren(children, callback, invoke);
      return UNDEFINED;
    case "toArray": {
      const mapped = mapChildren(children, null, invoke);
      return mapped.kind === "literal" ? array([]) : mapped;
    }
    case "count": {
      if (children.kind === "literal" && children.value == null) return literal(0);
      const traversal = traverseChildren(children, null, invoke);
      return traversal.isPrecise ? literal(traversal.count) : unknown(description);
    }
    case "only":
      return children.kind === "element" || children.kind === "unknown"
        ? children
        : unknown(description);
    default:
      return unknown(description);
  }
};
