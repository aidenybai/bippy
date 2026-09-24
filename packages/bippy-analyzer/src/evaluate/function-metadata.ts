import type { StaticObjectValue, StaticValue } from "../types.js";
import { objectValue } from "./values.js";

export const createFunctionProperties = (
  length: StaticValue,
  name: StaticValue,
): StaticObjectValue =>
  objectValue([
    { kind: "property", key: "length", value: length, isEnumerable: false },
    { kind: "property", key: "name", value: name, isEnumerable: false },
  ]);
