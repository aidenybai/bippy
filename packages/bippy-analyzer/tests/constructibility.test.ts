import { expect, it } from "vite-plus/test";
import { getConstructibility, isNativeConstructor } from "../src/evaluate/constructibility.js";
import { loadHostRealm } from "../src/host/host-realm.js";
import { objectValue, UNDEFINED_VALUE, unknownValue } from "../src/evaluate/values.js";
import { evaluateCases } from "./helpers/differential-evaluator.js";

it("retains uncertainty for opaque callable capabilities", () => {
  const realm = loadHostRealm("node");
  expect(getConstructibility(unknownValue("target"), realm)).toBeNull();
  expect(
    getConstructibility(
      { kind: "native-function", name: "opaque", call: () => UNDEFINED_VALUE },
      realm,
    ),
  ).toBeNull();
  expect(
    getConstructibility(
      {
        kind: "native-function",
        name: "constructor",
        call: () => UNDEFINED_VALUE,
        construct: () => objectValue(),
      },
      realm,
    ),
  ).toBe(true);
  expect(getConstructibility({ kind: "global", name: "Buffer" }, realm)).toBeNull();
});
it("classifies native constructor slots without executing targets", () => {
  const callable = () => {
    throw new Error("body");
  };
  const Constructor = class {
    constructor() {
      throw new Error("body");
    }
  };
  for (const target of [
    Constructor,
    Constructor.bind(null),
    Array,
    Map,
    Date,
    Error,
    Uint8Array,
    Symbol,
    BigInt,
  ])
    expect(isNativeConstructor(target)).toBe(true);
  for (const target of [callable, callable.bind(null), {}, Math.max, Reflect.construct])
    expect(isNativeConstructor(target)).toBe(false);
});
it("does not read proxy properties or invoke construct traps", () => {
  const unexpectedOperation = (): never => {
    throw new Error("unexpected trap");
  };
  const Constructor = class {};
  for (const target of [Constructor, () => 0]) {
    const proxy = new Proxy(target, { get: unexpectedOperation, construct: unexpectedOperation });
    expect(isNativeConstructor(proxy)).toBe(target === Constructor);
  }
});
it("keeps revoked proxy constructor slots distinct", () => {
  const Constructor = class {};
  for (const target of [Constructor, () => 0]) {
    const { proxy, revoke } = Proxy.revocable(target, {});
    revoke();
    expect(isNativeConstructor(proxy)).toBe(target === Constructor);
  }
});
it("classifies interpreted and bound functions independently of added prototypes", async () => {
  const [result] = await evaluateCases([
    {
      name: "constructor slots",
      body: "const normal=function(){};const arrow=()=>0;Object.defineProperty(arrow,'prototype',{value:{}});const method=({method(){}}).method;return [normal,normal.bind(null),class{},arrow,arrow.bind(null),method,async()=>0,function*(){}];",
    },
  ]);
  if (result.kind !== "list") throw new Error("Expected callable list");
  expect(
    result.items.map((value) => getConstructibility(value, loadHostRealm("ecmascript"))),
  ).toEqual([true, true, true, false, false, false, false, false]);
});
