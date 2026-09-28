import { expect, it } from "vite-plus/test";
import { withFixture } from "./helpers/engine-fixture.js";
import { getNativeGcObservation } from "./helpers/native-gc.js";

const collections = [
  { name: "Map keys", create: "new Map([[target, 1]])", read: "collection.has(reference.deref())" },
  {
    name: "Map values",
    create: "new Map([[1, target]])",
    read: "collection.get(1) === reference.deref()",
  },
  { name: "Set values", create: "new Set([target])", read: "collection.has(reference.deref())" },
];

it.each(
  collections.flatMap((collection) =>
    ["{}", "Symbol('retained')"].map((target) => ({ ...collection, target })),
  ),
)("retains $target through $name", async ({ create, read, target }) => {
  const setup = `var collection, reference; (() => { const target = ${target}; reference = new WeakRef(target); collection = ${create}; })();`;
  const observation = `JSON.stringify([reference.deref() !== undefined, ${read}])`;
  const expected = getNativeGcObservation(setup, observation);
  expect(expected).toBe("[true,true]");
  await withFixture(({ api, evaluate, readString }) => {
    evaluate(setup);
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString(observation)).toBe(expected);
  });
});

it("marks cyclic nested collections without invoking guest iteration methods", async () => {
  const setup = `
    var collection, reference;
    (() => {
      const target = {};
      reference = new WeakRef(target);
      const nested = new Set([target]);
      collection = new Map([[1, nested]]);
      nested.add(collection);
      collection.set(collection, collection);
    })();
    collection.entries = collection.values = collection[Symbol.iterator] = () => { throw new Error('iteration'); };
    collection.get(1).values = collection.get(1)[Symbol.iterator] = () => { throw new Error('iteration'); };
  `;
  const observation =
    "JSON.stringify([reference.deref() !== undefined, collection.get(1).has(reference.deref()), collection.get(collection) === collection])";
  const expected = getNativeGcObservation(setup, observation);
  expect(expected).toBe("[true,true,true]");
  await withFixture(({ api, evaluate, readString }) => {
    evaluate(setup);
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString(observation)).toBe(expected);
  });
});

it.each([
  { create: "new Map([[target, 1]])", remove: "collection.delete(reference.deref())" },
  { create: "new Map([[1, target]])", remove: "collection.delete(1)" },
  { create: "new Map([[1, target]])", remove: "collection.set(1, null)" },
  { create: "new Map([[1, target]])", remove: "collection.clear()" },
  { create: "new Set([target])", remove: "collection.delete(reference.deref())" },
  { create: "new Set([target])", remove: "collection.clear()" },
])("does not retain removed entries: $create / $remove", async ({ create, remove }) => {
  await withFixture(({ api, evaluate, readString }) => {
    evaluate(
      `var collection, reference; (() => { const target = {}; collection = ${create}; reference = new WeakRef(target); })();`,
    );
    evaluate(remove);
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref() === undefined)")).toBe("true");
  });
});

it.each(["new WeakMap([[target, {}]])", "new WeakSet([target])"])(
  "does not promote weak entries to strong roots: %s",
  async (create) => {
    await withFixture(({ api, evaluate, readString }) => {
      evaluate(
        `var collection, reference; (() => { const target = {}; collection = ${create}; reference = new WeakRef(target); })();`,
      );
      api.surroundingAgent.AgentRecord.KeptAlive.clear();
      api.gc();
      expect(readString("String(reference.deref() === undefined)")).toBe("true");
    });
  },
);

it("does not schedule finalization for a strongly retained collection entry", async () => {
  await withFixture(({ api, evaluate, readString }) => {
    evaluate(
      "var collection, registry = new FinalizationRegistry(() => {}); (() => { const target = {}; collection = new Set([target]); registry.register(target, 'held'); })();",
    );
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(api.surroundingAgent.finalizationRegistryScheduledForCleanup.size).toBe(0);
    expect(readString("String(collection.size)")).toBe("1");
  });
});
