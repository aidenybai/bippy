import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { Descriptor, StateCheckpoint } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture, type AbstractFixture } from "./helpers/abstract-fixture.js";

it.each(
  ["getter", "setter"].flatMap((kind) => [false, true].map((isReversed) => ({ kind, isReversed }))),
)(
  "retains read-only descriptors across real $kind branches, reversed=$isReversed",
  async ({ kind, isReversed }) => {
    const source = `
    var prefix = 0;
    var target = ${
      kind === "getter"
        ? `{
      get value() {
        if (enabled) Object.defineProperty(this, "value", {value: 11, configurable: true});
        else Object.defineProperty(this, "value", {value: 22, configurable: true});
        return this.value;
      }
    }`
        : `{
      set value(next) {
        if (enabled) this.choice = next + 1;
        else this.choice = next - 1;
        Object.defineProperty(this, "value", {value: this.choice, configurable: true});
      }
    }`
    };
    prefix++;
    ${kind === "getter" ? "target.value;" : "target.value = 10;"}
    JSON.stringify([target, Object.getOwnPropertyDescriptor(target, "value"), prefix]);
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
      if (!(target instanceof api.ObjectValue)) throw Error("Expected target");
      const original = target.properties.get("value");
      if (!original) throw Error("Expected original descriptor");
      const contexts = [...agent.executionContextStack];
      const descriptors = new Set<Descriptor>();
      let storage: StateCheckpoint | undefined;
      const saved = agent.captureEvaluation({
        references: (value) => {
          if (value instanceof api.Descriptor) descriptors.add(value);
          return [];
        },
        capture: () => {
          expect(descriptors.has(original)).toBe(false);
          expect(
            [...descriptors].some(
              (record) => record.Get === original.Get && record.Set === original.Set,
            ),
          ).toBe(true);
          const state = api.createStateCheckpoint({
            objects: [realm.GlobalObject, target],
            environments: [realm.GlobalEnv],
            contexts,
            descriptors: [...descriptors],
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
          expect(target.properties.get("value")).toBe(original);
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
      } finally {
        saved.release();
        storage?.release();
      }
    });
  },
);

const getDescriptor = (fixture: AbstractFixture, source: string): Descriptor => {
  const { api, evaluate } = fixture;
  const result = evaluate(source);
  if (result.Type !== "normal" || !(result.Value instanceof api.ObjectValue))
    throw Error("Expected descriptor input");
  return api.X(api.skipDebugger(api.ToPropertyDescriptor(result.Value)));
};

it.each(
  [
    {
      name: "data",
      source: "({ value: 1, writable: true, enumerable: true, configurable: true })",
    },
    { name: "accessor", source: "({ get() { return 1; }, set(value) {}, enumerable: true })" },
    { name: "generic", source: "({})" },
  ].flatMap((entry) => [false, true].map((frozen) => ({ ...entry, frozen }))),
)("validates original $name Descriptor identities, frozen=$frozen", async ({ source, frozen }) => {
  await withAbstractFixture((fixture) => {
    const { api } = fixture;
    const descriptor = getDescriptor(fixture, source);
    if (frozen) Object.freeze(descriptor);
    const before = Object.getOwnPropertyDescriptors(descriptor);
    const selected = [descriptor, descriptor];
    const saved = api.createStateCheckpoint({ descriptors: selected });
    try {
      expect(saved.descriptorCount).toBe(1);
      expect(saved.objectCount).toBe(0);
      selected.length = 0;
      saved.restore();
      expect(Object.getOwnPropertyDescriptors(descriptor)).toEqual(before);
    } finally {
      saved.release();
    }
    expect(() => saved.restore()).toThrow("Object checkpoint is released");
  });
});

it.each(["Value", "Get", "Set", "Writable", "Enumerable", "Configurable"])(
  "rejects changed read-only Descriptor field %s before restoring other state",
  async (field) => {
    await withAbstractFixture((fixture) => {
      const { api, realm } = fixture;
      const descriptor = getDescriptor(
        fixture,
        "({value: 1, writable: true, enumerable: true, configurable: true})",
      );
      const saved = api.createStateCheckpoint({
        descriptors: [descriptor],
        objects: [realm.GlobalObject],
      });
      try {
        Object.defineProperty(descriptor, field, {
          value: ["Value", "Get", "Set"].includes(field) ? api.Value.undefined : false,
        });
        api.X(api.CreateDataPropertyOrThrow(realm.GlobalObject, "branchOnly", api.Value.true));
        expect(() => saved.restore()).toThrow("Checkpoint Descriptor metadata changed");
        expect(realm.GlobalObject.properties.has("branchOnly")).toBe(true);
      } finally {
        saved.release();
      }
    });
  },
);

it.each(["getter", "missing", "extra", "prototype"])(
  "rejects noncanonical Descriptor layout at capture and restore: %s",
  async (kind) => {
    await withAbstractFixture((fixture) => {
      const { api } = fixture;
      const descriptor = getDescriptor(fixture, "({value: 1})");
      const saved = api.createStateCheckpoint({ descriptors: [descriptor] });
      let reads = 0;
      if (kind === "getter")
        Object.defineProperty(descriptor, "Value", {
          get: () => {
            reads++;
            return api.Value(2);
          },
        });
      if (kind === "missing") Reflect.deleteProperty(descriptor, "Value");
      if (kind === "extra") Object.defineProperty(descriptor, "extra", { value: 1 });
      if (kind === "prototype") Object.setPrototypeOf(descriptor, {});
      try {
        expect(() => saved.restore()).toThrow("Checkpoint requires canonical Descriptor records");
      } finally {
        saved.release();
      }
      expect(() => api.createStateCheckpoint({ descriptors: [descriptor] })).toThrow(
        "Checkpoint requires canonical Descriptor records",
      );
      expect(reads).toBe(0);
      const next = api.createStateCheckpoint();
      next.release();
    });
  },
);

it.each(["writable", "enumerable", "configurable", "extensible"])(
  "rejects changed native Descriptor metadata: %s",
  async (field) => {
    await withAbstractFixture((fixture) => {
      const { api } = fixture;
      const descriptor = getDescriptor(fixture, "({value: 1})");
      const saved = api.createStateCheckpoint({ descriptors: [descriptor] });
      try {
        if (field === "extensible") Object.preventExtensions(descriptor);
        else Object.defineProperty(descriptor, "Value", { [field]: false });
        expect(() => saved.restore()).toThrow("Checkpoint Descriptor metadata changed");
      } finally {
        saved.release();
      }
    });
  },
);

it.each(["Value", "Get", "Set", "Writable", "Enumerable", "Configurable", "mixed"])(
  "rejects invalid Descriptor fields: %s",
  async (field) => {
    await withAbstractFixture((fixture) => {
      const { api } = fixture;
      const descriptor = getDescriptor(fixture, "({value: 1})");
      Object.defineProperty(descriptor, field === "mixed" ? "Get" : field, {
        value: field === "mixed" ? api.Value.undefined : {},
      });
      expect(() => api.createStateCheckpoint({ descriptors: [descriptor] })).toThrow(
        "Checkpoint requires valid Descriptor fields",
      );
    });
  },
);

it.each([false, true])(
  "implies retained property-table descriptors and rejects alias mutation, explicit=%s",
  async (isExplicit) => {
    await withAbstractFixture((fixture) => {
      const { api, evaluate } = fixture;
      const object = evaluate("({value: 1})").Value;
      if (!(object instanceof api.ObjectValue)) throw Error("Expected object");
      const descriptor = object.properties.get("value");
      if (!descriptor) throw Error("Expected descriptor");
      const saved = api.createStateCheckpoint({
        objects: [object],
        descriptors: isExplicit ? [descriptor] : [],
      });
      try {
        expect(saved.descriptorCount).toBe(1);
        api.X(api.CreateDataPropertyOrThrow(object, "value", api.Value(2)));
        expect(object.properties.get("value")).not.toBe(descriptor);
        Object.defineProperty(descriptor, "Value", { value: api.Value(3) });
        expect(() => saved.restore()).toThrow("Checkpoint Descriptor metadata changed");
        expect(object.properties.get("value")?.Value).toEqual(api.Value(2));
      } finally {
        saved.release();
      }
    });
  },
);

it("keeps normal guest property replacement compatible and restores original descriptor identity", async () => {
  await withAbstractFixture(({ api, evaluate }) => {
    const object = evaluate("({value: 1})").Value;
    if (!(object instanceof api.ObjectValue)) throw Error("Expected object");
    const descriptor = object.properties.get("value");
    const saved = api.createStateCheckpoint({ objects: [object] });
    try {
      expect(saved.descriptorCount).toBe(1);
      api.X(api.CreateDataPropertyOrThrow(object, "value", api.Value(2)));
      saved.restore();
      expect(object.properties.get("value")).toBe(descriptor);
      expect(descriptor?.Value).toEqual(api.Value(1));
    } finally {
      saved.release();
    }
  });
});

it("does not restore or freeze a Descriptor's referenced guest contents", async () => {
  await withAbstractFixture((fixture) => {
    const { api, evaluate } = fixture;
    evaluate("var payload = {count: 0};");
    const descriptor = getDescriptor(fixture, "({value: payload})");
    const saved = api.createStateCheckpoint({ descriptors: [descriptor] });
    try {
      evaluate("payload.count++;");
      saved.restore();
      expect(evaluate("payload.count").Value).toEqual(api.Value(1));
      expect(saved.objectCount).toBe(0);
      expect(saved.descriptorCount).toBe(1);
    } finally {
      saved.release();
    }
  });
});

it("roots live and saved Descriptor values until release without rewinding illegal native mutation", async () => {
  await withAbstractFixture((fixture) => {
    const { api, agent, realm, evaluate } = fixture;
    evaluate(
      "var original = {}, changed = {}; var firstWeak = new WeakRef(original), secondWeak = new WeakRef(changed);",
    );
    const descriptor = getDescriptor(fixture, "({value: original})");
    const changed = realm.GlobalObject.properties.get("changed")?.Value;
    const saved = api.createStateCheckpoint({ descriptors: [descriptor] });
    Object.defineProperty(descriptor, "Value", { value: changed });
    evaluate("original = changed = null;");
    const observe = () => {
      agent.AgentRecord.KeptAlive.clear();
      api.gc();
      const result = evaluate(
        "JSON.stringify([firstWeak.deref() !== undefined, secondWeak.deref() !== undefined])",
      );
      if (!(result.Value instanceof api.JSStringValue)) throw Error("Expected string");
      return result.Value.stringValue();
    };
    try {
      expect(observe()).toBe("[true,true]");
      expect(() => saved.restore()).toThrow("Checkpoint Descriptor metadata changed");
    } finally {
      saved.release();
    }
    expect(observe()).toBe("[false,false]");
  });
});

it("preserves Agent/LIFO guards and rejects explicit Descriptor selection during preview", async () => {
  await withAbstractFixture((fixture) => {
    const { api, agent } = fixture;
    const descriptor = getDescriptor(fixture, "({value: 1})");
    agent.debugger_scopePreview(() =>
      expect(() => api.createStateCheckpoint({ descriptors: [descriptor] })).toThrow(
        "Descriptor checkpoints do not support debugger preview",
      ),
    );
    const outer = api.createStateCheckpoint({ descriptors: [descriptor] });
    const inner = api.createStateCheckpoint({ descriptors: [descriptor] });
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

it.each(["Value", "Get", "Set"])("rejects foreign Descriptor %s references", async (field) => {
  await withAbstractFixture((fixture) => {
    const { api, agent } = fixture;
    const descriptor = getDescriptor(fixture, field === "Value" ? "({value: 1})" : "({get() {}})");
    api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
    let foreign;
    try {
      const realm = new api.ManagedRealm();
      foreign = api.EnsureCompletion(realm.evaluateScriptSkipDebugger("(() => 1)")).Value;
    } finally {
      api.setSurroundingAgent(agent);
    }
    Object.defineProperty(descriptor, field, { value: foreign });
    expect(() => api.createStateCheckpoint({ descriptors: [descriptor] })).toThrow(
      "Checkpoint Descriptor values must belong to the current agent",
    );
  });
});
