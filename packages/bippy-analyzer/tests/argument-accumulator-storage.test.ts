import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type {
  ArgumentAccumulatorStorage,
  ReferenceRecord,
  StateCheckpoint,
} from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture, type AbstractFixture } from "./helpers/abstract-fixture.js";

const programs = [
  { name: "call", expression: "apply(alias, enabled ? 1 : 2, 10)", kind: "arguments" },
  { name: "spread", expression: "apply(...[alias], enabled ? 1 : 2, 10)", kind: "arguments" },
  { name: "construct", expression: "new apply(alias, enabled ? 1 : 2, 10)", kind: "arguments" },
  {
    name: "template",
    expression: "tag`first${alias}middle${enabled ? 1 : 2}last${10}`",
    kind: "template-substitutions",
  },
];

it.each(
  programs.flatMap((program) => [false, true].map((trueFirst) => ({ ...program, trueFirst }))),
)(
  "discovers original accumulators for $name, trueFirst=$trueFirst",
  async ({ expression, kind, trueFirst }) => {
    const source = `
      var prefix = 0, state = { total: 0 }, alias = state;
      var apply = (() => {
        var held = state;
        return function(head, choice, tail) { held.total += choice + tail; return [head === held, held.total, prefix]; };
      })();
      var tag = (strings, ...values) => apply(...values);
      prefix++;
      JSON.stringify(${expression});
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
      const state = realm.GlobalObject.properties.get(api.Value("state"))?.Value;
      if (!(state instanceof api.ObjectValue)) throw new Error("Expected state");
      const contexts = [...agent.executionContextStack];
      const records = new Set<ReferenceRecord>();
      const lists = new Map<unknown[], ArgumentAccumulatorStorage>();
      let storage: StateCheckpoint | undefined;
      const checkpoint = agent.captureEvaluation({
        references: (value) => {
          if (value instanceof api.ReferenceRecord) records.add(value);
          const policy = api.getArgumentAccumulatorStorage(value);
          if (!policy) return [];
          expect(policy.list === value).toBe(true);
          expect(Object.isFrozen(policy)).toBe(true);
          expect(Object.isFrozen(policy.references)).toBe(true);
          expect(policy.borrowedReferences).toEqual([Array.prototype]);
          lists.set(policy.list, policy);
          return [...policy.references, ...policy.borrowedReferences];
        },
        capture: () => {
          expect(
            [...lists.values()].some(
              (policy) => policy.kind === kind && policy.references.includes(state),
            ),
          ).toBe(true);
          storage = api.createStateCheckpoint({
            objects: [realm.GlobalObject, state],
            environments: [realm.GlobalEnv],
            referenceRecords: [...records],
            nativeLists: [...lists.keys()],
          });
          return {
            restore: () => {
              storage?.restore();
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
        for (const choice of trueFirst ? [true, false] : [false, true]) {
          checkpoint.restore();
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
          expect(realm.GlobalObject.properties.get(api.Value("alias"))?.Value === state).toBe(true);
        }
        expect(storage?.nativeListCount).toBe(lists.size);
      } finally {
        checkpoint.release();
        storage?.release();
      }
    });
  },
);

interface AccumulatorFixture extends AbstractFixture {
  list: unknown[];
  syntaxArrays: readonly (readonly unknown[])[];
}

const withAccumulator = async (run: (fixture: AccumulatorFixture) => void) => {
  await withAbstractFixture((fixture) => {
    const { api, agent, compile, createBoolean } = fixture;
    createBoolean("enabled");
    const syntaxArrays: (readonly unknown[])[] = [];
    agent.hostDefinedOptions.onNodeEvaluation = (node) => {
      if (node.type === "CallExpression") syntaxArrays.push(node.Arguments);
    };
    agent.evaluate(compile("String(7, enabled ? 1 : 2)"), () => {}, false);
    agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    let list: unknown[] | undefined;
    const saved = agent.captureEvaluation({
      references: (value) => {
        const policy = api.getArgumentAccumulatorStorage(value);
        if (policy?.references.length === 1) list = policy.list;
        return [];
      },
      capture: () => ({ restore: () => {} }),
    });
    saved.release();
    if (!list) throw new Error("Expected accumulator");
    run({ ...fixture, list, syntaxArrays });
  });
};

it("does not recognize copied, proxied, or syntax arrays", async () => {
  await withAccumulator(({ api, list, syntaxArrays }) => {
    expect(syntaxArrays.length).toBeGreaterThan(0);
    const copied: unknown[] = [];
    for (const key of Reflect.ownKeys(list)) {
      const descriptor = Object.getOwnPropertyDescriptor(list, key);
      if (descriptor) Object.defineProperty(copied, key, descriptor);
    }
    let traps = 0;
    const proxy = new Proxy(list, {
      get: () => {
        traps++;
        throw new Error("Unexpected trap");
      },
    });
    const revoked = Proxy.revocable(list, {});
    revoked.revoke();
    for (const value of [
      copied,
      [...list],
      proxy,
      revoked.proxy,
      [],
      { kind: "arguments" },
      undefined,
      7,
      ...syntaxArrays,
    ])
      expect(api.getArgumentAccumulatorStorage(value)).toBeUndefined();
    expect(traps).toBe(0);
    expect(Reflect.get(api, "createArgumentAccumulator")).toBeUndefined();
    expect(Reflect.get(api, "getArgumentAccumulatorInfo")).toBeUndefined();
  });
});

it("does not expose registry mutation through captured allocator references", async () => {
  await withAbstractFixture(({ api, agent }) => {
    const algorithm = api
      .getNativeCaptures(api.ArgumentListEvaluation)
      ?.bindings.find((binding) => binding.name === "ArgumentListEvaluation_Arguments")
      ?.get();
    const allocate = api
      .getNativeCaptures(algorithm)
      ?.bindings.find((binding) => binding.name === "createArgumentAccumulator")
      ?.get();
    if (typeof allocate !== "function") throw new Error("Expected allocator dependency");
    expect(api.getNativeCaptures(allocate)).toBeUndefined();
    const impostor: unknown[] = [];
    const fresh: unknown = Reflect.apply(allocate, undefined, ["arguments", impostor]);
    expect(fresh === impostor).toBe(false);
    expect(api.getArgumentAccumulatorStorage(impostor)).toBeUndefined();
    expect(api.getArgumentAccumulatorStorage(fresh)?.references).toEqual([]);
    expect(() => Reflect.apply(allocate, undefined, ["unknown"])).toThrow(
      "Invalid argument accumulator kind",
    );
    const inspect = api
      .getNativeCaptures(api.getArgumentAccumulatorStorage)
      ?.bindings.find((binding) => binding.name === "getArgumentAccumulatorInfo")
      ?.get();
    if (typeof inspect !== "function") throw new Error("Expected inspector dependency");
    const allocation: unknown = Reflect.apply(inspect, undefined, [fresh]);
    if (!allocation || typeof allocation !== "object")
      throw new Error("Expected allocation metadata");
    expect(Object.isFrozen(allocation)).toBe(true);
    expect(Reflect.get(allocation, "agent")).toBe(agent);
    expect(api.getNativeCaptures(inspect)).toBeUndefined();
  });
});

it("reports current references without owning their native referents", async () => {
  await withAccumulator(({ api, list }) => {
    const before = api.getArgumentAccumulatorStorage(list);
    const record = { count: 0 };
    list[0] = record;
    const after = api.getArgumentAccumulatorStorage(list);
    expect(before?.references[0]).not.toBe(record);
    expect(after?.references).toEqual([record]);
    const saved = api.createStateCheckpoint({ nativeLists: [list] });
    record.count++;
    list.length = 0;
    saved.restore();
    saved.release();
    expect(list[0]).toBe(record);
    expect(record.count).toBe(1);
  });
});

it("rejects another Agent before inspecting registered storage", async () => {
  await withAccumulator(({ api, agent, list }) => {
    api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
    try {
      expect(() => api.getArgumentAccumulatorStorage(list)).toThrow(
        "Argument accumulator belongs to another Agent",
      );
    } finally {
      api.setSurroundingAgent(agent);
    }
    expect(api.getArgumentAccumulatorStorage(list)?.list).toBe(list);
  });
});

it("rejects registered storage inspection during debugger preview", async () => {
  await withAccumulator(({ api, agent, list }) => {
    agent.debugger_scopePreview(() =>
      expect(() => api.getArgumentAccumulatorStorage(list)).toThrow(
        "Argument accumulator inspection does not support debugger preview",
      ),
    );
    expect(api.getArgumentAccumulatorStorage(list)?.list).toBe(list);
  });
});

it.each(["object", "environment"])(
  "rejects foreign %s entries through the shared storage schema",
  async (kind) => {
    await withAccumulator(({ api, agent, list }) => {
      api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
      try {
        const foreignRealm = new api.ManagedRealm();
        list[0] = kind === "object" ? foreignRealm.GlobalObject : foreignRealm.GlobalEnv;
      } finally {
        api.setSurroundingAgent(agent);
      }
      expect(() => api.getArgumentAccumulatorStorage(list)).toThrow(
        "Checkpoint native list values must belong to the current agent",
      );
    });
  },
);

it.each(["accessor", "prototype", "length", "extra"])(
  "rejects changed %s storage without invoking getters",
  async (kind) => {
    await withAccumulator(({ api, list }) => {
      let reads = 0;
      if (kind === "accessor")
        Object.defineProperty(list, "0", {
          get: () => {
            reads++;
            return undefined;
          },
        });
      if (kind === "prototype") Object.setPrototypeOf(list, null);
      if (kind === "length") Object.defineProperty(list, "length", { writable: false });
      if (kind === "extra") Object.defineProperty(list, "extra", { value: 1 });
      expect(() => api.getArgumentAccumulatorStorage(list)).toThrow("Checkpoint requires");
      expect(reads).toBe(0);
    });
  },
);

it("exposes a nested unsupported dependency so the owner can reject it", async () => {
  await withAccumulator(({ api, agent, list }) => {
    const unowned = { count: 0 };
    list[0] = unowned;
    const failure = new Error("Unowned argument referent");
    let captured = false,
      caught: unknown;
    try {
      agent.captureEvaluation({
        references: (value) => {
          if (value === unowned) throw failure;
          return api.getArgumentAccumulatorStorage(value)?.references ?? [];
        },
        capture: () => {
          captured = true;
          return { restore: () => {} };
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    expect(captured).toBe(false);
    expect(() => agent.assertCanPerformHostEffect()).not.toThrow();
  });
});
