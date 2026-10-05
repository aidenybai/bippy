import { types } from "node:util";
import {
  IsCallable,
  isMapObject,
  isSetObject,
  isRegExpObject,
  isDateObject,
  isProxyExoticObject,
  isPromiseObject,
  isWeakMapObject,
  isWeakSetObject,
  isWeakRef,
  isErrorObject,
  ObjectValue,
  Value,
} from "#engine";
import { EngineApplicationError } from "./engine-runtime.js";
import type { EngineMembrane } from "./membrane.js";

export const installStructuredClone = (membrane: EngineMembrane): void => {
  const { engine } = membrane;
  const ownKeys = engine.evaluate("Reflect.ownKeys");
  const getDescriptor = engine.evaluate("Reflect.getOwnPropertyDescriptor");
  engine.setGlobal(
    "structuredClone",
    engine.createFunction("structuredClone", (args) => {
      const [input = Value.undefined, options = Value.undefined] = args;
      const seen = new Map<ObjectValue, unknown>();
      const getSnapshot = (value: Value): unknown => {
        if (value.type === "Symbol")
          throw new DOMException("Symbol could not be cloned", "DataCloneError");
        if (!(value instanceof ObjectValue)) return membrane.toHost(value);
        if (seen.has(value)) return seen.get(value);
        const native = membrane.getHostObject(value);
        if (
          native &&
          (types.isAnyArrayBuffer(native) ||
            types.isArrayBufferView(native) ||
            types.isDate(native) ||
            types.isRegExp(native) ||
            types.isNativeError(native) ||
            types.isBoxedPrimitive(native))
        )
          return native;
        if (
          IsCallable(value) ||
          (!native && isProxyExoticObject(value)) ||
          isPromiseObject(value) ||
          isWeakMapObject(value) ||
          isWeakSetObject(value) ||
          isWeakRef(value)
        )
          throw new DOMException("Value could not be cloned", "DataCloneError");
        if ("SymbolData" in value)
          throw new DOMException("Symbol object could not be cloned", "DataCloneError");
        for (const slot of ["NumberData", "StringData", "BooleanData", "BigIntData"]) {
          if (!Reflect.has(value, slot)) continue;
          const scalar: unknown = Reflect.get(value, slot);
          const result: object = Object(scalar instanceof Value ? membrane.toHost(scalar) : scalar);
          seen.set(value, result);
          return result;
        }
        if (isErrorObject(value)) {
          const name = membrane.toHost(engine.get(value, "name"));
          const constructors = new Map<string, ErrorConstructor>([
            ["Error", Error],
            ["TypeError", TypeError],
            ["RangeError", RangeError],
            ["ReferenceError", ReferenceError],
            ["SyntaxError", SyntaxError],
            ["EvalError", EvalError],
            ["URIError", URIError],
          ]);
          const constructor = typeof name === "string" ? (constructors.get(name) ?? Error) : Error;
          const result = new constructor();
          seen.set(value, result);
          const message = engine.getOwnData(value, "message");
          if (message !== undefined && message !== Value.undefined)
            result.message = String(membrane.toHost(message));
          const cause = engine.call(getDescriptor, [value, Value("cause")]);
          if (cause instanceof ObjectValue && engine.get(cause, "value") !== Value.undefined)
            Object.defineProperty(result, "cause", {
              value: getSnapshot(engine.get(cause, "value")),
              configurable: true,
              writable: true,
            });
          return result;
        }
        if (isMapObject(value) || (native && types.isMap(native))) {
          const result = new Map();
          seen.set(value, result);
          const entries = isMapObject(value)
            ? value.MapData.flatMap((entry) =>
                entry.Key === undefined || entry.Value === undefined
                  ? []
                  : [[entry.Key, entry.Value]],
              )
            : Array.from(native instanceof Map ? native.entries() : [], ([key, item]) => [
                membrane.toEngine(key),
                membrane.toEngine(item),
              ]);
          for (const [key, item] of entries) result.set(getSnapshot(key), getSnapshot(item));
          return result;
        }
        if (isSetObject(value) || (native && types.isSet(native))) {
          const result = new Set();
          seen.set(value, result);
          const entries = isSetObject(value)
            ? value.SetData.filter((item) => item !== undefined)
            : Array.from(native instanceof Set ? native : [], membrane.toEngine);
          for (const item of entries) result.add(getSnapshot(item));
          return result;
        }
        if (isDateObject(value)) {
          const result = new Date(value.DateValue);
          seen.set(value, result);
          return result;
        }
        if (isRegExpObject(value)) {
          const result = new RegExp(value.OriginalSource, value.OriginalFlags);
          seen.set(value, result);
          return result;
        }
        const result: Record<string, unknown> | unknown[] = engine.isArray(value) ? [] : {};
        if (Array.isArray(result))
          result.length = Number(membrane.toHost(engine.get(value, "length")));
        seen.set(value, result);
        for (const key of engine.getArray(engine.call(ownKeys, [value]))) {
          if (key.type !== "String") continue;
          const descriptor = engine.call(getDescriptor, [value, key]);
          if (
            !(descriptor instanceof ObjectValue) ||
            engine.get(descriptor, "enumerable") !== Value.true
          )
            continue;
          Object.defineProperty(result, key.value, {
            value: getSnapshot(engine.get(value, key.value)),
            writable: true,
            enumerable: true,
            configurable: true,
          });
        }
        return result;
      };
      try {
        if (args.length === 0) throw new TypeError("structuredClone requires an argument");
        const transferValue =
          options === Value.undefined || options === Value.null
            ? Value.undefined
            : engine.get(engine.getObject(options), "transfer");
        const transfer: ArrayBuffer[] = [];
        if (transferValue !== Value.undefined)
          for (const entry of engine.getArray(transferValue)) {
            const buffer = membrane.toHost(entry);
            if (!(buffer instanceof ArrayBuffer) || transfer.includes(buffer))
              throw new DOMException("Invalid transferable", "DataCloneError");
            transfer.push(buffer);
          }
        const result = structuredClone(getSnapshot(input), { transfer });
        return membrane.toEngine(result);
      } catch (error) {
        if (error instanceof EngineApplicationError) throw error;
        throw new EngineApplicationError(membrane.toEngine(error));
      }
    }),
  );
};
