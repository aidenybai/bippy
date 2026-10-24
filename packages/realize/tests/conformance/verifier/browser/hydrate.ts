import { createElement } from "react";
import type { Sample } from "../../../../src/core/types";
import { forEachPlainObject, isPlainData, isRefObject } from "../snapshot";
import { STAND_IN } from "../stubs/stand-in";
import { getPropOwner } from "../types";
import { setPropOwner, trackWrites } from "./write-tracking";

export const createOpenObject = (fields: Record<string, unknown>): Record<string, unknown> =>
  new Proxy(fields, {
    get: (target, key) =>
      Reflect.has(target, key) || typeof key === "symbol" || key === "then" || key === "toJSON"
        ? Reflect.get(target, key)
        : STAND_IN,
  });

export const hydrate = (sample: Sample): unknown => {
  switch (sample.kind) {
    case "Value":
      return sample.value;
    case "Undefined":
      return undefined;
    case "Function": {
      const { returns } = sample;
      return () => (returns ? hydrate(returns) : undefined);
    }
    case "Element":
      return createElement("span", null, "text");
    case "Date":
      return new Date(sample.value);
    case "Set":
      return new Set(sample.items.map(hydrate));
    case "Map":
      return new Map(sample.entries.map(([key, value]) => [hydrate(key), hydrate(value)]));
    case "Promise":
      return Promise.resolve(hydrate(sample.value));
    case "Array":
      return sample.items.map(hydrate);
    case "Object": {
      const fields = Object.fromEntries(
        Object.entries(sample.fields).map(([name, field]) => [name, hydrate(field)]),
      );
      return sample.isOpen ? createOpenObject(fields) : fields;
    }
  }
};

export const hydrateProp = (name: string, sample: Sample): unknown => {
  const value = hydrate(sample);
  if (!isPlainData(value) || isRefObject(value)) return value;
  forEachPlainObject(value, (object) => setPropOwner(object, getPropOwner(name)));
  return trackWrites(value, true);
};
