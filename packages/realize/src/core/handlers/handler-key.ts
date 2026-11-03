import type { SymbolicValue } from "../types";
import { getValueKey } from "../values/get-value-key";
import { isStateBinding } from "../values/is-state-binding";
import { isExternalSource } from "./is-external-source";

export const getHandlerKey = (value: SymbolicValue): string | null => {
  switch (value.kind) {
    case "Function":
      return `function:${value.functionId}`;
    case "Setter":
      return `setter:${value.binding.id}`;
    case "Dispatch":
      return `dispatch:${value.binding.id}`;
    case "Bound": {
      const calleeKey = getHandlerKey(value.callee);
      return calleeKey === null
        ? null
        : `bound:${calleeKey}:${getValueKey(value.receiver)}:${value.argumentValues.map(getValueKey).join(",")}`;
    }
    case "ArrayExpression":
      return `array:${value.elements.map(getHandlerKey).join(",")}`;
    case "ObjectExpression":
      return `object:${value.properties
        .map((property) => `${property.key}=${getHandlerKey(property.value)}`)
        .join(",")}`;
    case "Binding":
      return value.binding.kind === "prop" ||
        value.binding.kind === "ref" ||
        value.binding.hookKind === "useMemo" ||
        isStateBinding(value.binding) ||
        isExternalSource(value.binding)
        ? `binding:${value.binding.id}:${value.path.join(".")}`
        : null;
    case "Conditional": {
      const consequentKey = getHandlerKey(value.consequent);
      const alternateKey = getHandlerKey(value.alternate);
      return consequentKey === null && alternateKey === null
        ? null
        : `conditional:${getValueKey(value.test)}?${consequentKey}:${alternateKey}`;
    }
    case "Unknown":
    case "Global":
      return `opaque:${getValueKey(value)}`;
    default:
      return null;
  }
};
