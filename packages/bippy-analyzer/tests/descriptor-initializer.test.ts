import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { DescriptorInitializer, StateCheckpoint } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";

const cases = [
  { name: "value presence", change: "if (enabled) input.value = 11; else delete input.value;" },
  {
    name: "accessor presence",
    change: "if (enabled) input.get = () => 11; else delete input.get;",
  },
  {
    name: "data/accessor switch",
    change: "if (enabled) input.value = 11; else input.get = () => 22;",
  },
  {
    name: "attribute presence",
    change:
      "if (enabled) { input.writable = true; input.configurable = true; } else { delete input.writable; delete input.configurable; }",
  },
  {
    name: "abrupt conversion",
    change: 'if (enabled) input.value = 11; else throw Error("branch");',
  },
];

it.each(cases.flatMap((entry) => [false, true].map((isReversed) => ({ ...entry, isReversed }))))(
  "restores mutable conversion records: $name reversed=$isReversed",
  async ({ change, isReversed }) => {
    const source = `
    var prefix = 0, target = {}, caught, finalized = 0;
    var input = {get enumerable() { ${change} return true; }};
    prefix++;
    try { Object.defineProperty(target, "value", input); }
    catch (error) { caught = error.message; }
    finally { finalized++; }
    JSON.stringify([target.value, Object.getOwnPropertyDescriptor(target, "value"), caught, finalized, prefix]);
  `;
    await withAbstractFixture(({ api, agent, realm, compile, createBoolean }) => {
      createBoolean("enabled");
      let prefixes = 0;
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.type === "UpdateExpression" && node.sourceText === "prefix++") prefixes++;
      };
      const observations: string[] = [];
      agent.evaluate(
        compile(source),
        (completion) => {
          if (!(completion.Value instanceof api.JSStringValue)) throw Error("Expected string");
          observations.push(completion.Value.stringValue());
        },
        false,
      );
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true });
      if (pause.done || !pause.value) throw Error("Expected decision");
      const target = realm.GlobalObject.properties.get("target")?.Value;
      const input = realm.GlobalObject.properties.get("input")?.Value;
      if (!(target instanceof api.ObjectValue) || !(input instanceof api.ObjectValue))
        throw Error("Expected objects");
      const contexts = [...agent.executionContextStack];
      const initializers = new Set<DescriptorInitializer>();
      let storage: StateCheckpoint | undefined;
      const saved = agent.captureEvaluation({
        references: (value) => {
          if (api.DescriptorInitializer && value instanceof api.DescriptorInitializer)
            initializers.add(value);
          return [];
        },
        capture: () => {
          const state = api.createStateCheckpoint({
            objects: [realm.GlobalObject, target, input],
            environments: [realm.GlobalEnv],
            contexts,
            descriptorInitializers: [...initializers],
          });
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
        for (const choice of isReversed ? [true, false] : [false, true]) {
          saved.restore();
          agent.AgentRecord.KeptAlive.clear();
          api.gc();
          expect(
            agent.resumeEvaluate({
              abstractBooleanDecision: {
                resume: "abstract-boolean",
                decision: pause.value,
                value: choice,
              },
            }).done,
          ).toBe(true);
          expect(observations.at(-1)).toBe(runInNewContext(source, { enabled: choice }));
        }
        expect(prefixes).toBe(1);
        expect(initializers.size).toBe(1);
        expect(storage?.descriptorInitializerCount).toBe(1);
      } finally {
        saved.release();
        storage?.release();
      }
    });
  },
);

it("keeps conversion values alive through the existing marker before a later guest getter pauses", async () => {
  await withAbstractFixture(({ api, agent, compile, createBoolean }) => {
    createBoolean("enabled");
    const source = `
      var reference, target = {};
      Object.defineProperty(target, "value", {
        get value() { var retained = {}; reference = new WeakRef(retained); return retained; },
        get writable() { if (enabled) return true; return false; }
      });
      JSON.stringify(reference.deref() === target.value);
    `;
    let observed: string | undefined;
    agent.evaluate(
      compile(source),
      (completion) => {
        if (!(completion.Value instanceof api.JSStringValue)) throw Error("Expected string");
        observed = completion.Value.stringValue();
      },
      false,
    );
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true });
    if (pause.done || !pause.value) throw Error("Expected decision");
    agent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(
      agent.resumeEvaluate({
        abstractBooleanDecision: { resume: "abstract-boolean", decision: pause.value, value: true },
      }).done,
    ).toBe(true);
    expect(observed).toBe("true");
    expect(runInNewContext(source, { enabled: true })).toBe("true");
  });
});

it("restores every field in the original initializer and permits intermediate mixed fields", async () => {
  await withAbstractFixture(({ api, evaluate }) => {
    const record = new api.DescriptorInitializer();
    const getter = evaluate("(() => 7)").Value;
    if (!api.IsCallable(getter)) throw Error("Expected function");
    record.Value = api.Value(1);
    record.Get = getter;
    record.Set = api.Value.undefined;
    record.Writable = true;
    record.Enumerable = false;
    record.Configurable = true;
    const before = Object.getOwnPropertyDescriptors(record);
    const selection = [record, record];
    const saved = api.createStateCheckpoint({ descriptorInitializers: selection });
    try {
      expect(saved.descriptorInitializerCount).toBe(1);
      expect(saved.descriptorCount).toBe(0);
      selection.length = 0;
      record.Value = undefined;
      record.Get = undefined;
      record.Set = getter;
      record.Writable = false;
      record.Enumerable = true;
      record.Configurable = undefined;
      saved.restore();
      expect(Object.getOwnPropertyDescriptors(record)).toEqual(before);
      expect(() => api.createStateCheckpoint({ descriptors: [record] })).toThrow(
        "Checkpoint requires canonical Descriptor records",
      );
    } finally {
      saved.release();
    }
    expect(() => saved.restore()).toThrow("Object checkpoint is released");
  });
});

it.each(["frozen", "sealed", "nonextensible", "attributes", "getter", "extra", "prototype"])(
  "rejects invalid initializer storage before other writes: %s",
  async (kind) => {
    await withAbstractFixture(({ api, realm }) => {
      const record = new api.DescriptorInitializer();
      const saved = api.createStateCheckpoint({
        descriptorInitializers: [record],
        objects: [realm.GlobalObject],
      });
      let reads = 0;
      if (kind === "frozen") Object.freeze(record);
      if (kind === "sealed") Object.seal(record);
      if (kind === "nonextensible") Object.preventExtensions(record);
      if (kind === "attributes") Object.defineProperty(record, "Value", { enumerable: false });
      if (kind === "getter")
        Object.defineProperty(record, "Value", {
          get: () => {
            reads++;
            return api.Value(1);
          },
        });
      if (kind === "extra") Object.defineProperty(record, "extra", { value: true });
      if (kind === "prototype") Object.setPrototypeOf(record, {});
      api.X(api.CreateDataPropertyOrThrow(realm.GlobalObject, "branchOnly", api.Value.true));
      const error = ["getter", "extra", "prototype"].includes(kind)
        ? "Checkpoint requires canonical Descriptor records"
        : "Checkpoint requires writable Descriptor initializer fields";
      try {
        expect(() => saved.restore()).toThrow(error);
        expect(realm.GlobalObject.properties.has("branchOnly")).toBe(true);
      } finally {
        saved.release();
      }
      expect(() => api.createStateCheckpoint({ descriptorInitializers: [record] })).toThrow(error);
      expect(reads).toBe(0);
    });
  },
);

it("does not restore referenced guest contents and keeps initializer snapshot values rooted until release", async () => {
  await withAbstractFixture(({ api, agent, realm, evaluate }) => {
    evaluate("var payload = {count: 0}; var reference = new WeakRef(payload);");
    const payload = realm.GlobalObject.properties.get("payload")?.Value;
    const record = new api.DescriptorInitializer();
    record.Value = payload;
    const saved = api.createStateCheckpoint({ descriptorInitializers: [record] });
    try {
      evaluate("payload.count++; payload = null;");
      record.Value = undefined;
      agent.AgentRecord.KeptAlive.clear();
      api.gc();
      expect(evaluate("reference.deref().count").Value).toEqual(api.Value(1));
      saved.restore();
      expect(record.Value).toBe(payload);
    } finally {
      saved.release();
    }
    agent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(evaluate("reference.deref()").Value).toBe(api.Value.undefined);
  });
});

it.each(["Value", "Get", "Set", "Writable", "Enumerable", "Configurable"])(
  "preflights initializer field types before writes: %s",
  async (field) => {
    await withAbstractFixture(({ api, realm }) => {
      const record = new api.DescriptorInitializer();
      const saved = api.createStateCheckpoint({
        descriptorInitializers: [record],
        objects: [realm.GlobalObject],
      });
      Object.defineProperty(record, field, { value: {} });
      api.X(api.CreateDataPropertyOrThrow(realm.GlobalObject, "branchOnly", api.Value.true));
      try {
        expect(() => saved.restore()).toThrow("Checkpoint requires valid Descriptor fields");
        expect(realm.GlobalObject.properties.has("branchOnly")).toBe(true);
      } finally {
        saved.release();
      }
      expect(() => api.createStateCheckpoint({ descriptorInitializers: [record] })).toThrow(
        "Checkpoint requires valid Descriptor fields",
      );
    });
  },
);

it.each(["Value", "Get", "Set"])(
  "rejects foreign initializer %s values at capture and restore",
  async (field) => {
    await withAbstractFixture(({ api, agent }) => {
      const record = new api.DescriptorInitializer();
      const saved = api.createStateCheckpoint({ descriptorInitializers: [record] });
      api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
      let foreign;
      try {
        const realm = new api.ManagedRealm();
        foreign = api.EnsureCompletion(realm.evaluateScriptSkipDebugger("(() => 1)")).Value;
      } finally {
        api.setSurroundingAgent(agent);
      }
      Object.defineProperty(record, field, { value: foreign });
      try {
        expect(() => saved.restore()).toThrow(
          "Checkpoint Descriptor values must belong to the current agent",
        );
      } finally {
        saved.release();
      }
      expect(() => api.createStateCheckpoint({ descriptorInitializers: [record] })).toThrow(
        "Checkpoint Descriptor values must belong to the current agent",
      );
    });
  },
);

it("does not accept a final Descriptor as writable initializer storage", async () => {
  await withAbstractFixture(({ api, evaluate }) => {
    const object = evaluate("({value: 1})").Value;
    if (!(object instanceof api.ObjectValue)) throw Error("Expected object");
    const descriptor = object.properties.get("value");
    if (!descriptor) throw Error("Expected descriptor");
    expect(() => api.createStateCheckpoint({ descriptorInitializers: [descriptor] })).toThrow(
      "Checkpoint requires canonical Descriptor records",
    );
  });
});

it("preserves Agent, preview and LIFO restrictions", async () => {
  await withAbstractFixture(({ api, agent }) => {
    const record = new api.DescriptorInitializer();
    agent.debugger_scopePreview(() =>
      expect(() => api.createStateCheckpoint({ descriptorInitializers: [record] })).toThrow(
        "Descriptor checkpoints do not support debugger preview",
      ),
    );
    const outer = api.createStateCheckpoint({ descriptorInitializers: [record] });
    const inner = api.createStateCheckpoint({ descriptorInitializers: [record] });
    try {
      expect(() => outer.restore()).toThrow("last-in-first-out");
      expect(() => outer.release()).toThrow("last-in-first-out");
      api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
      expect(() => inner.restore()).toThrow("belongs to another agent");
      expect(() => inner.release()).toThrow("belongs to another agent");
      api.setSurroundingAgent(agent);
      agent.debugger_scopePreview(() =>
        expect(() => inner.restore()).toThrow(
          "Descriptor checkpoints do not support debugger preview",
        ),
      );
      inner.restore();
    } finally {
      api.setSurroundingAgent(agent);
      inner.release();
      outer.release();
    }
  });
});
