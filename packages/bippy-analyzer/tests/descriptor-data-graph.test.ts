import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type {
  DescriptorGraphCheckpoint,
  DescriptorInitializer,
} from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";

it.each(
  [false, true].flatMap((trueFirst) => [false, true].map((throws) => ({ trueFirst, throws }))),
)(
  "plans initializer dependencies at an actual conversion pause, trueFirst=$trueFirst throws=$throws",
  async ({ trueFirst, throws }) => {
    const source = `
      var prefix = 0;
      var payload = Object.create(null), child = Object.create(null), target = Object.create(null);
      payload.left = child; payload.right = child; payload.target = target; payload.caught = null; child.count = 0;
      try {
        Object.defineProperty(target, "result", {
          configurable: true,
          get value() { prefix++; return payload; },
          get writable() {
            if (enabled) { child.count = 11; return true; }
            child.count = 22;
            ${throws ? 'throw "blocked";' : "return false;"}
          }
        });
      } catch (error) { payload.caught = error; }
      JSON.stringify([prefix, child.count, payload.left === payload.right, target.result === payload,
        Object.getOwnPropertyDescriptor(target, "result")?.writable ?? null, payload.caught]);
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
          if (!(completion.Value instanceof api.JSStringValue))
            throw new Error("Expected observation");
          observations.push(completion.Value.stringValue());
        },
        false,
      );
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (pause.done || !pause.value) throw new Error("Expected pause");
      const target = realm.GlobalObject.properties.get("target")?.Value;
      const payload = realm.GlobalObject.properties.get("payload")?.Value;
      if (!(target instanceof api.ObjectValue) || !(payload instanceof api.ObjectValue))
        throw new Error("Expected objects");
      const initializers = new Set<DescriptorInitializer>();
      let graph: DescriptorGraphCheckpoint | undefined;
      const contexts = [...agent.executionContextStack];
      const saved = agent.captureEvaluation({
        references: (value) => {
          if (value instanceof api.DescriptorInitializer) initializers.add(value);
          return [];
        },
        capture: () => {
          expect(initializers.size).toBe(1);
          graph = api.createDescriptorGraphCheckpoint({ roots: [...initializers] });
          expect([graph.objectCount, graph.descriptorInitializerCount]).toEqual([3, 1]);
          return {
            restore: () => {
              graph?.restore();
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
        expect(() => agent.assertCanPerformHostEffect()).toThrow(
          "Host effects are unsupported during evaluation checkpoints",
        );
        for (const choice of trueFirst ? [true, false] : [false, true]) {
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
          expect(prefixes).toBe(1);
          expect([...initializers][0].Value === payload).toBe(true);
        }
      } finally {
        saved.release();
        graph?.release();
      }
    });
  },
);

it("shares descriptors, cycles, symbols, arrays and collection entries through existing storage", async () => {
  await withAbstractFixture(({ api, evaluate }) => {
    const root = evaluate(`
      var key = Symbol("key");
      var data = Object.create(null), child = Object.create(null);
      var list = Object.setPrototypeOf([], null), map = Object.setPrototypeOf(new Map(), null), set = Object.setPrototypeOf(new Set(), null);
      data.self = data; data.first = child; data.second = child; data[key] = child;
      list[2] = child; data.list = list; data.map = map; data.set = set;
      Map.prototype.set.call(map, child, data); Set.prototype.add.call(set, child);
      child.count = 1;
      data;
    `).Value;
    const record = api.Descriptor({ Value: root });
    const initializer = new api.DescriptorInitializer();
    initializer.Value = root;
    const roots = [record, initializer, record];
    const snapshot = api.createDescriptorGraphCheckpoint({ roots });
    expect(snapshot.scope).toBe("descriptor-data-graph-v1");
    expect(snapshot.objectCount).toBe(5);
    expect(snapshot.descriptorInitializerCount).toBe(1);
    roots.length = 0;
    try {
      evaluate(
        "child.count=9; delete data.self; list.length=0; Map.prototype.clear.call(map); Set.prototype.clear.call(set)",
      );
      initializer.Value = api.Value(9);
      snapshot.restore();
      expect(initializer.Value === root).toBe(true);
      expect(
        evaluate(
          "JSON.stringify([child.count, data.self===data, data.first===data.second, data[key]===child, list.length, 0 in list, list[2]===child, Map.prototype.get.call(map,child)===data, Set.prototype.has.call(set,child)])",
        ).Value,
      ).toEqual(api.Value("[1,true,true,true,3,false,true,true,true]"));
    } finally {
      snapshot.release();
    }
  });
});

it.each(["prototype", "hidden", "symbol", "getter", "weak"])(
  "rejects unsupported %s dependencies without publishing a frame",
  async (kind) => {
    await withAbstractFixture(({ api, evaluate }) => {
      const source =
        kind === "prototype"
          ? "({})"
          : kind === "hidden"
            ? "Object.defineProperty(Object.create(null), 'hidden', {value:()=>1})"
            : kind === "symbol"
              ? "Object.assign(Object.create(null), {[Symbol()]:()=>1})"
              : kind === "getter"
                ? "Object.defineProperty(Object.create(null), 'value', {get(){throw 'must not call'}})"
                : "Object.setPrototypeOf(new WeakMap(), null)";
      const record = api.Descriptor({ Value: evaluate(source).Value });
      const outer = api.createStateCheckpoint();
      try {
        expect(() => api.createDescriptorGraphCheckpoint({ roots: [record] })).toThrow(
          kind === "prototype" || kind === "weak"
            ? "Checkpoint requires ordinary objects or supported exotic objects and functions without additional internal state"
            : "Data graph cannot own function state",
        );
        expect(() => outer.restore()).not.toThrow();
      } finally {
        outer.release();
      }
    });
  },
);

it("rejects descriptor-shaped records and native functions without capture expansion", async () => {
  await withAbstractFixture(({ api, agent }) => {
    let metadataReads = 0;
    const callback = api.registerNativeClosure(
      () => {},
      () => {
        metadataReads++;
        return { bindings: [], ambientNames: [] };
      },
    );
    for (const root of [{ Value: api.Value(1) }, callback, agent.assertCanPerformHostEffect]) {
      expect(() =>
        Reflect.apply(api.createDescriptorGraphCheckpoint, undefined, [{ roots: [root] }]),
      ).toThrow("canonical Descriptor");
    }
    expect(metadataReads).toBe(0);
  });
});

it.each(["Get", "Set"])(
  "rejects callable %s dependencies in final and mutable root records",
  async (field) => {
    await withAbstractFixture(({ api, evaluate }) => {
      const callable = evaluate("() => 1").Value;
      if (!api.IsCallable(callable)) throw new Error("Expected callable");
      const record =
        field === "Get" ? api.Descriptor({ Get: callable }) : api.Descriptor({ Set: callable });
      const initializer = new api.DescriptorInitializer();
      if (field === "Get") initializer.Get = callable;
      else initializer.Set = callable;
      for (const root of [record, initializer]) {
        expect(() => api.createDescriptorGraphCheckpoint({ roots: [root] })).toThrow(
          "Data graph cannot own function state",
        );
      }
    });
  },
);

it("uses canonical schemas, not an allocation-provenance or native hidden-state claim", async () => {
  await withAbstractFixture(({ api }) => {
    const original = api.Descriptor({ Value: api.Value(1) });
    const copied = Object.create(
      Object.getPrototypeOf(original),
      Object.getOwnPropertyDescriptors(original),
    );
    const saved = api.createDescriptorGraphCheckpoint({ roots: [copied] });
    expect(saved.descriptorCount).toBe(1);
    saved.release();
  });
});

it("validates final descriptor metadata before restoring mutable initializers or payloads", async () => {
  await withAbstractFixture(({ api, evaluate }) => {
    const payload = evaluate("var payload = Object.create(null); payload.count = 1; payload").Value;
    const record = api.Descriptor({ Value: payload });
    const initializer = new api.DescriptorInitializer();
    initializer.Value = payload;
    const saved = api.createDescriptorGraphCheckpoint({ roots: [initializer, record] });
    try {
      initializer.Value = api.Value(7);
      evaluate("payload.count=9");
      Object.defineProperty(record, "Writable", { value: true });
      expect(() => saved.restore()).toThrow("Descriptor metadata changed");
      expect(initializer.Value).toEqual(api.Value(7));
      expect(evaluate("payload.count").Value).toEqual(api.Value(9));
      Object.defineProperty(record, "Writable", { value: undefined });
      saved.restore();
      expect(initializer.Value === payload).toBe(true);
      expect(evaluate("payload.count").Value).toEqual(api.Value(1));
    } finally {
      saved.release();
    }
  });
});

it("retains saved descriptor payloads until release through original checkpoint roots", async () => {
  await withAbstractFixture(({ api, agent, evaluate, realm }) => {
    const target = evaluate(
      "var target=Object.create(null); var weak=new WeakRef(target); target",
    ).Value;
    const weak = realm.GlobalObject.properties.get("weak")?.Value;
    if (!(weak instanceof api.ObjectValue)) throw new Error("Expected WeakRef");
    const record = new api.DescriptorInitializer();
    record.Value = target;
    const saved = api.createDescriptorGraphCheckpoint({ roots: [record] });
    evaluate("target=undefined");
    record.Value = undefined;
    agent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(Reflect.get(weak, "WeakRefTarget") === target).toBe(true);
    saved.release();
    agent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(Reflect.get(weak, "WeakRefTarget") === target).toBe(false);
  });
});

it("counts copied roots, unique descriptor fields and existing graph entries", async () => {
  await withAbstractFixture(({ api, evaluate }) => {
    const record = api.Descriptor({ Value: evaluate("Object.create(null)").Value });
    const saved = api.createDescriptorGraphCheckpoint({
      roots: [record, record],
      maxObjects: 1,
      maxEntries: 9,
    });
    expect([saved.objectCount, saved.descriptorCount, saved.entryCount]).toEqual([1, 1, 9]);
    saved.release();
    expect(() =>
      api.createDescriptorGraphCheckpoint({ roots: [record, record], maxEntries: 8 }),
    ).toThrow("entry budget");
    const graph = evaluate(
      "var graph=Object.create(null); graph.child=Object.create(null); graph",
    ).Value;
    expect(() =>
      api.createDescriptorGraphCheckpoint({
        roots: [api.Descriptor({ Value: graph })],
        maxObjects: 1,
      }),
    ).toThrow("object budget");
    for (const limit of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => api.createDescriptorGraphCheckpoint({ roots: [], maxObjects: limit })).toThrow(
        "positive safe integers",
      );
      expect(() => api.createDescriptorGraphCheckpoint({ roots: [], maxEntries: limit })).toThrow(
        "positive safe integers",
      );
    }
  });
});

it("rejects foreign payloads before publishing a graph checkpoint", async () => {
  await withAbstractFixture(({ api, agent }) => {
    api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
    let foreign;
    try {
      foreign = new api.ManagedRealm().GlobalObject;
    } finally {
      api.setSurroundingAgent(agent);
    }
    const outer = api.createStateCheckpoint();
    try {
      expect(() =>
        api.createDescriptorGraphCheckpoint({ roots: [api.Descriptor({ Value: foreign })] }),
      ).toThrow("Descriptor values must belong to the current agent");
      outer.restore();
    } finally {
      outer.release();
    }
  });
});

it("pins the Agent across root getters and reads root membership once", async () => {
  await withAbstractFixture(({ api, agent }) => {
    const record = api.Descriptor({ Value: api.Value(1) });
    let reads = 0;
    const roots = [record];
    Object.defineProperty(roots, "0", {
      get: () => {
        reads++;
        roots.length = 0;
        return record;
      },
    });
    const saved = api.createDescriptorGraphCheckpoint({ roots });
    expect([reads, saved.descriptorCount]).toEqual([1, 1]);
    saved.release();
    Object.defineProperty(roots, "0", {
      configurable: true,
      get: () => {
        api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
        return record;
      },
    });
    try {
      expect(() => api.createDescriptorGraphCheckpoint({ roots })).toThrow(
        "Descriptor graph belongs to another agent",
      );
    } finally {
      api.setSurroundingAgent(agent);
    }
    expect(() =>
      Reflect.apply(api.createDescriptorGraphCheckpoint, undefined, [{ roots: {} }]),
    ).toThrow("roots must be an array");
  });
});

it.each([false, true])(
  "validates record layout without executing slot getters, initializer=%s",
  async (isInitializer) => {
    await withAbstractFixture(({ api }) => {
      const record = isInitializer
        ? new api.DescriptorInitializer()
        : api.Descriptor({ Value: api.Value(1) });
      let reads = 0;
      Object.defineProperty(record, "Value", {
        get: () => {
          reads++;
          return api.Value(1);
        },
      });
      expect(() => api.createDescriptorGraphCheckpoint({ roots: [record] })).toThrow(
        "canonical Descriptor",
      );
      expect(reads).toBe(0);
    });
  },
);

it("preserves Agent, preview and shared LIFO boundaries", async () => {
  await withAbstractFixture(({ api, agent }) => {
    const record = api.Descriptor({ Value: api.Value(1) });
    agent.debugger_scopePreview(() =>
      expect(() => api.createDescriptorGraphCheckpoint({ roots: [record] })).toThrow(
        "debugger preview",
      ),
    );
    const outer = api.createDescriptorGraphCheckpoint({ roots: [record] });
    const inner = api.createStateCheckpoint();
    expect(() => outer.restore()).toThrow("last-in-first-out");
    inner.release();
    api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
    try {
      expect(() => outer.restore()).toThrow("belongs to another agent");
    } finally {
      api.setSurroundingAgent(agent);
    }
    outer.restore();
    outer.release();
    expect(() => outer.restore()).toThrow("released");
  });
});
