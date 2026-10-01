import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { StateCheckpoint } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";
import { withFixture } from "./helpers/engine-fixture.js";

interface IntrinsicCase {
  name: string;
  expression: string;
  isString: boolean;
}

const cases: IntrinsicCase[] = [
  { name: "Object.prototype", expression: "Object.prototype", isString: false },
  { name: "String.prototype", expression: "String.prototype", isString: true },
  ...["", "abc", "A😀\ud800"].map((value) => ({
    name: JSON.stringify(value),
    expression: `new String(${JSON.stringify(value)})`,
    isString: true,
  })),
];

const getSetup = (entry: IntrinsicCase) => `
  var target = ${entry.expression};
  var isStringTarget = ${entry.isString};
  var marker = Symbol("marker");
  var getTag = Object.prototype.toString;
  var getString = String.prototype.valueOf;
  var prototypeCandidate = {};
  var getterCalls = 0;
  Object.defineProperty(target, "probeGetter", {
    get() { getterCalls++; throw Error("unexpected getter"); },
    configurable: true
  });
`;

const observation = `
  JSON.stringify({
    tag: Reflect.apply(getTag, target, []),
    value: isStringTarget ? Reflect.apply(getString, target, []) : null,
    descriptors: ["0", "1", "2", "3", "4", "length", "extra"].map(name => Object.getOwnPropertyDescriptor(target, name)),
    keys: Reflect.ownKeys(target).filter(key => key === marker || /^[0-9]+$/.test(String(key))).map(key => String(key)),
    alias: target[marker] === target,
    extensible: Object.isExtensible(target),
    frozen: Object.isFrozen(target),
    changedPrototype: Object.getPrototypeOf(target) === prototypeCandidate,
    getterCalls
  });
`;

const branches = [
  `
    target.extra = 7;
    target[marker] = target;
    Object.defineProperty(target, "4", { value: "four", writable: true, enumerable: true, configurable: true });
    Object.preventExtensions(target);
  `,
  `
    delete target.toString;
    Object.defineProperty(target, "extra", { get() { throw Error("unexpected getter"); }, configurable: true });
    Reflect.setPrototypeOf(target, prototypeCandidate);
    Object.freeze(target);
  `,
];

for (const entry of cases) {
  it.each([false, true])(
    `restores ${entry.name} properties and identity, reversed=%s`,
    async (isReversed) => {
      await withFixture(({ api, evaluate, getObject, readString }) => {
        const setup = getSetup(entry);
        evaluate(setup);
        const target = getObject("target");
        const table = target.properties;
        const initialSize = table.size;
        const baseline = readString(observation);
        const keyObservation = "JSON.stringify(Reflect.ownKeys(target).map(key => String(key)))";
        const initialKeys = readString(keyObservation);
        expect(baseline).toBe(runInNewContext(setup + observation));
        const checkpoint = api.createStateCheckpoint({ objects: [target] });
        try {
          for (const branch of isReversed ? [...branches].reverse() : branches) {
            evaluate(branch);
            expect(readString(observation)).toBe(runInNewContext(setup + branch + observation));
            checkpoint.restore();
            expect(getObject("target")).toBe(target);
            expect(target.properties).toBe(table);
            expect(table.size).toBe(initialSize);
            expect(readString(keyObservation)).toBe(initialKeys);
            expect(readString(observation)).toBe(baseline);
          }
        } finally {
          checkpoint.release();
        }
      });
    },
  );
}

it.each(["StringData", "Prototype"])(
  "preflights read-only %s metadata before selected writes",
  async (slot) => {
    await withFixture(({ api, evaluate, getObject, readString }) => {
      evaluate(`
        var target = ${slot === "StringData" ? 'new String("abc")' : "Object.prototype"};
        var extra = { value: 1 };
      `);
      const target = getObject("target");
      const extra = getObject("extra");
      const descriptor = Object.getOwnPropertyDescriptor(target, slot);
      if (!descriptor) throw Error("Expected slot");
      const checkpoint = api.createStateCheckpoint({ objects: [extra, target] });
      try {
        evaluate("extra.value = 2");
        Object.defineProperty(target, slot, {
          ...descriptor,
          value: slot === "StringData" ? "changed" : extra,
        });
        expect(() => checkpoint.restore()).toThrow("Checkpoint exotic metadata changed");
        expect(readString("JSON.stringify(extra.value)")).toBe("2");
        Object.defineProperty(target, slot, descriptor);
        checkpoint.restore();
        expect(readString("JSON.stringify(extra.value)")).toBe("1");
      } finally {
        Object.defineProperty(target, slot, descriptor);
        checkpoint.release();
      }
    });
  },
);

it.each(cases.slice(0, 2))(
  "keeps ordinary-only and closed-data contracts strict for $name",
  async (entry) => {
    await withFixture(({ api, getObject }) => {
      const target = getObject(entry.expression);
      expect(() => api.createOrdinaryObjectCheckpoint([target])).toThrow(
        "Checkpoint requires ordinary objects",
      );
      expect(() => api.createDataGraphCheckpoint({ roots: [target] })).toThrow(
        "Checkpoint requires ordinary objects",
      );
    });
  },
);

it.each(["StringData", "Prototype"])(
  "rejects a metadata accessor without invoking it: %s",
  async (slot) => {
    await withFixture(({ api, getObject }) => {
      const target = getObject(slot === "StringData" ? 'new String("abc")' : "Object.prototype");
      const descriptor = Object.getOwnPropertyDescriptor(target, slot);
      if (!descriptor) throw Error("Expected slot");
      let calls = 0;
      Object.defineProperty(target, slot, {
        configurable: true,
        get: () => {
          calls++;
          return descriptor.value;
        },
      });
      try {
        expect(() => api.createStateCheckpoint({ objects: [target] })).toThrow(
          slot === "StringData"
            ? "Checkpoint requires ordinary objects"
            : "Checkpoint exotic metadata must use data properties",
        );
        expect(calls).toBe(0);
      } finally {
        Object.defineProperty(target, slot, descriptor);
      }
    });
  },
);

it("retains saved string-object properties until release", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(`
      var target = new String("abc"), reference;
      (() => {
        const value = { payload: 7 };
        reference = new WeakRef(value);
        target.extra = value;
      })();
    `);
    const target = getObject("target");
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    evaluate("delete target.extra");
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("JSON.stringify(reference.deref().payload)")).toBe("7");
    checkpoint.restore();
    expect(readString("JSON.stringify(reference.deref() === target.extra)")).toBe("true");
    evaluate("delete target.extra");
    checkpoint.release();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("JSON.stringify(reference.deref() === undefined)")).toBe("true");
  });
});

it("preflights a restored string prototype cycle before any writes", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(`
      var target = new String("abc");
      var extra = { value: 1 };
      var originalPrototype = Object.getPrototypeOf(String.prototype);
    `);
    const checkpoint = api.createStateCheckpoint({
      objects: [getObject("extra"), getObject("target")],
    });
    evaluate(`
      extra.value = 2;
      Object.setPrototypeOf(target, null);
      Object.setPrototypeOf(String.prototype, target);
    `);
    expect(() => checkpoint.restore()).toThrow("Object checkpoint would restore a prototype cycle");
    expect(readString("JSON.stringify(extra.value)")).toBe("2");
    evaluate("Object.setPrototypeOf(String.prototype, originalPrototype)");
    checkpoint.restore();
    expect(
      readString(
        "JSON.stringify([extra.value, Object.getPrototypeOf(target) === String.prototype])",
      ),
    ).toBe("[1,true]");
    checkpoint.release();
  });
});

for (const entry of cases.slice(0, 2)) {
  it.each([false, true])(
    `forks selected ${entry.name} properties without replay, reversed=%s`,
    async (isReversed) => {
      await withAbstractFixture(({ api, agent, realm, evaluate, compile, createBoolean }) => {
        const setup = `var target = ${entry.expression};`;
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
          target.branch = "left";
          Object.freeze(target);
        } else {
          Object.defineProperty(target, "branch", { value: "right", configurable: true });
        }
        JSON.stringify([target.branch, Object.isFrozen(target)]);
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
            if (!(completion.Value instanceof api.JSStringValue))
              throw Error("Expected observation");
            expect(completion.Value.stringValue()).toBe(
              runInNewContext(setup + source, { enabled }),
            );
          }
        } finally {
          checkpoint.release();
          storage?.release();
        }
        expect(prefixCount).toBe(1);
      });
    },
  );
}
