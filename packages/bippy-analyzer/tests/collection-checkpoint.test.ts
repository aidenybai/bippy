import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { withFixture } from "./helpers/engine-fixture.js";

const getSetup = (kind: string): string => `
  var object = { value: 1 },
    symbol = Symbol("key"),
    getterCalls = 0;
  var target = ${kind === "Map" ? "new Map([['deleted',0],[undefined,1],[NaN,2],[-0,3],[object,object],[symbol,4]])" : "new Set(['deleted',undefined,NaN,-0,object,symbol])"};
  target.delete("deleted");
  ${kind === "Map" ? "target.set('self',target)" : "target.add(target)"};
  var alias = target;
  var entries = ${kind}.prototype.entries;
  var size = Object.getOwnPropertyDescriptor(
    ${kind}.prototype,
    "size"
  ).get;
  var getter = () => {
    getterCalls++;
    throw new Error("getter");
  };
  Object.defineProperty(target, "accessor", { get: getter, configurable: true });
  target.extra = object;
  var encode = (value) =>
    value === target
      ? "self"
      : value === object
      ? "object"
      : typeof value === "symbol"
      ? String(value)
      : Object.is(value, -0)
      ? "-0"
      : String(value);
`;
const observation = `JSON.stringify({
    entries: Array.from(entries.call(target), (pair) => pair.map(encode)),
    size: size.call(target),
    keys: Reflect.ownKeys(target).map(String),
    extra: encode(target.extra),
    getterCalls,
    getter: Object.getOwnPropertyDescriptor(target, "accessor").get === getter,
    extensible: Object.isExtensible(target),
    alias: alias === target,
    objectValue: object.value,
    prototype: Object.getPrototypeOf(target) === null ? "null" : "original",
  })`;

it.each(
  ["Map", "Set"].flatMap((kind) => [false, true].map((isReversed) => ({ kind, isReversed }))),
)(
  "restores $kind lists, tombstones and identities, reversed=$isReversed",
  async ({ kind, isReversed }) => {
    await withFixture(({ api, evaluate, getObject, readString }) => {
      const setup = getSetup(kind);
      evaluate(setup);
      const target = getObject("target");
      const data = api.isMapObject(target)
        ? target.MapData
        : api.isSetObject(target)
          ? target.SetData
          : undefined;
      if (!data) throw new Error("Expected collection data");
      const originalEntries = [...data];
      const properties = target.properties;
      const checkpoint = api.createStateCheckpoint({
        objects: [target, getObject("object"), target],
      });
      expect(checkpoint.objectCount).toBe(2);
      const baseline = readString(observation);
      expect(baseline).toBe(
        runInNewContext(`
        ${setup};
        ${observation}
      `),
      );
      const actions = [
        `
          ${
            kind === "Map"
              ? `
              target.set(object, 7);
              target.delete(NaN);
              target.set(NaN, 9);
              target.set("new", 3)
            `
              : `
              target.delete(object);
              target.add(object);
              target.delete(NaN);
              target.add(NaN);
              target.add("new")
            `
          };
          object.value = 2;
          target.extra = 8;
          Object.freeze(target);
        `,
        `
          target.clear();
          ${kind === "Map" ? "target.set(undefined,target)" : "target.add(undefined)"};
          object.value = 3;
          Object.setPrototypeOf(target, null);
          Object.seal(target);
        `,
        `
          ${
            kind === "Map"
              ? `
              target.delete(undefined);
              target.set(undefined, 11)
            `
              : `
              target.delete(undefined);
              target.add(undefined)
            `
          };
          delete target.extra;
          target.extra = object;
          Object.preventExtensions(target);
        `,
      ];
      for (const action of isReversed ? [...actions].reverse() : actions) {
        evaluate(action);
        expect(readString(observation)).toBe(
          runInNewContext(`
          ${setup};
          ${action};
          ${observation}
        `),
        );
        checkpoint.restore();
        expect(target.properties === properties).toBe(true);
        expect(
          (api.isMapObject(target)
            ? target.MapData
            : api.isSetObject(target)
              ? target.SetData
              : undefined) === data,
        ).toBe(true);
        expect(data.length).toBe(originalEntries.length);
        for (let index = 0; index < data.length; index++)
          expect(data[index] === originalEntries[index]).toBe(true);
        expect(readString(observation)).toBe(baseline);
      }
      checkpoint.release();
    });
  },
);

it.each(["Map", "Set"])(
  "restores frozen %s data without invoking guest iteration",
  async (kind) => {
    await withFixture(({ api, evaluate, getObject, readString }) => {
      const target = getObject(
        `
          var target = new ${kind}(${kind === "Map" ? "[[1,2]]" : "[1]"});
          target[Symbol.iterator] = () => {
            throw new Error("iterator");
          };
          Object.freeze(target);
          target
        `,
      );
      const checkpoint = api.createStateCheckpoint({ objects: [target] });
      evaluate(`
        target.clear();
        ${kind === "Map" ? "target.set(3,4)" : "target.add(3)"}
      `);
      checkpoint.restore();
      expect(
        readString(
          "JSON.stringify([Object.isFrozen(target),target.size,target.has(1),target.has(3)])",
        ),
      ).toBe("[true,1,true,false]");
      checkpoint.release();
    });
  },
);

it.each(
  ["map-key", "map-value", "set-value"].flatMap((location) =>
    ["{}", "Symbol('held')"].map((value) => ({ location, value })),
  ),
)("roots saved $location $value until release", async ({ location, value }) => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    const expression =
      location === "map-key"
        ? "new Map([[held,0]])"
        : location === "map-value"
          ? "new Map([[0,held]])"
          : "new Set([held])";
    const target = getObject(
      `
        var reference;
        var target = (() => {
          const held = ${value};
          reference = new WeakRef(held);
          return ${expression};
        })();
        target
      `,
    );
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    evaluate("target.clear()");
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref()!==undefined)")).toBe("true");
    checkpoint.restore();
    checkpoint.release();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref()!==undefined)")).toBe("true");
    evaluate("target.clear()");
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref()===undefined)")).toBe("true");
  });
});

it.each(["Map", "Set"])(
  "preflights a replaced %s data list before any restoration",
  async (kind) => {
    await withFixture(({ api, evaluate, getObject, readString }) => {
      const first = getObject("var first={value:1};first");
      const target = getObject(`
        var target = new ${kind}();
        target
      `);
      const checkpoint = api.createStateCheckpoint({ objects: [first, target] });
      const slot = `${kind}Data`;
      const original = Reflect.get(target, slot);
      evaluate("first.value=2");
      Reflect.set(target, slot, []);
      expect(() => checkpoint.restore()).toThrow("collection data list changed");
      expect(readString("String(first.value)")).toBe("2");
      Reflect.set(target, slot, original);
      checkpoint.restore();
      expect(readString("String(first.value)")).toBe("1");
      checkpoint.release();
    });
  },
);

it.each(["Map", "Set"])(
  "leaves unselected %s iterators and referenced objects unrewound",
  async (kind) => {
    await withFixture(({ api, evaluate, getObject, readString }) => {
      const target = getObject(
        `
          var object = { value: 1 };
          var target = new ${kind}(${kind === "Map" ? "[[1,object],[2,object]]" : "[object,2]"});
          var iterator = target.keys();
          target
        `,
      );
      const checkpoint = api.createStateCheckpoint({ objects: [target] });
      evaluate(`
        iterator.next();
        object.value = 2;
        target.clear()
      `);
      checkpoint.restore();
      expect(readString("JSON.stringify([iterator.next().value,object.value])")).toBe("[2,2]");
      expect(() => api.createStateCheckpoint({ objects: [target, getObject("iterator")] })).toThrow(
        "without additional internal state",
      );
      checkpoint.release();
    });
  },
);

it("restores a shared Map/Set/array graph and selected binding cells", async () => {
  await withFixture(({ api, realm, evaluate, getObject, readString }) => {
    evaluate(
      `
        var array = [];
        var map = new Map([[array, array]]);
        var set = new Set([map]);
        array.push(set);
        let selected = map;
      `,
    );
    const checkpoint = api.createStateCheckpoint({
      objects: [getObject("map"), getObject("set"), getObject("array")],
      environments: [realm.GlobalEnv.DeclarativeRecord],
    });
    evaluate(`
      map.set("branch", set);
      set.add("branch");
      selected = set
    `);
    const inner = api.createStateCheckpoint({
      objects: [getObject("map"), getObject("set"), getObject("array")],
      environments: [realm.GlobalEnv.DeclarativeRecord],
    });
    evaluate(`
      map.clear();
      set.clear();
      array.length = 0;
      selected = null
    `);
    inner.restore();
    expect(
      readString("JSON.stringify([map.get('branch')===set,set.has('branch'),selected===set])"),
    ).toBe("[true,true,true]");
    inner.release();
    checkpoint.restore();
    expect(
      readString(
        "JSON.stringify([selected===map,map.get(array)===array,set.has(map),array[0]===set])",
      ),
    ).toBe("[true,true,true,true]");
    checkpoint.release();
  });
});

it.each([
  "new WeakMap()",
  "new WeakSet()",
  "new Proxy(new Map(),{})",
  `new (class extends Set {
      #value = 1;
    })()`,
])(
  "rejects unsupported collection state %s without registering a partial checkpoint",
  async (source) => {
    await withFixture(({ api, getObject }) => {
      const outer = api.createStateCheckpoint({ objects: [getObject("new Map()")] });
      expect(() =>
        api.createStateCheckpoint({ objects: [getObject("new Set()"), getObject(source)] }),
      ).toThrow("without additional internal state");
      outer.restore();
      outer.release();
    });
  },
);

it.each(["Map", "Set"])(
  "preserves LIFO, preview, and Agent ownership for %s checkpoints",
  async (kind) => {
    await withFixture(({ api, getObject }) => {
      const target = getObject(`new ${kind}()`);
      const outer = api.createStateCheckpoint({ objects: [target] });
      const inner = api.createOrdinaryObjectCheckpoint([getObject("({})")]);
      expect(() => outer.restore()).toThrow("last-in-first-out");
      inner.release();
      api.surroundingAgent.debugger_scopePreview(() => {
        expect(() => outer.restore()).toThrow("during preview");
      });
      const owner = api.surroundingAgent;
      api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
      try {
        expect(() => api.createStateCheckpoint({ objects: [target] })).toThrow("current agent");
        expect(() => outer.restore()).toThrow("another agent");
      } finally {
        api.setSurroundingAgent(owner);
      }
      outer.restore();
      outer.release();
      expect(() => outer.restore()).toThrow("released");
    });
  },
);
