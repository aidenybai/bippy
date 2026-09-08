import {
  FUNCTION_OWN_KEYS,
  getStubOwnKeys,
  REACT_ELEMENT_OWN_KEYS,
  WRAPPER_OWN_KEYS,
} from "../react/element-shape.js";
import type {
  StaticClassValue,
  StaticElementType,
  StaticFunctionValue,
  StaticValue,
} from "../types.js";
import { getStaticProperty } from "./class-component.js";
import { createErrorValue } from "./errors.js";
import { hasNativeObjectMember } from "./native-values.js";
import {
  branchValue,
  FALSE_VALUE,
  getKnownObjectKeys,
  getKnownObjectSymbols,
  getPropertyName,
  getSymbolPropertyKey,
  hasDefiniteItems,
  isIndefiniteItem,
  isSymbolPropertyKey,
  TRUE_VALUE,
  primitiveValue,
  thrownValue,
} from "./values.js";

export const OBJECT_PROTOTYPE_METHODS = new Set([
  "hasOwnProperty",
  "propertyIsEnumerable",
  "isPrototypeOf",
  "toString",
  "toLocaleString",
  "valueOf",
]);

/** Own keys every function object has without source assigning them; arrows have no `prototype`. */
export const isIntrinsicFunctionKey = (
  callable: StaticFunctionValue | StaticClassValue,
  key: string,
): boolean =>
  key === "length" ||
  key === "name" ||
  (key === "prototype" && callable.node.type !== "ArrowFunctionExpression");

const hasComponentProperty = (type: StaticElementType, name: string): StaticValue | null => {
  switch (type.kind) {
    case "function":
    case "class":
      if (type.component.properties.has(name)) return TRUE_VALUE;
      return type.kind === "function" && !FUNCTION_OWN_KEYS.has(name) ? FALSE_VALUE : null;
    case "memo":
    case "forward-ref":
    case "lazy":
      return WRAPPER_OWN_KEYS[type.kind].has(name) ||
        type.properties.has(name) ||
        (name === "displayName" && type.displayName !== null)
        ? TRUE_VALUE
        : FALSE_VALUE;
    case "stub":
      if (type.stub.properties?.has(name)) return TRUE_VALUE;
      if (name === "displayName") return primitiveValue(type.stub.displayName !== null);
      return getStubOwnKeys(type.stub.tag).has(name) ? null : FALSE_VALUE;
    default:
      return null;
  }
};

/** `name in target` when the target's own keys are known; null when it depends on runtime shape. */
export const hasNamedProperty = (name: string, target: StaticValue): StaticValue | null => {
  switch (target.kind) {
    case "branch": {
      const results: StaticValue[] = [];
      for (const alternative of target.alternatives) {
        const result = hasNamedProperty(name, alternative);
        if (!result) return null;
        results.push(result);
      }
      return branchValue(results, target.reason, target.location, target.preferredIndex);
    }
    case "element":
      return REACT_ELEMENT_OWN_KEYS.has(name) ? TRUE_VALUE : FALSE_VALUE;
    case "object": {
      const keys = isSymbolPropertyKey(name)
        ? getKnownObjectSymbols(target)?.map(getSymbolPropertyKey)
        : getKnownObjectKeys(target);
      if (!keys) return null;
      if (keys.includes(name)) return TRUE_VALUE;
      if (target.prototype) return hasNamedProperty(name, target.prototype);
      return name in {} && !target.hasNullPrototype ? TRUE_VALUE : FALSE_VALUE;
    }
    case "function":
    case "class": {
      const isOwn =
        target.kind === "class"
          ? getStaticProperty(target, name) !== null
          : target.properties.has(name);
      return isOwn || isIntrinsicFunctionKey(target, name) || name in Function.prototype
        ? TRUE_VALUE
        : FALSE_VALUE;
    }
    case "native-object":
      return hasNativeObjectMember(target, name) ? TRUE_VALUE : FALSE_VALUE;
    case "native-function":
      return name in Function.prototype ? TRUE_VALUE : FALSE_VALUE;
    case "list": {
      if (name in Array.prototype) return TRUE_VALUE;
      const index = Number(name);
      if (!Number.isInteger(index) || index < 0) return FALSE_VALUE;
      const isReachable = target.items.slice(0, index + 1).every((item) => !isIndefiniteItem(item));
      if (index < target.items.length && isReachable) return TRUE_VALUE;
      return hasDefiniteItems(target) ? FALSE_VALUE : null;
    }
    case "component-reference":
      return hasComponentProperty(target.type, name);
    case "primitive":
      return target.value === null || target.value === undefined
        ? thrownValue(
            `"${name}" in ${String(target.value)}`,
            createErrorValue(
              "TypeError",
              [
                primitiveValue(
                  `Cannot use 'in' operator to search for '${name}' in ${String(target.value)}`,
                ),
              ],
              null,
            ),
          )
        : null;
    default:
      return null;
  }
};

export const hasProperty = (key: StaticValue, target: StaticValue): StaticValue | null => {
  const name = getPropertyName(key);
  return name === null ? null : hasNamedProperty(name, target);
};
