import type { HostRealm } from "../host/host-realm.js";
import type { StaticFunctionValue, StaticValue } from "../types.js";
import { getLanguageObject } from "./language-intrinsics.js";
import { getTypeofValue } from "./value-typeof.js";

export const isFunctionConstructor = (value: StaticFunctionValue): boolean =>
  value.boundTarget
    ? isFunctionConstructor(value.boundTarget)
    : value.node.type !== "ArrowFunctionExpression" &&
      !value.node.async &&
      !value.node.generator &&
      value.hasPrototype !== false;

export const isNativeConstructor = (value: object): boolean => {
  if (typeof value !== "function") return false;
  try {
    // HACK: The outer trap tests the constructor slot without target reads or body execution.
    Reflect.construct(new Proxy(value, { construct: () => ({}) }), []);
    return true;
  } catch {
    return false;
  }
};

export const getConstructibility = (value: StaticValue, realm: HostRealm): boolean | null => {
  if (value.kind === "function") return isFunctionConstructor(value);
  if (value.kind === "class") return true;
  if (value.kind === "proxy") return getConstructibility(value.target, realm);
  if (value.kind === "native-function") return value.construct ? true : null;
  if (value.kind === "global") {
    const native = getLanguageObject(value.name);
    if (native !== null) return isNativeConstructor(native);
  }
  const valueType = getTypeofValue(value, realm);
  return valueType.kind === "primitive" && valueType.value !== "function" ? false : null;
};
