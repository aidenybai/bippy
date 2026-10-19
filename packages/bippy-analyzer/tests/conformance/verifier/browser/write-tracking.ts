import { isPlainData, isRefObject } from "../snapshot";
import { isWrittenByLibrary } from "../write-origins";

const MUTATING_COLLECTION_METHODS = new Set(["set", "add", "delete", "clear"]);
const MUTATING_ARRAY_METHODS = new Set([
  "copyWithin",
  "fill",
  "pop",
  "push",
  "reverse",
  "shift",
  "sort",
  "splice",
  "unshift",
]);

let propWrites = new Set<string>();
const propOwners = new WeakMap<object, string>();
const writeCounts = new WeakMap<object, number>();
const writeTrackers = new WeakMap<object, object>();
const trackedTargets = new WeakMap<object, object>();

const recordWrite = (target: object): void => {
  writeCounts.set(target, (writeCounts.get(target) ?? 0) + 1);
  const owner = propOwners.get(target);
  if (owner && !isWrittenByLibrary()) propWrites.add(owner);
};

const isMutatingMethod = (target: object, key: string | symbol): boolean =>
  typeof key === "string" &&
  (target instanceof Date ? key.startsWith("set") : MUTATING_COLLECTION_METHODS.has(key));

const isFreezing = (
  target: object,
  key: string | symbol,
  descriptor: PropertyDescriptor,
): boolean => {
  const current = Reflect.getOwnPropertyDescriptor(target, key);
  return (
    current !== undefined &&
    descriptor.get === undefined &&
    descriptor.set === undefined &&
    (!("value" in descriptor) || Object.is(descriptor.value, current.value))
  );
};

const getTrackedMember = (
  target: object,
  key: string | symbol,
  receiver: unknown,
  isDeep: boolean,
): unknown => {
  const member: unknown = Reflect.get(target, key);
  if (target instanceof Map || target instanceof Set || target instanceof Date) {
    if (typeof member !== "function" || key === "constructor") return member;
    return (...callArguments: unknown[]) => {
      if (isMutatingMethod(target, key)) recordWrite(target);
      return Reflect.apply(member, target, callArguments);
    };
  }
  if (
    Array.isArray(target) &&
    typeof member === "function" &&
    typeof key === "string" &&
    MUTATING_ARRAY_METHODS.has(key)
  ) {
    return (...callArguments: unknown[]) => {
      recordWrite(target);
      return Reflect.apply(member, receiver, callArguments);
    };
  }
  return isDeep && isPlainData(member) && !isRefObject(member) && !Object.isFrozen(target)
    ? trackWrites(member, true)
    : member;
};

export const trackWrites = (target: object, isDeep: boolean): object => {
  const existing = writeTrackers.get(target);
  if (existing) return existing;
  const tracker = new Proxy(target, {
    get: (innerTarget, key, receiver) => getTrackedMember(innerTarget, key, receiver, isDeep),
    set: (innerTarget, key, value) => {
      recordWrite(innerTarget);
      return Reflect.set(innerTarget, key, value);
    },
    deleteProperty: (innerTarget, key) => {
      recordWrite(innerTarget);
      return Reflect.deleteProperty(innerTarget, key);
    },
    defineProperty: (innerTarget, key, descriptor) => {
      if (!isFreezing(innerTarget, key, descriptor)) recordWrite(innerTarget);
      return Reflect.defineProperty(innerTarget, key, descriptor);
    },
  });
  writeTrackers.set(target, tracker);
  trackedTargets.set(tracker, target);
  return tracker;
};

export const findTrackedTarget = (value: object): object | undefined => trackedTargets.get(value);

export const getWriteCount = (target: object): number => writeCounts.get(target) ?? 0;

export const setPropOwner = (target: object, owner: string): void => {
  propOwners.set(target, owner);
};

export const findPropOwner = (target: object): string | undefined => propOwners.get(target);

export const getPropWrites = (): Set<string> => propWrites;

export const resetPropWrites = (): void => {
  propWrites = new Set();
};
