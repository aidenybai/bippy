import type { HostRealm } from "../host/host-realm.js";
import { getReactApiTypeof } from "../react/react-api.js";
import type { StaticElementType, StaticValue } from "../types.js";
import {
  ForwardRefTag,
  FunctionComponentTag,
  LazyComponentTag,
  MemoComponentTag,
  SimpleMemoComponentTag,
} from "../work-tags.js";
import { BUNDLER_INJECTED_NAMES, getBundlerGlobalTypeof } from "./bundler-globals.js";
import { getHostGlobalTypeof } from "./host-globals.js";
import { recordDerivation } from "./predicates.js";
import { describeValue, mapValue, primitiveValue, unknownPrimitiveValue } from "./values.js";

/** `typeof <global>` in the rendering host; null when its declarations leave it open, or when only the bundler could provide it. */
export const getGlobalTypeof = (name: string, realm: HostRealm): string | null => {
  if (BUNDLER_INJECTED_NAMES.has(name) && !realm.hasGlobal(name)) return null;
  return getBundlerGlobalTypeof(name) ?? getHostGlobalTypeof(realm, name);
};

const getComponentTypeof = (type: StaticElementType): string | null => {
  switch (type.kind) {
    case "function":
    case "class":
      return "function";
    case "memo":
    case "forward-ref":
    case "lazy":
    case "context-provider":
    case "context-consumer":
      return "object";
    case "host":
      return "string";
    case "fragment":
    case "strict-mode":
    case "profiler":
    case "suspense":
    case "suspense-list":
    case "activity":
    case "view-transition":
      return "symbol";
    case "stub":
      switch (type.stub.tag ?? FunctionComponentTag) {
        case ForwardRefTag:
        case MemoComponentTag:
        case SimpleMemoComponentTag:
        case LazyComponentTag:
          return "object";
        default:
          return "function";
      }
    default:
      return null;
  }
};

export const getTypeofValue = (value: StaticValue, realm: HostRealm): StaticValue => {
  switch (value.kind) {
    case "branch":
      return mapValue(value, (alternative) => getTypeofValue(alternative, realm));
    case "primitive":
      return primitiveValue(typeof value.value);
    case "unknown-primitive":
      return value.primitiveType === "any"
        ? unknownTypeofValue(value)
        : primitiveValue(value.primitiveType);
    case "function":
    case "class":
    case "native-function":
    case "method":
      return primitiveValue("function");
    case "react-api":
      return primitiveValue(getReactApiTypeof(value.api));
    case "component-reference": {
      const componentTypeof = getComponentTypeof(value.type);
      return componentTypeof ? primitiveValue(componentTypeof) : unknownTypeofValue(value);
    }
    case "proxy":
      return getTypeofValue(value.target, realm);
    case "native-object":
      return primitiveValue("object");
    case "symbol":
      return primitiveValue("symbol");
    case "object":
    case "list":
    case "element":
    case "namespace":
    case "context":
      return primitiveValue("object");
    case "external":
      return (value.importedName === "*" && value.origin === "binding") ||
        value.origin === "instance"
        ? primitiveValue("object")
        : unknownTypeofValue(value);
    case "global": {
      const globalType = getGlobalTypeof(value.name, realm);
      return globalType ? primitiveValue(globalType) : unknownTypeofValue(value);
    }
    default:
      return unknownTypeofValue(value);
  }
};

const unknownTypeofValue = (value: StaticValue): StaticValue =>
  recordDerivation(unknownPrimitiveValue("string", `typeof ${describeValue(value)}`), {
    kind: "typeof",
    operand: value,
  });
