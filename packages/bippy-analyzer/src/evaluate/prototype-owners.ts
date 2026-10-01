import type { StaticClassValue, StaticObjectValue } from "../types.js";

const prototypeOwners = new WeakMap<StaticObjectValue, StaticClassValue>();

/** The class whose `.prototype` this object is, or null for any other object. */
export const getPrototypeOwner = (value: StaticObjectValue): StaticClassValue | null =>
  prototypeOwners.get(value) ?? null;

/** `Object.getPrototypeOf(Base.prototype)` is `Object.prototype` when `Base` has no `extends` clause. */
export const isBaseClassPrototype = (value: StaticObjectValue): boolean =>
  getPrototypeOwner(value)?.body.superValue === null;

export const isClassPrototype = (value: StaticObjectValue): boolean => prototypeOwners.has(value);

export const setPrototypeOwner = (
  prototype: StaticObjectValue,
  classValue: StaticClassValue,
): void => {
  prototypeOwners.set(prototype, classValue);
};
