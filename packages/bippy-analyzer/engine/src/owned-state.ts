import { types } from "node:util";
import {
  captureControl,
  executionMachine,
  type ContinuationStateOwner,
  type ContinuationStateRoots,
  type StateCheckpoint,
} from "./execution-machine.js";
import { getNativeCaptures, registerNativeClosure } from "./native-captures.js";

export interface StateOwnershipPolicy {
  describe: (value: object) => "record" | "array" | "map" | "set" | undefined;
  immutableRoots?: readonly object[];
  ambientNames?: readonly string[];
}

interface ObjectState {
  value: object;
  prototype: object | null;
  descriptors: PropertyDescriptorMap;
  extensible: boolean;
  mapEntries?: Array<[unknown, unknown]>;
  setEntries?: unknown[];
}

const intrinsicPrototypes: readonly object[] = [
  Object.prototype,
  Function.prototype,
  Array.prototype,
  Map.prototype,
  Set.prototype,
];

const getDescriptors = (value: object): PropertyDescriptorMap =>
  Object.getOwnPropertyDescriptors(value);

const restoreDescriptors = (value: object, descriptors: PropertyDescriptorMap): void => {
  for (const key of Reflect.ownKeys(value)) {
    if (!Object.hasOwn(descriptors, key) && !Reflect.deleteProperty(value, key))
      throw new Error("Owned state has an irreversible property addition");
  }
  const keys = Reflect.ownKeys(descriptors);
  const define = (): void => {
    for (const key of keys) {
      const descriptor: PropertyDescriptor = Reflect.get(descriptors, key);
      if (!Reflect.defineProperty(value, key, descriptor))
        throw new Error("Owned state has an irreversible property change");
    }
  };
  const hasOrder = (): boolean => {
    const current = Reflect.ownKeys(value);
    return current.length === keys.length && current.every((key, index) => key === keys[index]);
  };
  define();
  if (hasOrder()) return;
  for (const kind of ["string", "symbol"]) {
    const expected = keys.filter((key) => typeof key === kind);
    const current = Reflect.ownKeys(value).filter((key) => typeof key === kind);
    const first = current.findIndex((key, index) => key !== expected[index]);
    if (first === -1) continue;
    for (const key of current.slice(first)) {
      if (!Reflect.deleteProperty(value, key))
        throw new Error("Owned state property order cannot be restored");
    }
    define();
  }
  if (!hasOrder()) throw new Error("Owned state property order cannot be restored");
};

const assertDescriptors = (value: object, expected: PropertyDescriptorMap): void => {
  const actual = getDescriptors(value);
  const keys = Reflect.ownKeys(expected);
  const currentKeys = Reflect.ownKeys(actual);
  if (keys.length !== currentKeys.length || keys.some((key, index) => key !== currentKeys[index]))
    throw new Error("Shared intrinsic changed during owned execution");
  for (const key of keys) {
    const saved: PropertyDescriptor = Reflect.get(expected, key);
    const current: PropertyDescriptor | undefined = Reflect.get(actual, key);
    if (
      !current ||
      ["value", "get", "set", "writable", "enumerable", "configurable"].some(
        (field) => !Object.is(Reflect.get(saved, field), Reflect.get(current, field)),
      )
    )
      throw new Error("Shared intrinsic changed during owned execution");
  }
};

export class OwnedState implements ContinuationStateOwner {
  private readonly objects = new Map<object, ObjectState>();
  private readonly immutable: Set<object>;
  private readonly ambient: Set<string>;
  private readonly intrinsics: ObjectState[];
  private phase: "ready" | "capturing" | "captured" = "ready";

  constructor(private readonly policy: StateOwnershipPolicy) {
    this.immutable = new Set([
      ...intrinsicPrototypes,
      captureControl,
      executionMachine,
      getNativeCaptures,
      registerNativeClosure,
      ...(policy.immutableRoots ?? []),
    ]);
    this.intrinsics = [...this.immutable].map((value) => {
      if (types.isProxy(value)) throw new Error("Cannot own a native proxy");
      return {
        value,
        descriptors: getDescriptors(value),
        prototype: Object.getPrototypeOf(value),
        extensible: Object.isExtensible(value),
      };
    });
    this.ambient = new Set(policy.ambientNames);
  }

  beginCapture = (): void => {
    if (this.phase !== "ready") throw new Error("Owned state is single-use");
    this.phase = "capturing";
  };

  references = (value: object): readonly unknown[] => {
    if (this.phase !== "capturing")
      throw new Error("Owned state discovery requires an active capture");
    if (this.immutable.has(value) || this.objects.has(value)) return [];
    if (types.isProxy(value)) throw new Error("Cannot own a native proxy");
    if (
      types.isArgumentsObject(value) ||
      types.isWeakMap(value) ||
      types.isWeakSet(value) ||
      types.isPromise(value) ||
      types.isGeneratorObject(value) ||
      types.isModuleNamespaceObject(value) ||
      types.isBoxedPrimitive(value) ||
      types.isAnyArrayBuffer(value) ||
      types.isArrayBufferView(value) ||
      types.isDate(value) ||
      types.isRegExp(value)
    )
      throw new Error("Native internal state requires an ownership adapter");
    const prototype: object | null = Object.getPrototypeOf(value);
    const kind = typeof value === "function" ? "closure" : this.policy.describe(value);
    if (typeof value === "function") {
      if (!getNativeCaptures(value))
        throw new Error("Cannot own a native closure without capture metadata");
      if (prototype !== Function.prototype)
        throw new Error("Cannot own an unsupported native callable");
    } else {
      if (!kind) throw new Error("Native state has no declared ownership schema");
      if (kind === "array" && !Array.isArray(value)) throw new Error("Expected owned array state");
      if (
        kind === "record" &&
        (Array.isArray(value) ||
          types.isMap(value) ||
          types.isSet(value) ||
          (prototype !== null && prototype !== Object.prototype))
      )
        throw new Error("Expected owned record state");
    }
    const descriptors = getDescriptors(value);
    const state: ObjectState = {
      value,
      prototype,
      descriptors,
      extensible: Object.isExtensible(value),
    };
    const references: unknown[] = [prototype];
    if (kind === "map") {
      state.mapEntries = Array.from(Map.prototype.entries.call(value));
      for (const [key, entry] of state.mapEntries) references.push(key, entry);
    } else if (kind === "set") {
      state.setEntries = Array.from(Set.prototype.values.call(value));
      references.push(...state.setEntries);
    }
    this.objects.set(value, state);
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor: PropertyDescriptor = Reflect.get(descriptors, key);
      if ("value" in descriptor) references.push(descriptor.value);
      else references.push(descriptor.get, descriptor.set);
    }
    return references;
  };

  capture = (roots: ContinuationStateRoots): StateCheckpoint => {
    if (this.phase !== "capturing")
      throw new Error("Owned state checkpoint requires an active capture");
    for (const name of roots.ambientNames) {
      if (name.startsWith("[[") || name === "eval" || name === "Function")
        throw new Error(`Native lexical state requires an ownership adapter: ${name}`);
      if (!this.ambient.has(name)) throw new Error(`Undeclared native ambient: ${name}`);
    }
    this.phase = "captured";
    const controlled = new Set(roots.controlOwnedObjects);
    const states = [...this.objects.values()].filter((state) => !controlled.has(state.value));
    return {
      restore: () => {
        for (const intrinsic of this.intrinsics) {
          if (
            Object.getPrototypeOf(intrinsic.value) !== intrinsic.prototype ||
            Object.isExtensible(intrinsic.value) !== intrinsic.extensible
          )
            throw new Error("Shared intrinsic changed during owned execution");
          assertDescriptors(intrinsic.value, intrinsic.descriptors);
        }
        for (const state of states) {
          if (Object.isExtensible(state.value) !== state.extensible)
            throw new Error("Owned state extensibility changed irreversibly");
          const shadow: object = Array.isArray(state.value)
            ? []
            : Object.create(Object.getPrototypeOf(state.value));
          Object.defineProperties(shadow, getDescriptors(state.value));
          if (!Object.isExtensible(state.value)) Object.preventExtensions(shadow);
          if (!Reflect.setPrototypeOf(shadow, state.prototype))
            throw new Error("Owned state prototype changed irreversibly");
          restoreDescriptors(shadow, state.descriptors);
        }
        for (const state of states) {
          Reflect.setPrototypeOf(state.value, state.prototype);
          restoreDescriptors(state.value, state.descriptors);
          if (state.mapEntries) {
            Map.prototype.clear.call(state.value);
            for (const [key, value] of state.mapEntries)
              Map.prototype.set.call(state.value, key, value);
          }
          if (state.setEntries) {
            Set.prototype.clear.call(state.value);
            for (const value of state.setEntries) Set.prototype.add.call(state.value, value);
          }
        }
      },
    };
  };
}
