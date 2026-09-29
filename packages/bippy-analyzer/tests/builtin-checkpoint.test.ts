import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { withFixture } from "./helpers/engine-fixture.js";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";
import type { StateCheckpoint } from "../engine/dist/declaration/index.mjs";

it.each([false, true])(
  "forks builtin properties without prefix replay, reversed=%s",
  async (isReversed) => {
    await withAbstractFixture(({ api, agent, realm, evaluate, compile, createBoolean }) => {
      const initial = `
      var target = Math.max;
      var alias = target;
      target.tag = 1;
    `;
      evaluate(initial);
      createBoolean("enabled");
      const target = realm.GlobalObject.properties.get("target")?.Value;
      if (!(target instanceof api.ObjectValue)) throw Error("Expected builtin");
      let prefixes = 0;
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.type === "UnaryExpression" && node.sourceText === "void 1") prefixes++;
      };
      const source = `
      void 1;
      if (enabled) {
        target.tag = 3;
        Object.freeze(target);
      } else {
        delete target.tag;
        target.tag = 4;
        Object.setPrototypeOf(target, null);
      }
      JSON.stringify([target === alias, target(2, 7), target.tag, Object.isExtensible(target)]);
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

it("does not own HostCapturedValues elements or native closure state", async () => {
  await withFixture(({ api, realm, evaluate, readString }) => {
    let count = 0;
    const target = api.CreateBuiltinFunction(() => api.Value(++count), 0, "fixture", [
      "HostCapturedValues",
    ]);
    const captures = [api.Value(1)];
    target.HostCapturedValues = captures;
    api.X(api.CreateDataPropertyOrThrow(realm.GlobalObject, "target", target));
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    try {
      captures[0] = api.Value(2);
      evaluate("target()");
      checkpoint.restore();
      expect(target.HostCapturedValues === captures).toBe(true);
      expect(captures[0]).toEqual(api.Value(2));
      expect(readString("String(target())")).toBe("2");
      target.HostCapturedValues = [];
      expect(() => checkpoint.restore()).toThrow("Checkpoint function metadata changed");
      target.HostCapturedValues = captures;
    } finally {
      checkpoint.release();
    }
  });
});

it.each(["duplicate-slot", "non-string-slot", "class-marker", "foreign-agent"])(
  "rejects unsupported builtin metadata before registration: %s",
  async (mode) => {
    await withFixture(({ api, getObject }) => {
      const target = getObject("Math.max");
      const slots = target.internalSlotsList;
      const agent = api.surroundingAgent;
      const checkpoint = api.createStateCheckpoint({ objects: [getObject("({})")] });
      try {
        if (mode === "duplicate-slot")
          Reflect.set(target, "internalSlotsList", [...slots, slots[0]]);
        if (mode === "non-string-slot") Reflect.set(target, "internalSlotsList", [...slots, 1]);
        if (mode === "class-marker") Reflect.set(target, "IsClassConstructor", true);
        if (mode === "foreign-agent")
          api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
        expect(() => api.createStateCheckpoint({ objects: [target] })).toThrow(
          mode === "foreign-agent"
            ? "Checkpoint objects must belong to the current agent"
            : "Checkpoint requires",
        );
        api.setSurroundingAgent(agent);
        checkpoint.restore();
      } finally {
        api.setSurroundingAgent(agent);
        Reflect.set(target, "internalSlotsList", slots);
        Reflect.set(target, "IsClassConstructor", false);
        checkpoint.release();
      }
    });
  },
);

const forms = [
  { expression: "Math.max", call: "target(2, 5)" },
  { expression: "Object", call: "target(3).valueOf()" },
  { expression: "Array", call: "Reflect.construct(target, [2]).length" },
  { expression: "Array.prototype.push", call: "Reflect.apply(target, [1], [2])" },
  { expression: "Map.prototype.get", call: "Reflect.apply(target, new Map([[7, 9]]), [7])" },
  {
    expression: "Array.prototype.values",
    call: "Reflect.apply(target, [9], []).next().value",
  },
  {
    expression: 'Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").get',
    call: "Reflect.apply(target, {}, []) === Object.prototype",
  },
];

it.each(forms.flatMap((form) => [false, true].map((isReversed) => ({ ...form, isReversed }))))(
  "restores builtin properties: $expression, reversed=$isReversed",
  async ({ expression, call, isReversed }) => {
    await withFixture(({ api, evaluate, getObject, readString }) => {
      const setup = `
        var target = ${expression};
        var alias = target;
        target.tag = 1;
        var getter = () => {
          throw Error("getter must not run");
        };
        Object.defineProperty(target, "accessor", {
          get: getter,
          configurable: true,
        });
      `;
      const observation = `JSON.stringify([
        ${call},
        target === alias,
        target.tag,
        target.name,
        target.length,
        Reflect.ownKeys(target).filter(key => key === "tag" || key === "accessor"),
        Object.isExtensible(target),
        Object.getPrototypeOf(target) === null,
        Object.getOwnPropertyDescriptor(target, "accessor").get === getter,
      ])`;
      evaluate(setup);
      const target = getObject("target");
      if (!api.isBuiltinFunctionObject(target)) throw Error("Expected builtin");
      const nativeFunction = target.nativeFunction;
      const properties = target.properties;
      const originalKeys = readString("JSON.stringify(Reflect.ownKeys(target).map(String))");
      expect(() => api.createOrdinaryObjectCheckpoint([target])).toThrow("Checkpoint requires");
      expect(() => api.createDataGraphCheckpoint({ roots: [target] })).toThrow(
        /Data graph cannot own function state|Checkpoint requires/,
      );
      const checkpoint = api.createStateCheckpoint({ objects: [target, target] });
      expect(checkpoint.objectCount).toBe(1);
      const baseline = readString(observation);
      expect(baseline).toBe(runInNewContext(setup + observation));
      const actions = [
        `
          target.tag = 2;
          Object.defineProperty(target, "name", { value: "changed" });
          Object.freeze(target);
        `,
        `
          delete target.tag;
          target.tag = 3;
          Object.setPrototypeOf(target, null);
          Object.seal(target);
        `,
      ];
      try {
        for (const action of isReversed ? [...actions].reverse() : actions) {
          evaluate(action);
          expect(readString(observation)).toBe(runInNewContext(setup + action + observation));
          checkpoint.restore();
          expect(target.properties === properties).toBe(true);
          expect(target.nativeFunction === nativeFunction).toBe(true);
          expect(readString("JSON.stringify(Reflect.ownKeys(target).map(String))")).toBe(
            originalKeys,
          );
          expect(readString(observation)).toBe(baseline);
        }
      } finally {
        checkpoint.release();
      }
    });
  },
);

it.each([
  "nativeFunction",
  "Call",
  "Construct",
  "Async",
  "Realm",
  "InitialName",
  "HostCapturedValues",
])("preflights changed builtin %s before any writes", async (name) => {
  await withFixture(({ api, evaluate, getObject, readString }) => {
    evaluate(`
        var first = { value: 1 };
        var target = Math.max;
      `);
    const target = getObject("target");
    const original = Object.getOwnPropertyDescriptor(target, name);
    const checkpoint = api.createStateCheckpoint({ objects: [getObject("first"), target] });
    try {
      evaluate("first.value = 2");
      Reflect.set(target, name, {});
      expect(() => checkpoint.restore()).toThrow("Checkpoint function metadata changed");
      expect(readString("String(first.value)")).toBe("2");
      if (original) Object.defineProperty(target, name, original);
      else Reflect.deleteProperty(target, name);
      checkpoint.restore();
      expect(readString("String(first.value)")).toBe("1");
    } finally {
      if (original) Object.defineProperty(target, name, original);
      else Reflect.deleteProperty(target, name);
      checkpoint.release();
    }
  });
});

it.each(["append", "reorder"])("preflights builtin slot layout changes: %s", async (mode) => {
  await withFixture(({ api }) => {
    const target = api.CreateBuiltinFunction(() => api.Value.undefined, 0, "fixture", [
      "First",
      "Second",
    ]);
    const original = target.internalSlotsList;
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    try {
      const changed = [...original];
      if (mode === "append") changed.push("Extra");
      else changed.splice(-2, 2, "Second", "First");
      Reflect.set(target, "internalSlotsList", changed);
      expect(() => checkpoint.restore()).toThrow("Checkpoint function metadata changed");
      Reflect.set(target, "internalSlotsList", original);
      checkpoint.restore();
    } finally {
      Reflect.set(target, "internalSlotsList", original);
      checkpoint.release();
    }
  });
});

it.each(["Call", "Construct", "nativeFunction", "Async", "IsClassConstructor", "Realm"])(
  "rejects builtin accessor metadata without reading it: %s",
  async (name) => {
    await withFixture(({ api, getObject }) => {
      const target = getObject("Math.max");
      const original = Object.getOwnPropertyDescriptor(target, name);
      let reads = 0;
      Object.defineProperty(target, name, {
        configurable: true,
        get: () => {
          reads++;
          throw Error("metadata getter invoked");
        },
      });
      try {
        expect(() => api.createStateCheckpoint({ objects: [target] })).toThrow(
          /Checkpoint requires|metadata must use data properties/,
        );
        expect(reads).toBe(0);
      } finally {
        if (original) Object.defineProperty(target, name, original);
        else Reflect.deleteProperty(target, name);
      }
    });
  },
);

it("does not restore a builtin's host captures or referenced native records", async () => {
  await withFixture(({ api, evaluate, realm, getObject, readString }) => {
    let calls = 0;
    const captured = getObject("({ value: 1 })");
    const record = { count: 0 };
    const target = api.CreateBuiltinFunction(
      () => {
        calls++;
        record.count++;
        return api.Value(calls);
      },
      0,
      "fixture",
      ["Record"],
    );
    Reflect.set(target, "Record", record);
    api.X(api.CreateDataPropertyOrThrow(realm.GlobalObject, "target", target));
    api.X(api.CreateDataPropertyOrThrow(target, "captured", captured));
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    try {
      evaluate(`
        target();
        target.captured.value = 3;
        target.branch = 4;
      `);
      checkpoint.restore();
      expect(
        readString('JSON.stringify([target(), target.captured.value, "branch" in target])'),
      ).toBe("[2,3,false]");
      expect(record.count).toBe(2);
      expect(calls).toBe(2);
      Reflect.set(target, "Record", {});
      expect(() => checkpoint.restore()).toThrow("Checkpoint function metadata changed");
      Reflect.set(target, "Record", record);
    } finally {
      checkpoint.release();
    }
  });
});

it.each(["property", "slot"])("retains saved builtin %s references until release", async (kind) => {
  await withFixture(({ api, evaluate, realm, getObject, readString }) => {
    const target = api.CreateBuiltinFunction(() => api.Value.undefined, 0, "fixture", ["Retained"]);
    api.X(api.CreateDataPropertyOrThrow(realm.GlobalObject, "target", target));
    const held = getObject(`
      var reference;
      (() => {
        const held = {};
        reference = new WeakRef(held);
        return held;
      })()
    `);
    if (kind === "property") api.X(api.CreateDataPropertyOrThrow(target, "held", held));
    else Reflect.set(target, "Retained", held);
    const checkpoint = api.createStateCheckpoint({ objects: [target] });
    if (kind === "property") evaluate("delete target.held");
    else Reflect.set(target, "Retained", api.Value.undefined);
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref() !== undefined)")).toBe("true");
    checkpoint.release();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref() !== undefined)")).toBe("false");
  });
});
