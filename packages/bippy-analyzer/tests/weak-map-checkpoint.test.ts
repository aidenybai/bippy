import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { StateCheckpoint } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";
import { withFixture } from "./helpers/engine-fixture.js";

const getSetup = (keyExpression: string, mapExpression = "new WeakMap()") => `
  var target = ${mapExpression};
  var key = ${keyExpression};
  var shared = { payload: 7 };
  var extraKey = {};
  var deletedKey = {};
  var getterCalls = 0;
  target.set(key, shared);
  target.set(deletedKey, shared);
  target.delete(deletedKey);
  Object.defineProperty(target, "probe", {
    get() { getterCalls++; throw Error("unexpected getter"); },
    configurable: true
  });
`;

const observation = `
  JSON.stringify({
    entries: [key, extraKey, deletedKey].map(entryKey => {
      const value = WeakMap.prototype.get.call(target, entryKey);
      return [WeakMap.prototype.has.call(target, entryKey), value === shared ? "shared" : value === target ? "self" : value];
    }),
    keys: Reflect.ownKeys(target),
    note: target.note,
    frozen: Object.isFrozen(target),
    nullPrototype: Object.getPrototypeOf(target) === null,
    getterCalls
  });
`;

const branches = [
  `
    target.delete(key);
    target.set(extraKey, target);
    target.set(key, undefined);
    target.note = "left";
    Object.freeze(target);
    target.set(deletedKey, shared);
  `,
  `
    target.set(key, target);
    target.set(deletedKey, undefined);
    target.note = "right";
    Object.setPrototypeOf(target, null);
    Object.preventExtensions(target);
  `,
];

for (const keyExpression of ["{}", 'Symbol("key")', "target"]) {
  it.each([false, true])(
    `restores weak entries for ${keyExpression}, reversed=%s`,
    async (isReversed) => {
      await withFixture(({ api, evaluate, getObject, readString }) => {
        const setup = getSetup(keyExpression);
        evaluate(setup);
        const target = getObject("target");
        if (!api.isWeakMapObject(target)) throw Error("Expected WeakMap");
        const data = target.WeakMapData;
        const entries = [...data];
        const keys = data.map((entry) => entry.Key);
        const values = data.map((entry) => entry.Value);
        const table = target.properties;
        const baseline = readString(observation);
        expect(baseline).toBe(runInNewContext(setup + observation));
        const checkpoint = api.createStateCheckpoint({ objects: [target] });
        try {
          for (const branch of isReversed ? [...branches].reverse() : branches) {
            evaluate(branch);
            expect(readString(observation)).toBe(runInNewContext(setup + branch + observation));
            checkpoint.restore();
            expect(getObject("target")).toBe(target);
            expect(target.properties).toBe(table);
            expect(target.WeakMapData).toBe(data);
            expect(data.length).toBe(entries.length);
            data.forEach((entry, index) => {
              expect(entry).toBe(entries[index]);
              expect(entry.Key).toBe(keys[index]);
              expect(entry.Value).toBe(values[index]);
            });
            expect(readString(observation)).toBe(baseline);
          }
        } finally {
          checkpoint.release();
        }
      });
    },
  );
}

it.each([false, true])(
  "restores a public-field WeakMap subclass, reversed=%s",
  async (isReversed) => {
    await withFixture(({ api, evaluate, getObject, readString }) => {
      const setup = getSetup("{}", "new (class extends WeakMap { tag = 1; })()");
      evaluate(setup);
      const checkpoint = api.createStateCheckpoint({ objects: [getObject("target")] });
      try {
        for (const branch of isReversed ? [...branches].reverse() : branches) {
          evaluate(branch);
          expect(readString(observation)).toBe(runInNewContext(setup + branch + observation));
          checkpoint.restore();
          expect(readString(observation)).toBe(runInNewContext(setup + observation));
        }
      } finally {
        checkpoint.release();
      }
    });
  },
);

it("pins saved keys and values until release, not as a native GC parity claim", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(`
      var target = new WeakMap();
      var keyReference, valueReference;
      (() => {
        const key = {};
        const value = { payload: 7, key };
        keyReference = new WeakRef(key);
        valueReference = new WeakRef(value);
        target.set(key, value);
      })();
    `);
    const target = getObject("target");
    if (!api.isWeakMapObject(target)) throw Error("Expected WeakMap");
    const entry = target.WeakMapData[0];
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    evaluate("target.delete(keyReference.deref())");
    expect(entry.Key).toBeUndefined();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(
      readString(
        "JSON.stringify([keyReference.deref() !== undefined, valueReference.deref().payload])",
      ),
    ).toBe("[true,7]");
    checkpoint.restore();
    expect(target.WeakMapData[0]).toBe(entry);
    expect(
      readString("JSON.stringify(target.get(keyReference.deref()) === valueReference.deref())"),
    ).toBe("true");
    checkpoint.release();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(
      readString(
        "JSON.stringify([keyReference.deref() === undefined, valueReference.deref() === undefined])",
      ),
    ).toBe("[true,true]");
    expect(entry.Key).toBeUndefined();
    expect(entry.Value).toBeUndefined();
  });
});

it("does not pin entries allocated only in the current branch", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(`
      var target = new WeakMap();
      var keyReference, valueReference;
    `);
    const target = getObject("target");
    if (!api.isWeakMapObject(target)) throw Error("Expected WeakMap");
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    evaluate(`
      (() => {
        const key = {};
        const value = { key };
        keyReference = new WeakRef(key);
        valueReference = new WeakRef(value);
        target.set(key, value);
      })();
    `);
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(
      readString(
        "JSON.stringify([keyReference.deref() === undefined, valueReference.deref() === undefined])",
      ),
    ).toBe("[true,true]");
    checkpoint.restore();
    expect(target.WeakMapData.length).toBe(0);
    checkpoint.release();
  });
});

it("retains a saved symbol key without changing guest weak-key validation", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(`
      var target = new WeakMap();
      var reference;
      (() => {
        const key = Symbol("key");
        reference = new WeakRef(key);
        target.set(key, 7);
      })();
    `);
    const checkpoint = api.createStateCheckpoint({ objects: [getObject("target")] });
    evaluate("target.delete(reference.deref())");
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    checkpoint.restore();
    expect(readString("JSON.stringify(target.get(reference.deref()))")).toBe("7");
    checkpoint.release();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("JSON.stringify(reference.deref() === undefined)")).toBe("true");
    expect(
      readString(`JSON.stringify([1, "key", Symbol.for("registered")].map(key => {
      try { target.set(key, 1); return false; }
      catch (error) { return error instanceof TypeError; }
    }))`),
    ).toBe("[true,true,true]");
  });
});

it("preserves nested snapshots and keeps values shallow", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(getSetup("{}"));
    const target = getObject("target");
    const outer = api.createStateCheckpoint({ objects: [target] });
    evaluate(`
      target.set(key, target);
      shared.payload = 8;
    `);
    const inner = api.createStateCheckpoint({ objects: [target, getObject("shared")] });
    evaluate(`
      target.delete(key);
      shared.payload = 9;
    `);
    expect(() => outer.restore()).toThrow("last-in-first-out");
    inner.restore();
    expect(readString("JSON.stringify([target.get(key) === target, shared.payload])")).toBe(
      "[true,8]",
    );
    inner.release();
    outer.restore();
    expect(readString("JSON.stringify([target.get(key) === shared, shared.payload])")).toBe(
      "[true,8]",
    );
    outer.release();
  });
});

it("validates list identity before restoring any selected object", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(`
      var target = new WeakMap();
      var extra = { value: 1 };
    `);
    const target = getObject("target");
    const descriptor = Object.getOwnPropertyDescriptor(target, "WeakMapData");
    if (!descriptor) throw Error("Expected weak data");
    const checkpoint = api.createStateCheckpoint({ objects: [getObject("extra"), target] });
    evaluate("extra.value = 2");
    Object.defineProperty(target, "WeakMapData", { ...descriptor, value: [] });
    try {
      expect(() => checkpoint.restore()).toThrow("Checkpoint collection data list changed");
      expect(readString("JSON.stringify(extra.value)")).toBe("2");
      Object.defineProperty(target, "WeakMapData", descriptor);
      checkpoint.restore();
      expect(readString("JSON.stringify(extra.value)")).toBe("1");
    } finally {
      Object.defineProperty(target, "WeakMapData", descriptor);
      checkpoint.release();
    }
  });
});

it("keeps ordinary-only and closed-data weak graph policies strict", async () => {
  await withFixture(({ api, getObject }) => {
    const target = getObject("new WeakMap()");
    expect(() => api.createOrdinaryObjectCheckpoint([target])).toThrow(
      "Checkpoint requires ordinary objects",
    );
    expect(() => api.createDataGraphCheckpoint({ roots: [target] })).toThrow(
      "Checkpoint requires ordinary objects",
    );
    const parent = api.createStateCheckpoint({ objects: [target] });
    for (const expression of [
      "new WeakSet()",
      "new Proxy(new WeakMap(), {})",
      "new (class extends WeakMap { #value = 1; })()",
    ]) {
      expect(() => api.createStateCheckpoint({ objects: [target, getObject(expression)] })).toThrow(
        "without additional internal state",
      );
    }
    parent.restore();
    parent.release();
  });
});

it.each([false, true])(
  "forks a WeakMap cache without prefix replay, reversed=%s",
  async (isReversed) => {
    await withAbstractFixture(({ api, agent, realm, evaluate, compile, createBoolean }) => {
      const setup = `
      var key = {};
      var target = new WeakMap([[key, "initial"]]);
    `;
      evaluate(setup);
      createBoolean("enabled");
      const target = realm.GlobalObject.properties.get("target")?.Value;
      if (!(target instanceof api.ObjectValue)) throw Error("Expected target");
      let prefixCount = 0;
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.type === "UnaryExpression" && node.sourceText === "void 1") prefixCount++;
      };
      const source = `
      void 1;
      if (enabled) {
        target.delete(key);
        target.set(key, "left");
      } else {
        target.set(key, "right");
        Object.freeze(target);
      }
      JSON.stringify([target.get(key), Object.isFrozen(target)]);
    `;
      agent.evaluate(compile(source), () => {}, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw Error("Expected decision");
      const contexts = [...agent.executionContextStack];
      let storage: StateCheckpoint | undefined;
      const checkpoint = agent.captureEvaluation({
        capture: () => {
          const state = api.createStateCheckpoint({ objects: [target] });
          storage = state;
          return {
            restore: () => {
              state.restore();
              agent.executionContextStack.splice(
                0,
                agent.executionContextStack.length,
                ...contexts,
              );
            },
          };
        },
      });
      try {
        for (const enabled of isReversed ? [true, false] : [false, true]) {
          checkpoint.restore();
          agent.AgentRecord.KeptAlive.clear();
          api.gc();
          const result = agent.resumeEvaluate({
            abstractBooleanDecision: {
              resume: "abstract-boolean",
              decision: pause.value,
              value: enabled,
            },
          });
          if (!result.done) throw Error("Expected completion");
          const completion = api.EnsureCompletion(result.value);
          if (!(completion.Value instanceof api.JSStringValue)) throw Error("Expected observation");
          expect(completion.Value.stringValue()).toBe(runInNewContext(setup + source, { enabled }));
        }
      } finally {
        checkpoint.release();
        storage?.release();
      }
      expect(prefixCount).toBe(1);
    });
  },
);
