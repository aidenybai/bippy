import { Value, type ObjectValue } from "#engine";
import type { StaticValue } from "../types.js";
import type { EngineRuntime } from "./engine-runtime.js";
import { EngineUnsupportedError } from "./unsupported.js";

export const createEngineInput = (engine: EngineRuntime, input: StaticValue): Value => {
  const objects = new Map<StaticValue, ObjectValue>();
  const define = engine.evaluate(
    "(target,key,value)=>Object.defineProperty(target,key,{value,writable:true,enumerable:true,configurable:true})",
  );
  const visit = (value: StaticValue): Value => {
    if (value.kind === "primitive") return engine.createPrimitive(value.value);
    const previous = objects.get(value);
    if (previous) return previous;
    if (value.kind === "object") {
      if (
        value.constructedBy ||
        value.hostInterfaceName ||
        value.prototype ||
        value.integrity ||
        value.hasNullPrototype
      )
        throw new EngineUnsupportedError("Engine input object metadata is not ported");
      const result = engine.createRecord([]);
      objects.set(value, result);
      for (const entry of value.entries) {
        if (
          entry.kind !== "property" ||
          entry.accessor ||
          entry.enumerable ||
          entry.configurable ||
          entry.writable ||
          entry.isEnumerable === false
        )
          throw new EngineUnsupportedError(
            "Engine input spreads/accessors/descriptors are not ported",
          );
        engine.call(define, [result, Value(entry.key), visit(entry.value)]);
      }
      return result;
    }
    if (value.kind === "list") {
      if (value.properties?.size || value.nonEnumerableKeys?.size || value.isFrozen)
        throw new EngineUnsupportedError("Engine input array metadata is not ported");
      const result = engine.createArray([]);
      objects.set(value, result);
      for (let index = 0; index < value.items.length; index++)
        engine.call(define, [result, Value(String(index)), visit(value.items[index])]);
      return result;
    }
    throw new EngineUnsupportedError(
      `Engine input ${value.kind} requires the guarded-state port; concrete replay is not a substitute`,
    );
  };
  return visit(input);
};
