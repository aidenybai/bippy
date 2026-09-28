import * as published from "@engine262/engine262";
import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { withFixture } from "./helpers/engine-fixture.js";

const setup = `
  var prefixRuns = (globalThis.prefixRuns ?? 0) + 1;
  var getterCalls = 0;
  var key = Symbol('key');
  var prototype = { inherited: 7 };
  var shared = { count: 1 };
  var target = Object.create(prototype);
  target.first = 1;
  target.second = 2;
  target.link = shared;
  target[key] = 3;
  var getter = () => { getterCalls++; throw new Error('getter must not run'); };
  Object.defineProperty(target, 'hidden', { value: -0, writable: true, configurable: true });
  Object.defineProperty(target, 'accessor', { get: getter, configurable: true });
  var alias = target;
`;
const observe = `JSON.stringify({
  keys: Reflect.ownKeys(target).map(key => typeof key === 'symbol' ? String(key) : key),
  properties: Reflect.ownKeys(target).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    return [String(key), descriptor.enumerable, descriptor.configurable,
      descriptor.writable, descriptor.get === getter,
      descriptor.value === shared ? 'shared' : Object.is(descriptor.value, -0) ? '-0' : descriptor.value];
  }),
  count: shared.count,
  prototype: Object.getPrototypeOf(target) === prototype,
  extensible: Object.isExtensible(target),
  alias: alias === target,
  getterCalls,
  prefixRuns
})`;
const actions = [
  `alias.first = 8; delete alias.second; alias.second = 9;
   alias.link.count = 4; delete alias[key];
   Object.defineProperty(alias, 'accessor', { value: 12 });
   Object.setPrototypeOf(alias, null); Object.freeze(alias);`,
  `delete target.first; target.first = 5; shared.count = 6;
   Object.defineProperty(target, 'hidden', { value: NaN });
   target[key] = 10; Object.seal(target);`,
  `Object.defineProperty(target, 'writing', { configurable: true,
      set(value) { shared.count = value; throw new Error('setter'); } });
   try { target.writing = 11; } catch (error) { target.failure = error.message; }
   finally { target.finalized = true; }`,
];

const getPublishedObservation = (source: string) => {
  const previous = published.surroundingAgent;
  published.setSurroundingAgent(new published.Agent({ startEventLoop: false }));
  try {
    const result = published.EnsureCompletion(
      new published.ManagedRealm().evaluateScriptSkipDebugger(source),
    );
    if (result.Type !== "normal" || result.Value.type !== "String")
      throw new Error("Expected a published observation");
    return result.Value.value;
  } finally {
    published.setSurroundingAgent(previous);
  }
};

it.each([false, true])(
  "restores aliases, descriptors, order, prototype and integrity, reversed %s",
  async (isReversed) => {
    await withFixture(({ api, evaluate, getObject, readString }) => {
      evaluate(setup);
      const target = getObject("target");
      const shared = getObject("shared");
      const properties = target.properties;
      const checkpoint = api.createOrdinaryObjectCheckpoint([target, shared, target]);
      expect(checkpoint.scope).toBe("selected-ordinary-objects-v1");
      expect(checkpoint.size).toBe(2);
      const original = readString(observe);
      expect(original).toBe(runInNewContext(`${setup};${observe}`));
      for (const action of isReversed ? [...actions].reverse() : actions) {
        evaluate(action);
        const result = readString(observe);
        expect(result).toBe(getPublishedObservation(`${setup};${action};${observe}`));
        expect(result).toBe(runInNewContext(`${setup};${action};${observe}`));
        checkpoint.restore();
        expect(target.properties === properties).toBe(true);
        expect(readString(observe)).toBe(original);
      }
      checkpoint.release();
    });
  },
);

it.each([false, true])(
  "validates the restored prototype graph, selected parent %s",
  async (includeParent) => {
    await withFixture(({ api, getObject, evaluate, readString }) => {
      const target = getObject(
        "var parent = {}; var target = Object.create(parent); target.value = 1; target",
      );
      const checkpoint = api.createOrdinaryObjectCheckpoint(
        includeParent ? [target, getObject("parent")] : [target],
      );
      evaluate(
        "Object.setPrototypeOf(target, null); Object.setPrototypeOf(parent, target); target.value = 2",
      );
      if (includeParent) {
        checkpoint.restore();
        expect(
          readString(
            "JSON.stringify([Object.getPrototypeOf(target) === parent, Object.getPrototypeOf(parent) === Object.prototype, target.value])",
          ),
        ).toBe("[true,true,1]");
      } else {
        expect(() => checkpoint.restore()).toThrow("prototype cycle");
        expect(readString("String(target.value)")).toBe("2");
        evaluate("Object.setPrototypeOf(parent, null)");
        checkpoint.restore();
        expect(readString("String(target.value)")).toBe("1");
      }
      checkpoint.release();
    });
  },
);

it("does not invoke exotic prototype traps during restore", async () => {
  await withFixture(({ api, getObject, evaluate, readString }) => {
    const target = getObject(
      "var prototype = new Proxy({}, { getPrototypeOf() { throw new Error('trap'); } }); var target = Object.create(prototype); target",
    );
    const checkpoint = api.createOrdinaryObjectCheckpoint([target]);
    evaluate("Object.setPrototypeOf(target, null)");
    checkpoint.restore();
    expect(readString("String(Object.getPrototypeOf(target) === prototype)")).toBe("true");
    checkpoint.release();
  });
});

it("requires nested checkpoint order and supports repeated restores", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    const target = getObject("var target = { value: 1 }; target");
    const outer = api.createOrdinaryObjectCheckpoint([target]);
    evaluate("target.value = 2");
    const inner = api.createOrdinaryObjectCheckpoint([target]);
    evaluate("target.value = 3");
    expect(() => outer.restore()).toThrow("last-in-first-out");
    expect(() => outer.release()).toThrow("last-in-first-out");
    expect(readString("String(target.value)")).toBe("3");
    inner.restore();
    inner.release();
    expect(readString("String(target.value)")).toBe("2");
    outer.restore();
    evaluate("target.value = 4");
    outer.restore();
    expect(readString("String(target.value)")).toBe("1");
    outer.release();
    evaluate("target.value = 5");
    expect(() => outer.restore()).toThrow("released");
    expect(() => outer.release()).toThrow("released");
    expect(readString("String(target.value)")).toBe("5");
  });
});

it.each([
  "[]",
  "new Map()",
  "new Set()",
  "new Date()",
  "/value/",
  "Promise.resolve(1)",
  "new Uint8Array(2)",
  "new ArrayBuffer(2)",
  "Object(1)",
  "Object('value')",
  "function() {}",
  "new Error('value')",
  "[][Symbol.iterator]()",
  "new (class { #value = 1; })()",
  "new Proxy({}, { ownKeys() { throw new Error('trap must not run'); } })",
])("rejects unsupported internal state: %s", async (expression) => {
  await withFixture(({ api, getObject }) => {
    const outer = api.createOrdinaryObjectCheckpoint([]);
    expect(() =>
      api.createOrdinaryObjectCheckpoint([getObject("({})"), getObject(`(${expression})`)]),
    ).toThrow("without additional internal state");
    outer.restore();
    outer.release();
  });
});

it("rejects cross-agent capture, restore and release without closing the checkpoint", async () => {
  await withFixture(({ api, getObject }) => {
    const owner = api.surroundingAgent;
    const target = getObject("({ value: 1 })");
    const checkpoint = api.createOrdinaryObjectCheckpoint([target]);
    api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
    try {
      expect(() => api.createOrdinaryObjectCheckpoint([target])).toThrow("current agent");
      expect(() => checkpoint.restore()).toThrow("another agent");
      expect(() => checkpoint.release()).toThrow("another agent");
    } finally {
      api.setSurroundingAgent(owner);
    }
    checkpoint.restore();
    checkpoint.release();
  });
});

it("validates preview restrictions before restoring any object", async () => {
  await withFixture(({ api, getObject, evaluate, readString }) => {
    const existing = getObject("var existing = { value: 1 }; existing");
    api.surroundingAgent.debugger_scopePreview(() => {
      const fresh = api.OrdinaryObjectCreate(api.Value.null);
      fresh.properties.set(
        "value",
        api.Descriptor({
          Value: api.Value(2),
          Writable: true,
          Enumerable: true,
          Configurable: true,
        }),
      );
      const checkpoint = api.createOrdinaryObjectCheckpoint([fresh, existing]);
      fresh.properties.set(
        "value",
        api.Descriptor({
          Value: api.Value(3),
          Writable: true,
          Enumerable: true,
          Configurable: true,
        }),
      );
      expect(() => checkpoint.restore()).toThrow("during preview");
      expect(fresh.properties.get("value")?.Value).toEqual(api.Value(3));
      checkpoint.release();
    });
    evaluate("existing.value = 4");
    expect(readString("String(existing.value)")).toBe("4");
  });
});

it("removes private brands installed after capture", async () => {
  await withFixture(({ api, getObject, evaluate, readString }) => {
    const target = getObject(`
      var target = {};
      class Base { constructor() { return target; } }
      class Stamp extends Base { #value = 1; static has(value) { return #value in value; } }
      target;
    `);
    const checkpoint = api.createOrdinaryObjectCheckpoint([target]);
    evaluate("new Stamp()");
    expect(readString("String(Stamp.has(target))")).toBe("true");
    checkpoint.restore();
    expect(readString("String(Stamp.has(target))")).toBe("false");
    evaluate("new Stamp()");
    expect(readString("String(Stamp.has(target))")).toBe("true");
    checkpoint.restore();
    checkpoint.release();
  });
});

it("restores cyclic queue links without copying their identities", async () => {
  await withFixture(({ api, getObject, evaluate, readString }) => {
    const queue = getObject(`
      var first = { value: 1, next: null };
      var second = { value: 2, next: first };
      first.next = second;
      var queue = { pending: second };
      queue;
    `);
    const checkpoint = api.createOrdinaryObjectCheckpoint([
      queue,
      getObject("first"),
      getObject("second"),
    ]);
    evaluate("first.next = first; second.next = second; queue.pending = first");
    checkpoint.restore();
    expect(
      readString(
        "JSON.stringify([queue.pending === second, first.next === second, second.next === first])",
      ),
    ).toBe("[true,true,true]");
    checkpoint.release();
  });
});

it("does not claim to restore unselected objects or captured bindings", async () => {
  await withFixture(({ api, getObject, evaluate, readString }) => {
    const target = getObject("let binding = 1; var target = { child: { value: 1 } }; target");
    const checkpoint = api.createOrdinaryObjectCheckpoint([target]);
    evaluate("binding = 2; target.child.value = 3; target.extra = 4");
    checkpoint.restore();
    expect(
      readString("JSON.stringify([binding, target.child.value, Object.hasOwn(target, 'extra')])"),
    ).toBe("[2,3,false]");
    checkpoint.release();
  });
});

it("preserves objects from distinct realms owned by the same agent", async () => {
  await withFixture(({ api, getObject }) => {
    const first = getObject("({})");
    const otherRealm = new api.ManagedRealm();
    const result = api.EnsureCompletion(otherRealm.evaluateScriptSkipDebugger("({})"));
    if (
      result.Type !== "normal" ||
      !api.isOrdinaryObject(result.Value) ||
      !api.isOrdinaryObject(first)
    )
      throw new Error("Expected ordinary objects");
    const second = result.Value;
    const prototype = second.Prototype;
    expect(first.ownerAgent === second.ownerAgent).toBe(true);
    expect(first.Prototype === second.Prototype).toBe(false);
    const checkpoint = api.createOrdinaryObjectCheckpoint([first, second]);
    second.Prototype = first.Prototype;
    checkpoint.restore();
    expect(second.Prototype === prototype).toBe(true);
    checkpoint.release();
  });
});

it.each([
  {
    name: "prototype",
    setup:
      "var holder = Object.create({ marker: 1 }); var reference = new WeakRef(Object.getPrototypeOf(holder)); holder",
    remove: "Object.setPrototypeOf(holder, null)",
  },
  {
    name: "symbol key",
    setup:
      "var holder = { [Symbol('key')]: 1 }; var reference = new WeakRef(Reflect.ownKeys(holder)[0]); holder",
    remove: "Reflect.ownKeys(holder).forEach(key => delete holder[key])",
  },
  {
    name: "getter",
    setup:
      "var holder = { get value() { return 1; } }; var reference = new WeakRef(Object.getOwnPropertyDescriptor(holder, 'value').get); holder",
    remove: "delete holder.value",
  },
])("marks saved $name references as live", async (fixture) => {
  await withFixture(({ api, getObject, evaluate, readString }) => {
    const holder = getObject(fixture.setup);
    const checkpoint = api.createOrdinaryObjectCheckpoint([holder]);
    evaluate(fixture.remove);
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref() !== undefined)")).toBe("true");
    checkpoint.release();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref() === undefined)")).toBe("true");
  });
});

it("keeps saved property values alive until release", async () => {
  await withFixture(({ api, getObject, evaluate, readString }) => {
    const holder = getObject(
      "var holder = { child: {} }; var reference = new WeakRef(holder.child); holder",
    );
    const checkpoint = api.createOrdinaryObjectCheckpoint([holder]);
    evaluate("delete holder.child");
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref() !== undefined)")).toBe("true");
    checkpoint.restore();
    expect(readString("String(reference.deref() === holder.child)")).toBe("true");
    evaluate("delete holder.child");
    checkpoint.release();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref() === undefined)")).toBe("true");
  });
});
