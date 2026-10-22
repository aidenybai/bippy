import type { AbstractValue } from "../types";

const OPEN_TYPE_TEXTS = new Set(["any", "unknown", "{}"]);

const OBJECT_TYPEOF_NAMES: ReadonlySet<string> = new Set(["object", "function"]);

export const getTypeofNames = (value: AbstractValue): ReadonlySet<string> | null => {
  if (value.kind === "Literal")
    return new Set([value.value === null ? "object" : typeof value.value]);
  if (value.text === "void") return new Set(["undefined"]);
  if (OPEN_TYPE_TEXTS.has(value.text)) return null;
  return value.primitive === null ? OBJECT_TYPEOF_NAMES : new Set([value.primitive]);
};
