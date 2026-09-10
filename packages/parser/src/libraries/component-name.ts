import { describeElementType, getStubOwnDisplayName, getStubOwnName } from "../evaluate/values.js";
import { toElementType } from "../react/element-type.js";
import type { StaticValue } from "../types.js";

const getStringProperty = (
  properties: ReadonlyMap<string, StaticValue>,
  key: string,
): string | null => {
  const value = properties.get(key);
  return value?.kind === "primitive" && typeof value.value === "string" ? value.value : null;
};

/** `tag.displayName || tag.name || 'Component'`, as styling libraries name their wrappers: wrapper objects have no `name`. */
export const describeTag = (tag: StaticValue): string => {
  const type = toElementType(tag, null);
  switch (type.kind) {
    case "host":
      return type.tagName;
    case "function":
    case "class":
      return (
        getStringProperty(type.component.properties, "displayName") ??
        type.component.name ??
        "Component"
      );
    case "memo":
    case "forward-ref":
    case "lazy":
      return type.displayName ?? "Component";
    case "stub":
      return getStubOwnDisplayName(type.stub) ?? getStubOwnName(type.stub) ?? "Component";
    default:
      return describeElementType(type);
  }
};
