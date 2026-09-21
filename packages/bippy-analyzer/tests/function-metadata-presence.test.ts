import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { bindFunction } from "../src/evaluate/function-bind.js";
import { createFunctionProperties } from "../src/evaluate/function-metadata.js";
import {
  describeValue,
  getObjectProperty,
  objectValue,
  primitiveValue,
  UNDEFINED_VALUE,
  unknownValue,
} from "../src/evaluate/values.js";
import { loadHostRealm } from "../src/host/host-realm.js";
import { createCallbackValue, createEvaluationContext } from "./helpers/evaluation-context.js";

const unexpectedOperation = (): never => {
  throw new Error("Unexpected metadata operation");
};
it.each([false, true])("checks own length presence before reading metadata: %s", (hasOwnLength) => {
  const native = runInNewContext(
    `(() => {const trace=[];const target=()=>0;delete target.length;Object.setPrototypeOf(target,{get length(){throw new Error('inherited length read');},get name(){trace.push('name:'+(this===target));return 'inherited';}});delete target.name;${hasOwnLength ? "Object.defineProperty(target,'length',{get(){trace.push('length');return undefined;}});" : ""}const bound=Function.prototype.bind.call(target,null);return trace.join('|')+':'+bound.length+':'+bound.name;})()`,
    {},
    { timeout: 1000 },
  );
  const context = createEvaluationContext();
  const target = createCallbackValue(context);
  target.hasStoredMetadata = true;
  target.properties = hasOwnLength
    ? objectValue([{ kind: "property", key: "length", value: UNDEFINED_VALUE }])
    : objectValue();
  const trace: string[] = [];
  const result = bindFunction(
    {
      getRealm: () => loadHostRealm("ecmascript"),
      callAlternatives: unexpectedOperation,
      getProperty: (receiver, key) => {
        expect(receiver).toBe(target);
        if (key === "length") {
          if (!hasOwnLength) return unexpectedOperation();
          trace.push("length");
          return UNDEFINED_VALUE;
        }
        expect(key).toBe("name");
        trace.push("name:true");
        return primitiveValue("inherited");
      },
    },
    target,
    [],
    context,
    null,
  );
  if (result.kind !== "function") throw new Error("Expected bound function");
  const length = getObjectProperty(result.properties, "length");
  const name = getObjectProperty(result.properties, "name");
  if (length.kind !== "primitive" || name.kind !== "primitive")
    throw new Error("Expected metadata");
  expect(trace.join("|") + ":" + length.value + ":" + name.value).toBe(native);
});
it("does not fabricate reads when own metadata presence is unknown", () => {
  const context = createEvaluationContext();
  const target = createCallbackValue(context);
  target.hasStoredMetadata = true;
  target.properties = objectValue([{ kind: "spread", value: unknownValue("opaque properties") }]);
  const result = bindFunction(
    {
      getRealm: unexpectedOperation,
      callAlternatives: unexpectedOperation,
      getProperty: unexpectedOperation,
    },
    target,
    [],
    context,
    null,
  );
  expect(describeValue(result)).toBe("unknown(dynamic bound length presence)");
});
it("stores intrinsic metadata as non-enumerable own entries", () => {
  const properties = createFunctionProperties(primitiveValue(2), primitiveValue("target"));
  expect(properties.entries).toEqual([
    { kind: "property", key: "length", value: primitiveValue(2), isEnumerable: false },
    { kind: "property", key: "name", value: primitiveValue("target"), isEnumerable: false },
  ]);
});
