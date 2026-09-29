import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { withFixture } from "./helpers/engine-fixture.js";

const setup = `
  var prefixRuns = 1,
    getterCalls = 0;
  var shared = { count: 1 },
    key = Symbol("key");
  var prototype = Object.create(Array.prototype);
  var target = [shared, , 3];
  var alias = target;
  var getter = () => {
    getterCalls++;
    throw new Error("getter");
  };
  Object.defineProperty(target, "2", {
    get: getter,
    enumerable: true,
    configurable: true,
  });
  target.length = 6;
  target[4] = undefined;
  target.extra = -0;
  target[key] = shared;
  target.self = target;
  Object.setPrototypeOf(target, prototype);
`;
const observation = `JSON.stringify({
    keys: Reflect.ownKeys(target).map((key) => String(key)),
    descriptors: Reflect.ownKeys(target).map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      const value = descriptor.value;
      return [
        String(key),
        descriptor.writable,
        descriptor.enumerable,
        descriptor.configurable,
        descriptor.get === getter,
        value === shared
          ? "shared"
          : value === target
          ? "self"
          : Object.is(value, -0)
          ? "-0"
          : value,
      ];
    }),
    count: shared.count,
    alias: alias === target,
    prototype: Object.getPrototypeOf(target) === prototype,
    extensible: Object.isExtensible(target),
    getterCalls,
    prefixRuns,
  })`;
const actions = [
  `
    target.length = 1;
    target.push(7, 8);
    shared.count = 2;
    delete target.extra;
    target.extra = 9;
    Object.freeze(target);
  `,
  `
    Object.defineProperty(target, "3", { value: 33, configurable: false });
    Reflect.defineProperty(target, "length", { value: 1, writable: false });
    shared.count = 3;
  `,
  `
    target[8] = 8;
    delete target[0];
    target[0] = shared;
    delete target[key];
    target[key] = 4;
    Object.seal(target);
  `,
  `
    target.length = 0;
    Object.setPrototypeOf(target, null);
    target.extra = 12;
    Object.preventExtensions(target);
  `,
];

it.each([false, true])(
  "restores array descriptors, holes, aliases and integrity, reversed=%s",
  async (isReversed) => {
    await withFixture(({ api, evaluate, getObject, readString }) => {
      evaluate(setup);
      const target = getObject("target");
      const properties = target.properties;
      const defineOwnProperty = target.DefineOwnProperty;
      const checkpoint = api.createStateCheckpoint({
        objects: [target, getObject("shared"), target],
      });
      expect(checkpoint.objectCount).toBe(2);
      const baseline = readString(observation);
      expect(baseline).toBe(
        runInNewContext(`
        ${setup};
        ${observation}
      `),
      );
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
        expect(target.DefineOwnProperty === defineOwnProperty).toBe(true);
        expect(readString(observation)).toBe(baseline);
      }
      checkpoint.release();
    });
  },
);

it("restores sparse maximum length without materializing holes", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    const source = `
      var target = [];
      target[4294967294] = 7;
      target[4294967295] = 8;
    `;
    const observe =
      "JSON.stringify([target.length, Reflect.ownKeys(target),target[4294967294],target[4294967295]])";
    evaluate(source);
    const checkpoint = api.createStateCheckpoint({ objects: [getObject("target")] });
    const baseline = readString(observe);
    expect(baseline).toBe(
      runInNewContext(`
      ${source};
      ${observe}
    `),
    );
    evaluate(`
      target.length = 0;
      delete target[4294967295];
      Object.freeze(target)
    `);
    checkpoint.restore();
    expect(readString(observe)).toBe(baseline);
    checkpoint.release();
  });
});

it("restores a readonly length and keeps indexed writes governed by engine semantics", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    const source = `
      var target = [1, , 3];
      Object.defineProperty(target, "length", { writable: false });
    `;
    evaluate(source);
    const checkpoint = api.createStateCheckpoint({ objects: [getObject("target")] });
    evaluate(`
      target[1] = 2;
      delete target[2];
      Object.freeze(target)
    `);
    checkpoint.restore();
    const observe =
      "JSON.stringify([Reflect.set(target,'3',4),Reflect.set(target,'1',5),Reflect.ownKeys(target),Object.getOwnPropertyDescriptor(target,'length')])";
    expect(readString(observe)).toBe(
      runInNewContext(`
      ${source};
      ${observe}
    `),
    );
    checkpoint.release();
  });
});

it("captures an already frozen array without weakening its length descriptor", async () => {
  await withFixture(({ api, getObject, readString }) => {
    const target = getObject(`
      var target = Object.freeze([1, , 3]);
      target
    `);
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    checkpoint.restore();
    expect(
      readString(
        "JSON.stringify([Object.isFrozen(target),target.length,1 in target,Reflect.set(target,'length',0)])",
      ),
    ).toBe("[true,3,false,false]");
    checkpoint.release();
  });
});

it("restores array identity together with selected declarative bindings", async () => {
  await withFixture(({ api, realm, evaluate, getObject, readString }) => {
    evaluate(`
      var target = [1, , 3];
      let selected = target;
      let count = 1;
    `);
    const checkpoint = api.createStateCheckpoint({
      objects: [getObject("target")],
      environments: [realm.GlobalEnv.DeclarativeRecord],
    });
    evaluate(`
      selected = [];
      count = 2;
      target.length = 0
    `);
    checkpoint.restore();
    expect(
      readString("JSON.stringify([selected===target,count,target.length,1 in target,target[2]])"),
    ).toBe("[true,1,3,false,3]");
    checkpoint.release();
  });
});

it("does not restore unselected element objects", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    const target = getObject(`
      var shared = { value: 1 };
      var target = [shared];
      target
    `);
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    evaluate(`
      shared.value = 2;
      target.length = 0
    `);
    checkpoint.restore();
    expect(readString("JSON.stringify([target[0]===shared,target[0].value])")).toBe("[true,2]");
    checkpoint.release();
  });
});

it.each(["{}", "Symbol('element')"])(
  "roots saved array element %s until release",
  async (expression) => {
    await withFixture(({ api, evaluate, getObject, readString }) => {
      const target = getObject(
        `
          var target = [${expression}];
          var reference = new WeakRef(target[0]);
          target
        `,
      );
      const checkpoint = api.createStateCheckpoint({ objects: [target] });
      evaluate("target.length=0");
      api.surroundingAgent.AgentRecord.KeptAlive.clear();
      api.gc();
      expect(readString("String(reference.deref() !== undefined)")).toBe("true");
      checkpoint.release();
      api.surroundingAgent.AgentRecord.KeptAlive.clear();
      api.gc();
      expect(readString("String(reference.deref() === undefined)")).toBe("true");
    });
  },
);

it("shares LIFO ordering with ordinary checkpoints and rejects released state", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    const target = getObject("var target=[1];target");
    const outer = api.createStateCheckpoint({ objects: [target] });
    evaluate("target.push(2)");
    const inner = api.createOrdinaryObjectCheckpoint([getObject("({})")]);
    expect(() => outer.restore()).toThrow("last-in-first-out");
    inner.release();
    outer.restore();
    expect(readString("JSON.stringify(target)")).toBe("[1]");
    outer.release();
    expect(() => outer.restore()).toThrow("released");
  });
});

it.each(["Get", "OwnPropertyKeys", "DefineOwnProperty"])(
  "rejects changed %s methods before restoring any selected object",
  async (method) => {
    await withFixture(({ api, evaluate, getObject, readString }) => {
      const first = getObject("var first={value:1};first");
      const target = getObject("var target=[1,2];target");
      const checkpoint = api.createStateCheckpoint({ objects: [first, target] });
      evaluate("first.value=2;target.length=0");
      const original = Reflect.get(target, method);
      let calls = 0;
      Reflect.set(target, method, () => {
        calls++;
        throw new Error("changed method");
      });
      expect(() => checkpoint.restore()).toThrow("internal methods changed");
      expect(calls).toBe(0);
      expect(readString("String(first.value)")).toBe("2");
      Reflect.set(target, method, original);
      checkpoint.restore();
      expect(readString("JSON.stringify([first.value,target])")).toBe("[1,[1,2]]");
      checkpoint.release();
    });
  },
);

it.each([
  "new Proxy([], {})",
  "new Uint8Array(2)",
  `new (class extends Array {
      #value = 1;
    })()`,
])(
  "rejects unsupported array-like state %s without registering a partial checkpoint",
  async (source) => {
    await withFixture(({ api, getObject }) => {
      const outer = api.createStateCheckpoint({ objects: [getObject("[]")] });
      expect(() =>
        api.createStateCheckpoint({ objects: [getObject("[]"), getObject(source)] }),
      ).toThrow("without additional internal state");
      outer.restore();
      outer.release();
    });
  },
);

it("rejects restore during preview before changing any selected array", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    const target = getObject("var target=[1,2];target");
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    evaluate("target.length=0");
    api.surroundingAgent.debugger_scopePreview(() => {
      expect(() => checkpoint.restore()).toThrow("during preview");
    });
    expect(readString("String(target.length)")).toBe("0");
    checkpoint.restore();
    expect(readString("String(target.length)")).toBe("2");
    checkpoint.release();
  });
});

it("removes private brands stamped onto an array after capture", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    const target = getObject(`
      var target = [];
      class Base {
        constructor() {
          return target;
        }
      }
      class Stamp extends Base {
        #value = 1;
        static has(value) {
          return #value in value;
        }
      }
      target;
    `);
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    for (let attempt = 0; attempt < 2; attempt++) {
      evaluate("new Stamp()");
      expect(readString("String(Stamp.has(target))")).toBe("true");
      checkpoint.restore();
      expect(readString("String(Stamp.has(target))")).toBe("false");
    }
    checkpoint.release();
  });
});

it("does not rewind an unselected array iterator", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    const target = getObject(`
      var target = [1, 2];
      var iterator = target.values();
      target
    `);
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    expect(readString("String(iterator.next().value)")).toBe("1");
    evaluate("target.length=0");
    checkpoint.restore();
    expect(readString("String(iterator.next().value)")).toBe("2");
    expect(() => api.createStateCheckpoint({ objects: [target, getObject("iterator")] })).toThrow(
      "without additional internal state",
    );
    checkpoint.release();
  });
});

it("rejects foreign-Agent arrays and wrong-Agent restore", async () => {
  await withFixture(({ api, getObject }) => {
    const owner = api.surroundingAgent;
    const target = getObject("[1]");
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
    try {
      expect(() => api.createStateCheckpoint({ objects: [target] })).toThrow("current agent");
      expect(() => checkpoint.restore()).toThrow("another agent");
    } finally {
      api.setSurroundingAgent(owner);
    }
    checkpoint.restore();
    checkpoint.release();
  });
});

it("preflights prototype cycles before restoring array descriptors", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    const target = getObject(
      `
        var parent = {};
        var target = [1];
        Object.setPrototypeOf(target, parent);
        target
      `,
    );
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    evaluate(
      `
        target.length = 0;
        Object.setPrototypeOf(target, null);
        Object.setPrototypeOf(parent, target)
      `,
    );
    expect(() => checkpoint.restore()).toThrow("prototype cycle");
    expect(readString("String(target.length)")).toBe("0");
    evaluate("Object.setPrototypeOf(parent,null)");
    checkpoint.restore();
    expect(readString("String(target.length)")).toBe("1");
    checkpoint.release();
  });
});
