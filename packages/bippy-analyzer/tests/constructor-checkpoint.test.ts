import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { withFixture } from "./helpers/engine-fixture.js";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";
import type { StateCheckpoint } from "../engine/dist/declaration/index.mjs";

it.each([false, true])(
  "forks a selected constructed instance without replay, reversed=%s",
  async (isReversed) => {
    await withAbstractFixture(({ api, agent, realm, evaluate, compile, createBoolean }) => {
      const initial = `
        var target = new (class Owner {
          value = 1;
        })();
        var alias = target;
        class Stamp extends class ReturnTarget {
          constructor() {
            return target;
          }
        } {
          branch = 4;
        }
      `;
      evaluate(initial);
      createBoolean("enabled");
      const target = realm.GlobalObject.properties.get("target")?.Value;
      if (!(target instanceof api.ObjectValue)) throw Error("Expected target");
      const constructors = [...target.ConstructedBy];
      let prefixes = 0;
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.type === "UnaryExpression" && node.sourceText === "void 1") prefixes++;
      };
      const source = `
        void 1;
        if (enabled) {
          new Stamp();
          target.value += 3;
        } else {
          alias.value -= 2;
        }
        JSON.stringify([target === alias, target.value, target.branch]);
      `;
      agent.evaluate(compile(source), () => {}, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw Error("Expected decision");
      const contexts = [...agent.executionContextStack];
      let state: StateCheckpoint | undefined;
      const control = agent.captureEvaluation({
        capture: () => {
          const checkpoint = api.createStateCheckpoint({ objects: [target] });
          state = checkpoint;
          return {
            restore: () => {
              checkpoint.restore();
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
        for (const choice of isReversed ? [true, false] : [false, true]) {
          control.restore();
          expect(target.ConstructedBy.length).toBe(constructors.length);
          expect(
            target.ConstructedBy.every((constructor, index) => constructor === constructors[index]),
          ).toBe(true);
          agent.AgentRecord.KeptAlive.clear();
          api.gc();
          const result = agent.resumeEvaluate({
            abstractBooleanDecision: {
              resume: "abstract-boolean",
              decision: pause.value,
              value: choice,
            },
          });
          if (!result.done) throw Error("Expected completion");
          const completion = api.EnsureCompletion(result.value);
          if (!(completion.Value instanceof api.JSStringValue)) throw Error("Expected observation");
          expect(completion.Value.stringValue()).toBe(
            runInNewContext(initial + source, { enabled: choice }),
          );
        }
      } finally {
        control.release();
        state?.release();
      }
      expect(prefixes).toBe(1);
    });
  },
);

it("keeps nested constructor snapshots isolated and releases branch-only constructors", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(`
      var target = new (class Original {})(),
        reference;
    `);
    const target = getObject("target");
    const parent = api.createStateCheckpoint({ objects: [target] });
    evaluate(
      `(() => {
          class Stamp extends class ReturnTarget {
            constructor() {
              return target;
            }
          } {}
          reference = new WeakRef(Stamp);
          new Stamp();
        })();`,
    );
    const child = api.createStateCheckpoint({ objects: [target] });
    target.ConstructedBy.length = 0;
    expect(() => parent.restore()).toThrow("last-in-first-out");
    child.restore();
    expect(target.ConstructedBy.length).toBe(2);
    child.release();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref()!==undefined)")).toBe("true");
    parent.restore();
    expect(target.ConstructedBy.length).toBe(1);
    parent.release();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref()!==undefined)")).toBe("false");
  });
});

const forms = [
  `
    function Owner() {
      this.value = 1;
    }
  `,
  "class Owner {}",
  `
    class Owner {
      value = 1;
      constructor() {
        this.extra = 2;
      }
    }
  `,
  `
    class Owner extends class Parent {
      parent = 1;
    } {
      value = 2;
    }
  `,
  `
    class Owner extends Array {
      value = 1;
    }
  `,
  `
    class Owner extends Map {
      value = 1;
    }
  `,
  `
    class Owner extends Set {
      value = 1;
    }
  `,
];

it.each(forms.flatMap((source) => [false, true].map((isReversed) => ({ source, isReversed }))))(
  "restores constructed instance properties: $source, reversed=$isReversed",
  async ({ source, isReversed }) =>
    withFixture(({ api, evaluate, getObject, readString }) => {
      const setup = `
        var Owner = (${source})
        var target = new Owner();
        var alias = target;
        target.tag = 1;
      `;
      const observation = `JSON.stringify([
          target === alias,
          target.tag,
          target.value,
          target.parent,
          target.extra,
          Reflect.ownKeys(target).map(String),
          Object.isExtensible(target),
          Object.getPrototypeOf(target) === Owner.prototype,
        ])`;
      evaluate(setup);
      const target = getObject("target");
      expect(target.ConstructedBy.length).toBeGreaterThan(0);
      const data = target.ConstructedBy;
      const constructors = [...data];
      const properties = target.properties;
      expect(() => api.createOrdinaryObjectCheckpoint([target])).toThrow("Checkpoint requires");
      expect(() => api.createDataGraphCheckpoint({ roots: [target] })).toThrow(
        "Checkpoint requires",
      );
      const checkpoint = api.createStateCheckpoint({ objects: [target, target] });
      expect(checkpoint.objectCount).toBe(1);
      const baseline = readString(observation);
      expect(baseline).toBe(runInNewContext(`${setup}${observation}`));
      const actions = [
        `
          target.tag = 3;
          Object.freeze(target);
        `,
        `
          delete target.tag;
          target.tag = 4;
          Object.setPrototypeOf(target, null);
          Object.seal(target);
        `,
      ];
      try {
        for (const action of isReversed ? [...actions].reverse() : actions) {
          evaluate(action);
          expect(readString(observation)).toBe(runInNewContext(`${setup}${action}${observation}`));
          checkpoint.restore();
          expect(target.properties === properties).toBe(true);
          expect(target.ConstructedBy === data).toBe(true);
          expect(data.length).toBe(constructors.length);
          expect(data.every((constructor, index) => constructor === constructors[index])).toBe(
            true,
          );
          expect(readString(observation)).toBe(baseline);
        }
      } finally {
        checkpoint.release();
      }
    }),
);

it("restores appended constructors, duplicates, private stamps and original list order", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(
      `
        class InitialBase {}
        class Original extends InitialBase {}
        var target = new Original();
        class ReturnTarget {
          constructor() {
            return target;
          }
        }
        class Stamp extends ReturnTarget {
          branch = 2;
        }
        class PrivateStamp extends ReturnTarget {
          #value = 1;
          static has(object) {
            return #value in object;
          }
        }
      `,
    );
    const target = getObject("target");
    const original = [...target.ConstructedBy];
    const data = target.ConstructedBy;
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    try {
      evaluate(`
        new Stamp();
        new Stamp();
        new PrivateStamp()
      `);
      expect(data.length).toBe(original.length + 3);
      expect(data.at(-3) === data.at(-2)).toBe(true);
      expect(readString("String(PrivateStamp.has(target))")).toBe("true");
      data.reverse();
      checkpoint.restore();
      expect(data.length).toBe(original.length);
      expect(data.every((constructor, index) => constructor === original[index])).toBe(true);
      expect(target.ConstructedBy === data).toBe(true);
      expect(readString("JSON.stringify([PrivateStamp.has(target),'branch' in target])")).toBe(
        "[false,false]",
      );
      evaluate("new PrivateStamp()");
      expect(readString("String(PrivateStamp.has(target))")).toBe("true");
    } finally {
      checkpoint.release();
    }
  });
});

it("preflights replaced constructor lists before any selected writes", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(`
      var first = { value: 1 },
        target = new (class Owner {})()
    `);
    const target = getObject("target");
    const original = target.ConstructedBy;
    const checkpoint = api.createStateCheckpoint({ objects: [getObject("first"), target] });
    try {
      evaluate("first.value=2");
      Reflect.set(target, "ConstructedBy", [...original]);
      expect(() => checkpoint.restore()).toThrow("Checkpoint constructor data list changed");
      expect(readString("String(first.value)")).toBe("2");
      Reflect.set(target, "ConstructedBy", original);
      checkpoint.restore();
      expect(readString("String(first.value)")).toBe("1");
    } finally {
      Reflect.set(target, "ConstructedBy", original);
      checkpoint.release();
    }
  });
});

it.each(["new (class Owner{#value=1})()", "new Date()", "new Proxy(new (class Owner{})(),{})"])(
  "rejects other instance state: %s",
  async (source) => {
    await withFixture(({ api, getObject }) => {
      expect(() => api.createStateCheckpoint({ objects: [getObject(source)] })).toThrow(
        "Checkpoint requires",
      );
    });
  },
);

it("does not restore referenced constructor properties or captured data", async () => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(
      `
        var data = { value: 1 };
        var Owner = function () {
          this.data = data;
        };
        Owner.tag = 1;
        var target = new Owner()
      `,
    );
    const checkpoint = api.createStateCheckpoint({ objects: [getObject("target")] });
    try {
      evaluate(`
        Owner.tag = 2;
        data.value = 3;
        target.branch = 4
      `);
      checkpoint.restore();
      expect(readString("JSON.stringify([Owner.tag,target.data.value,'branch' in target])")).toBe(
        "[2,3,false]",
      );
    } finally {
      checkpoint.release();
    }
  });
});

it.each(["invalid-list", "invalid-constructor", "foreign-constructor"])(
  "rejects %s without registering a frame",
  async (mode) => {
    await withFixture(({ api, getObject }) => {
      const target = getObject("new (class Owner{})()");
      const original = target.ConstructedBy;
      const parent = api.createStateCheckpoint({ objects: [getObject("({})")] });
      const agent = api.surroundingAgent;
      try {
        if (mode === "invalid-list") Reflect.set(target, "ConstructedBy", {});
        if (mode === "invalid-constructor") Reflect.set(target, "ConstructedBy", [api.Value(1)]);
        if (mode === "foreign-constructor") {
          api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
          const realm = new api.ManagedRealm();
          const constructor = api.EnsureCompletion(
            realm.evaluateScriptSkipDebugger("(function Foreign(){})"),
          ).Value;
          api.setSurroundingAgent(agent);
          Reflect.set(target, "ConstructedBy", [constructor]);
        }
        expect(() => api.createStateCheckpoint({ objects: [target] })).toThrow(
          mode === "invalid-list"
            ? "constructor data must be an array"
            : mode === "invalid-constructor"
              ? "constructor data requires guest constructors"
              : "constructor references must belong to the current agent",
        );
        parent.restore();
      } finally {
        api.setSurroundingAgent(agent);
        Reflect.set(target, "ConstructedBy", original);
        parent.release();
      }
    });
  },
);

it.each(["constructor", "symbol"])("marks live constructor tracking roots: %s", async (kind) => {
  await withFixture(({ api, evaluate, readString }) => {
    evaluate(
      `
        var reference;
        var target = (() => {
          const Owner = function () {};
          Owner.prototype = null;
          Owner.held = Symbol("held");
          reference = new WeakRef(${kind === "constructor" ? "Owner" : "Owner.held"});
          return new Owner();
        })();
      `,
    );
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref()!==undefined)")).toBe("true");
    evaluate("target=null");
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref()!==undefined)")).toBe("false");
  });
});

it.each([false, true])(
  "retains saved constructor roots after list removal, restore=%s",
  async (shouldRestore) => {
    await withFixture(({ api, evaluate, getObject, readString }) => {
      evaluate(
        `
          var reference;
          var target = (() => {
            const Owner = function () {};
            Owner.prototype = null;
            reference = new WeakRef(Owner);
            return new Owner();
          })();
        `,
      );
      const target = getObject("target");
      const checkpoint = api.createStateCheckpoint({ objects: [target] });
      target.ConstructedBy.length = 0;
      api.surroundingAgent.AgentRecord.KeptAlive.clear();
      api.gc();
      expect(readString("String(reference.deref()!==undefined)")).toBe("true");
      if (shouldRestore) checkpoint.restore();
      checkpoint.release();
      api.surroundingAgent.AgentRecord.KeptAlive.clear();
      api.gc();
      expect(readString("String(reference.deref()!==undefined)")).toBe(String(shouldRestore));
      evaluate("target=null");
      api.surroundingAgent.AgentRecord.KeptAlive.clear();
      api.gc();
      expect(readString("String(reference.deref()!==undefined)")).toBe("false");
    });
  },
);
