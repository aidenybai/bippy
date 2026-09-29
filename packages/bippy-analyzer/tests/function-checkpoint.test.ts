import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { withFixture } from "./helpers/engine-fixture.js";

const cases = [
  { name: "ordinary", expression: "function(value){return value+1}", call: "target(2)" },
  { name: "arrow", expression: "value=>value+1", call: "target(2)" },
  { name: "method", expression: "({method(value){return value+1}}).method", call: "target(2)" },
  {
    name: "generator",
    expression: "function*(value){yield value+1}",
    call: "target(2).next().value",
  },
  { name: "async", expression: "async value=>value+1", call: "typeof target(2)" },
  {
    name: "bound",
    expression: "(function(value){return this.base+value}).bind({base:4},2)",
    call: "target()",
  },
  {
    name: "bound-constructor",
    expression: "(function(value){this.value=value}).bind(null,4)",
    call: "new target().value",
  },
];
it.each(
  cases.flatMap((fixture) => [false, true].map((isReversed) => ({ ...fixture, isReversed }))),
)("restores $name properties, reversed=$isReversed", async ({ expression, call, isReversed }) => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    const setup = `var target=(${expression}),alias=target;var getter=()=>{throw Error('getter')};Object.defineProperty(target,'accessor',{get:getter,configurable:true});target.tag=1;`;
    const observation = `JSON.stringify([${call},target===alias,target.tag,Reflect.ownKeys(target).map(String),Object.isExtensible(target),Object.getPrototypeOf(target)===null,Object.getOwnPropertyDescriptor(target,'accessor').get===getter])`;
    evaluate(setup);
    const target = getObject("target");
    const properties = target.properties;
    expect(() => api.createOrdinaryObjectCheckpoint([target])).toThrow(
      "ordinary objects without additional internal state",
    );
    const checkpoint = api.createStateCheckpoint({ objects: [target, target] });
    expect(checkpoint.objectCount).toBe(1);
    const baseline = readString(observation);
    expect(baseline).toBe(runInNewContext(`${setup}${observation}`));
    const actions = [
      'target.tag=2;Object.defineProperty(target,"name",{value:"changed"});Object.freeze(target);',
      "delete target.tag;target.tag=3;Object.setPrototypeOf(target,null);Object.seal(target);",
    ];
    try {
      for (const action of isReversed ? [...actions].reverse() : actions) {
        evaluate(action);
        expect(readString(observation)).toBe(runInNewContext(`${setup}${action}${observation}`));
        checkpoint.restore();
        expect(target.properties === properties).toBe(true);
        expect(readString(observation)).toBe(baseline);
      }
    } finally {
      checkpoint.release();
    }
  });
});

it("restores explicitly selected closure bindings, not unselected captured values", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate("var target=(()=>{let count=0;return ()=>++count})();");
    const target = getObject("target");
    if (
      !api.isECMAScriptFunctionObject(target) ||
      !(target.Environment instanceof api.DeclarativeEnvironmentRecord)
    )
      throw Error("Expected closure");
    const propertiesOnly = api.createStateCheckpoint({ objects: [target] });
    evaluate("target()");
    propertiesOnly.restore();
    expect(readString("String(target())")).toBe("2");
    propertiesOnly.release();
    const selected = api.createStateCheckpoint({
      objects: [target],
      environments: [target.Environment],
    });
    const bindings = target.Environment.bindings;
    evaluate("target()");
    selected.restore();
    expect(target.Environment.bindings === bindings).toBe(true);
    expect(readString("String(target())")).toBe("3");
    selected.release();
  });
});

it.each([
  "Call",
  "Construct",
  "Environment",
  "SourceText",
  "HostInitialName",
  "Fields",
  "BoundArguments",
  "BoundThis",
  "BoundTargetFunction",
])("preflights changed %s before any object writes", async (name) => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(
      `var target=${name.startsWith("Bound") ? "(function(){}).bind(null,1)" : "function(){}"},other={value:1};`,
    );
    const target = getObject("target");
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    const checkpoint = api.createStateCheckpoint({ objects: [getObject("other"), target] });
    evaluate("other.value=2");
    Reflect.set(target, name, {});
    expect(() => checkpoint.restore()).toThrow("function metadata changed");
    expect(readString("String(other.value)")).toBe("2");
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else Reflect.deleteProperty(target, name);
    checkpoint.restore();
    expect(readString("String(other.value)")).toBe("1");
    checkpoint.release();
  });
});

it("does not implicitly rewind bound receivers or argument objects", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(
      "var receiver={value:1},argument={value:2};var target=(function(argument){return this.value+argument.value}).bind(receiver,argument);",
    );
    const target = getObject("target");
    const selected = api.createStateCheckpoint({ objects: [target] });
    evaluate("receiver.value=10;argument.value=20;");
    selected.restore();
    expect(readString("String(target())")).toBe("30");
    selected.release();
    const all = api.createStateCheckpoint({
      objects: [target, getObject("receiver"), getObject("argument")],
    });
    evaluate("receiver.value=100;argument.value=200;");
    all.restore();
    expect(readString("String(target())")).toBe("30");
    all.release();
  });
});

it("rejects in-place changes to bound arguments and class-element lists", async () => {
  await withFixture(({ api, evaluate, getObject }) => {
    for (const expression of ["(function(){}).bind(null,1)", "function(){}"]) {
      evaluate(`var target=${expression}`);
      const target = getObject("target");
      const list = api.isBoundFunctionObject(target)
        ? target.BoundArguments
        : api.isECMAScriptFunctionObject(target)
          ? target.Fields
          : undefined;
      if (!list) throw Error("Expected function list");
      const checkpoint = api.createStateCheckpoint({ objects: [target] });
      if (api.isBoundFunctionObject(target)) {
        const original = list[0];
        Reflect.set(list, "0", api.Value(9));
        expect(() => checkpoint.restore()).toThrow("function metadata changed");
        Reflect.set(list, "0", original);
      }
      Reflect.set(list, String(list.length), api.Value(9));
      expect(() => checkpoint.restore()).toThrow("function metadata changed");
      Reflect.set(list, "length", list.length - 1);
      checkpoint.restore();
      checkpoint.release();
    }
  });
});

it("rejects accessor metadata without reading its value", async () => {
  await withFixture(({ api, evaluate, getObject }) => {
    evaluate("var target=function(){}");
    const target = getObject("target");
    const original = Object.getOwnPropertyDescriptor(target, "Realm");
    if (!original) throw Error("Expected Realm metadata");
    let reads = 0;
    Object.defineProperty(target, "Realm", {
      configurable: true,
      get: () => {
        reads++;
        throw Error("metadata getter");
      },
    });
    try {
      expect(() => api.createStateCheckpoint({ objects: [target] })).toThrow(
        "metadata must use data properties",
      );
      expect(reads).toBe(0);
    } finally {
      Object.defineProperty(target, "Realm", original);
    }
  });
});

it.each([
  "class {}",
  "Math.max",
  "new Proxy(function(){},{})",
  "(()=>{class Owner { #value; method(){} };return Owner.prototype.method})()",
])("rejects unsupported function state: %s", async (expression) => {
  await withFixture(({ api, evaluate, getObject }) => {
    evaluate(`var target=(${expression});`);
    expect(() => api.createStateCheckpoint({ objects: [getObject("target")] })).toThrow();
  });
});

it.each(["{}", "Symbol('held')"])(
  "retains saved function properties until release: %s",
  async (held) => {
    await withFixture(({ api, evaluate, getObject, readString }) => {
      const agent = api.surroundingAgent;
      evaluate(
        `var reference;var target=function(){};(()=>{const held=${held};reference=new WeakRef(held);target.held=held})();`,
      );
      const checkpoint = api.createStateCheckpoint({ objects: [getObject("target")] });
      evaluate("delete target.held");
      agent.AgentRecord.KeptAlive.clear();
      api.gc();
      expect(readString("String(reference.deref()!==undefined)")).toBe("true");
      checkpoint.release();
      agent.AgentRecord.KeptAlive.clear();
      api.gc();
      expect(readString("String(reference.deref()===undefined)")).toBe("true");
    });
  },
);
