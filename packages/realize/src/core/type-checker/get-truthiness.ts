import type { Truthiness, AbstractValue } from "../types";

export const getTruthiness = (value: AbstractValue): Truthiness => {
  if (value.kind === "Literal") return value.value ? "truthy" : "falsy";
  if (value.kind === "Collection") return "truthy";
  if (value.text === "void") return "falsy";
  return value.primitive === null ? "truthy" : "either";
};
