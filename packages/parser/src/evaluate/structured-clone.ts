import type { StaticObjectEntry, StaticValue } from "../types.js";
import { getCollectionItems } from "./collections.js";
import {
  getKnownObjectKeys,
  getObjectProperty,
  hasDefiniteItems,
  listValue,
  objectValue,
} from "./values.js";

/** A fresh deep copy of plain data (primitives, arrays, plain objects); null when some part is not statically cloneable. */
export const structuredCloneValue = (value: StaticValue): StaticValue | null => {
  switch (value.kind) {
    case "primitive":
      return typeof value.value === "symbol" ? null : value;
    case "list": {
      if (!hasDefiniteItems(value)) return null;
      const items = value.items.map(structuredCloneValue);
      return items.every((item) => item !== null) ? listValue(items) : null;
    }
    case "object": {
      if (
        getCollectionItems(value) ||
        value.entries.some((entry) => entry.kind === "property" && entry.accessor)
      )
        return null;
      const keys = getKnownObjectKeys(value);
      if (keys === null) return null;
      const entries: StaticObjectEntry[] = [];
      for (const key of keys) {
        const cloned = structuredCloneValue(getObjectProperty(value, key));
        if (cloned === null) return null;
        entries.push({ kind: "property", key, value: cloned });
      }
      return objectValue(entries);
    }
    default:
      return null;
  }
};
