import { IsCallable, ObjectValue, Value } from "#engine";
import { EngineApplicationError } from "./engine-runtime.js";
import type { EngineMembrane } from "./membrane.js";

export const installIntrinsicBridge = (membrane: EngineMembrane): void => {
  const { engine } = membrane;
  const callbacks = new WeakMap<ObjectValue, ObjectValue>();
  const define = engine.evaluate("Object.defineProperty");
  const descriptorFor = engine.evaluate("Object.getOwnPropertyDescriptor");
  for (const name of [
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "Promise",
    "RegExp",
    "Number",
    "BigInt",
    "Boolean",
    "String",
    "Symbol",
  ]) {
    const constructor: unknown = Reflect.get(globalThis, name);
    if (typeof constructor !== "function") continue;
    const nativePrototype: object = Reflect.get(constructor, "prototype");
    const prototype = engine.getObject(engine.evaluate(`${name}.prototype`));
    for (const key of Reflect.ownKeys(nativePrototype)) {
      if (key === "constructor") continue;
      const nativeDescriptor = Object.getOwnPropertyDescriptor(nativePrototype, key);
      if (!nativeDescriptor) continue;
      const engineKey = membrane.toEngine(key);
      const descriptor = engine.call(descriptorFor, [prototype, engineKey]);
      if (descriptor === Value.undefined) continue;
      const record = engine.getObject(descriptor);
      for (const field of ["value", "get", "set"]) {
        const native: unknown = Reflect.get(nativeDescriptor, field);
        const original = engine.get(record, field);
        if (typeof native !== "function" || !IsCallable(original)) continue;
        const cached = callbacks.get(original);
        if (cached) {
          engine.set(record, field, cached);
          continue;
        }
        const callback = engine.createFunction(
          String(membrane.toHost(engine.get(original, "name"))),
          (args, receiver) => {
            const host = membrane.getHostObject(receiver);
            if (!host) return engine.call(original, args, receiver);
            try {
              return membrane.toEngine(Reflect.apply(native, host, args.map(membrane.toHost)));
            } catch (error) {
              throw new EngineApplicationError(membrane.toEngine(error));
            }
          },
        );
        engine.call(define, [
          callback,
          Value("length"),
          engine.createRecord([["value", engine.get(original, "length")]]),
        ]);
        callbacks.set(original, callback);
        engine.set(record, field, callback);
      }
      engine.call(define, [prototype, engineKey, record]);
    }
  }
};
