import { expect, it } from "vite-plus/test";
import { createConcreteRuntime } from "../src/concrete/runtime.js";
import { getCollectedReference } from "./helpers/concrete-gc.js";
import { getNativeGcObservation } from "./helpers/native-gc.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";

it.each(
  ["{value:7}", "Symbol('target')"].flatMap((target) =>
    [false, true].map((isReversed) => ({ target, isReversed })),
  ),
)("retains partial Promise.all $target, reversed=$isReversed", async ({ target, isReversed }) => {
  const setup = `
      var reference, aggregate, fulfill, seen;
      var pending=new Promise(resolve=>{fulfill=resolve;});
      (()=>{const held=${target};reference=new WeakRef(held);aggregate=Promise.all([${isReversed ? "pending,held" : "held,pending"}]);})();
      aggregate.then(values=>{seen=values[${isReversed ? 1 : 0}]===reference.deref();});
    `;
  const native = getNativeGcObservation(
    setup,
    `(fulfill(),await aggregate,JSON.stringify([reference.deref()!==undefined,seen]))`,
  );
  expect(native).toBe("[true,true]");
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(setup);
    runtime.drainJobs();
    expect(await getCollectedReference(runtime)).toBe("true");
    runtime.evaluate("fulfill()");
    runtime.drainJobs();
    expect(runtime.readString("JSON.stringify([reference.deref()!==undefined,seen])")).toBe(native);
    runtime.evaluate("aggregate=null");
    expect(await getCollectedReference(runtime)).toBe("false");
  } finally {
    runtime.dispose();
  }
});

it("retains the result capability when a custom then keeps only the fulfillment callback", async () => {
  const setup = `
    var reference, handler;
    class Aggregate extends Promise { static resolve(value){return value;} }
    reference=new WeakRef(Aggregate.all([{then(resolve){handler=resolve;}}]));
  `;
  expect(getNativeGcObservation(setup, "String(reference.deref()!==undefined)")).toBe("true");
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(setup);
    expect(await getCollectedReference(runtime)).toBe("true");
    runtime.evaluate("handler(7);handler=null");
    runtime.drainJobs();
    expect(await getCollectedReference(runtime)).toBe("false");
  } finally {
    runtime.dispose();
  }
});

it("retains custom capability callback environments until the element callback is discarded", async () => {
  const setup = `
    var reference, handler, seen;
    function Aggregate(executor){
      const held={value:7};reference=new WeakRef(held);
      executor(values=>{seen=reference.deref()===held && values[0]===7;},()=>held);
    }
    Aggregate.resolve=value=>value;
    Promise.all.call(Aggregate,[{then(resolve){handler=resolve;}}]);
  `;
  expect(getNativeGcObservation(setup, "(handler(7),String(seen))")).toBe("true");
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(setup);
    expect(await getCollectedReference(runtime)).toBe("true");
    runtime.evaluate("handler(7)");
    expect(runtime.readString("String(seen)")).toBe("true");
    runtime.evaluate("handler=null");
    expect(await getCollectedReference(runtime)).toBe("false");
  } finally {
    runtime.dispose();
  }
});

it("retains one shared accumulator across detached callbacks without accepting duplicate calls", async () => {
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(`
      var reference, handlers=[], result, seen;
      class Aggregate extends Promise {static resolve(value){return value;}}
      result=Aggregate.all([0,1].map(index=>({then(resolve){handlers[index]=resolve;}})));
      result.then(values=>{seen=[values[0]===reference.deref(),values[1]];});
      (()=>{const held={};reference=new WeakRef(held);handlers[0](held);})();
      handlers[0](99);handlers[0]=null;
    `);
    expect(await getCollectedReference(runtime)).toBe("true");
    runtime.evaluate("handlers[1](7);handlers=null");
    runtime.drainJobs();
    expect(runtime.readString("JSON.stringify(seen)")).toBe("[true,7]");
    runtime.evaluate("result=null");
    expect(await getCollectedReference(runtime)).toBe("false");
  } finally {
    runtime.dispose();
  }
});

it("retains partial SafePerformPromiseAll values through the same element helper", async () => {
  const runtime = await createConcreteRuntime();
  const { api } = await getSymbolicEngine();
  try {
    const first = runtime.evaluate(
      "var reference;(()=>{const held={};reference=new WeakRef(held);return Promise.resolve(held);})()",
    );
    const second = runtime.evaluate(
      "var fulfill;var pending=new Promise(resolve=>{fulfill=resolve;});pending",
    );
    if (!api.isPromiseObject(first) || !api.isPromiseObject(second))
      throw new Error("Expected promises");
    const previous = api.surroundingAgent;
    api.setSurroundingAgent(runtime.agent);
    const pop = runtime.realm.pushTopContext();
    try {
      const aggregate = api.SafePerformPromiseAll([first, second]);
      expect(
        api.EnsureCompletion(
          api.skipDebugger(
            api.CreateDataProperty(runtime.realm.GlobalObject, "aggregate", aggregate),
          ),
        ).Type,
      ).toBe("normal");
    } finally {
      pop?.();
      api.setSurroundingAgent(previous);
    }
    runtime.evaluate("var seen;aggregate.then(values=>{seen=values[0]===reference.deref();});");
    runtime.drainJobs();
    expect(await getCollectedReference(runtime)).toBe("true");
    runtime.evaluate("fulfill()");
    runtime.drainJobs();
    expect(runtime.readString("String(seen)")).toBe("true");
    runtime.evaluate("aggregate=null");
    expect(await getCollectedReference(runtime)).toBe("false");
  } finally {
    runtime.dispose();
  }
});

it("does not retain discarded pending Promise.all cycles", async () => {
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(`
      var reference, aggregate, pending=new Promise(()=>{});
      (()=>{const held={};reference=new WeakRef(held);aggregate=Promise.all([held,pending]);})();
    `);
    runtime.drainJobs();
    expect(await getCollectedReference(runtime)).toBe("true");
    runtime.evaluate("aggregate=null;pending=null");
    expect(await getCollectedReference(runtime)).toBe("false");
  } finally {
    runtime.dispose();
  }
});
