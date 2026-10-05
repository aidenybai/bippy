import { EngineMembrane } from "./membrane.js";
import { EngineApplicationError, getPrimitive } from "./engine-runtime.js";
import { Value } from "#engine";
import { installIntrinsicBridge } from "./intrinsic-bridge.js";
import { installStructuredClone } from "./structured-clone.js";
import { createEngineConsole } from "./console.js";

export const installCompatibility = (membrane: EngineMembrane): void => {
  const { engine } = membrane;
  installIntrinsicBridge(membrane);
  installStructuredClone(membrane);
  engine.setGlobal("Intl", membrane.toEngine(Intl));
  engine.setGlobal("process", membrane.toEngine({ env: { NODE_ENV: "development" } }));
  engine.setGlobal("console", membrane.toEngine(createEngineConsole()));
  for (const name of [
    "ArrayBuffer",
    "SharedArrayBuffer",
    "DataView",
    "Int8Array",
    "Uint8Array",
    "Uint8ClampedArray",
    "Int16Array",
    "Uint16Array",
    "Int32Array",
    "Uint32Array",
    "Float32Array",
    "Float64Array",
    "BigInt64Array",
    "BigUint64Array",
    "Atomics",
  ]) {
    engine.setGlobal(name, membrane.toEngine(Reflect.get(globalThis, name)));
  }
  const originalToString = engine.evaluate("Object.prototype.toString");
  const toString = engine.createFunction("toString", (args, receiver) => {
    const native = membrane.getHostObject(receiver);
    if (!native) return engine.call(originalToString, args, receiver);
    try {
      return Value(Object.prototype.toString.call(native));
    } catch (error) {
      throw new EngineApplicationError(membrane.toEngine(error));
    }
  });
  engine.call(
    engine.evaluate(
      "(toString)=>Object.defineProperty(Object.prototype,'toString',{value:toString,writable:true,configurable:true})",
    ),
    [toString],
  );
  const define = engine.evaluate(
    "(target,key,descriptor)=>Object.defineProperty(target,key,descriptor)",
  );
  for (const name of ["Number", "BigInt"]) {
    const unbox = engine.evaluate(`${name}.prototype.valueOf`);
    const prototype = engine.evaluate(`${name}.prototype`);
    const nativePrototype = name === "Number" ? Number.prototype : BigInt.prototype;
    const method = engine.createFunction("toLocaleString", (args, receiver) => {
      const primitive = getPrimitive(engine.call(unbox, [], receiver));
      try {
        return membrane.toEngine(
          Reflect.apply(nativePrototype.toLocaleString, primitive, args.map(membrane.toHost)),
        );
      } catch (error) {
        throw new EngineApplicationError(membrane.toEngine(error));
      }
    });
    engine.call(define, [
      prototype,
      Value("toLocaleString"),
      engine.createRecord([
        ["value", method],
        ["writable", Value.true],
        ["configurable", Value.true],
      ]),
    ]);
  }
  for (const name of ["localeCompare", "toLocaleLowerCase", "toLocaleUpperCase"]) {
    const descriptor = Object.getOwnPropertyDescriptor(String.prototype, name);
    if (descriptor)
      engine.call(define, [
        engine.evaluate("String.prototype"),
        Value(name),
        membrane.toEngine(descriptor),
      ]);
  }
  for (const [name, prototype] of [
    ["String", String.prototype],
    ["Object", Object.prototype],
  ] satisfies Array<[string, object]>) {
    const target = engine.evaluate(`${name}.prototype`);
    const has = engine.evaluate("(target,key)=>Object.hasOwn(target,key)");
    for (const key of Object.getOwnPropertyNames(prototype)) {
      if (getPrimitive(engine.call(has, [target, membrane.toEngine(key)]))) continue;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
      if (descriptor)
        engine.call(define, [target, membrane.toEngine(key), membrane.toEngine(descriptor)]);
    }
  }
};
