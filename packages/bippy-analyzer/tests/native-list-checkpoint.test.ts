import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { ReferenceRecord, StateCheckpoint } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";

const programs = [
  { name: "call", body: `record("prefix", enabled ? "left" : "right");` },
  { name: "spread", body: `record(...["prefix"], enabled ? "left" : "right");` },
  {
    name: "construct",
    body: `new (function (...values) { result.args = values; })("prefix", enabled ? "left" : "right");`,
  },
  { name: "tag", body: 'record`before${"prefix"}middle${enabled ? "left" : "right"}after`;' },
];

it.each(
  programs.flatMap((program) => [false, true].map((isReversed) => ({ ...program, isReversed }))),
)("restores engine argument lists: $name reversed=$isReversed", async ({ body, isReversed }) => {
  const source = `
    var result = {}, prefix = 0;
    var record = (...values) => { result.args = values; };
    prefix++;
    ${body}
    JSON.stringify([result, prefix]);
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
    const result = realm.GlobalObject.properties.get("result")?.Value;
    if (!(result instanceof api.ObjectValue)) throw Error("Expected result object");
    const references = new Set<ReferenceRecord>();
    const lists = new Set<unknown[]>();
    const contexts = [...agent.executionContextStack];
    let storage: StateCheckpoint | undefined;
    const checkpoint = agent.captureEvaluation({
      references: (value) => {
        if (value instanceof api.ReferenceRecord) references.add(value);
        if (
          Array.isArray(value) &&
          value.length === 1 &&
          value[0] instanceof api.JSStringValue &&
          value[0].stringValue() === "prefix"
        )
          lists.add(value);
        return [];
      },
      capture: (roots) => {
        expect(lists.size).toBeGreaterThan(0);
        expect([...lists].some((list) => roots.controlOwnedObjects.includes(list))).toBe(false);
        const state = api.createStateCheckpoint({
          objects: [realm.GlobalObject, result],
          environments: [realm.GlobalEnv],
          referenceRecords: [...references],
          nativeLists: [...lists],
        });
        storage = state;
        return {
          restore: () => {
            state.restore();
            agent.executionContextStack.splice(0, agent.executionContextStack.length, ...contexts);
          },
        };
      },
    });
    try {
      for (const choice of isReversed ? [true, false] : [false, true]) {
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
        expect(prefixes).toBe(1);
        expect(observations.at(-1)).toBe(runInNewContext(source, { enabled: choice }));
      }
      expect(storage?.nativeListCount).toBe(lists.size);
    } finally {
      checkpoint.release();
      storage?.release();
    }
  });
});

it("restores original arrays, sparse slots, length, cycles and aliases without owning elements", async () => {
  await withAbstractFixture(({ api }) => {
    const element = { count: 0 };
    const list: unknown[] = [element, undefined];
    list.length = 5;
    list[4] = list;
    const second = [list, element];
    const selected = [list, list, second];
    const saved = api.createStateCheckpoint({ nativeLists: selected });
    try {
      expect(saved.nativeListCount).toBe(2);
      expect(saved.objectCount).toBe(0);
      selected.length = 0;
      list.splice(0, 5, "branch");
      second.length = 0;
      element.count++;
      saved.restore();
      expect(list.length).toBe(5);
      expect(Reflect.ownKeys(list)).toEqual(["0", "1", "4", "length"]);
      expect(list[0]).toBe(element);
      expect(list[1]).toBeUndefined();
      expect(Object.hasOwn(list, 1)).toBe(true);
      expect(Object.hasOwn(list, 2)).toBe(false);
      expect(list[4]).toBe(list);
      expect(second).toEqual([list, element]);
      expect(element.count).toBe(1);
      expect(Object.getOwnPropertyDescriptor(list, "0")).toEqual({
        value: element,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      list.push("again");
      saved.restore();
      expect(list.length).toBe(5);
    } finally {
      saved.release();
    }
    expect(() => saved.restore()).toThrow("Object checkpoint is released");
  });
});

it.each([
  "accessor",
  "readonly",
  "nonconfigurable",
  "nonenumerable",
  "named",
  "symbol",
  "readonly-length",
  "sealed",
  "prototype",
])("rejects unsupported native list storage at capture: %s", async (kind) => {
  await withAbstractFixture(({ api }) => {
    const list = [api.Value(1)];
    let reads = 0;
    if (kind === "accessor")
      Object.defineProperty(list, "0", {
        get: () => {
          reads++;
          return api.Value(1);
        },
      });
    if (kind === "readonly") Object.defineProperty(list, "0", { writable: false });
    if (kind === "nonconfigurable") Object.defineProperty(list, "0", { configurable: false });
    if (kind === "nonenumerable") Object.defineProperty(list, "0", { enumerable: false });
    if (kind === "named") Object.defineProperty(list, "extra", { value: 1 });
    if (kind === "symbol") Object.defineProperty(list, Symbol(), { value: 1 });
    if (kind === "readonly-length") Object.defineProperty(list, "length", { writable: false });
    if (kind === "sealed") Object.seal(list);
    if (kind === "prototype") Object.setPrototypeOf(list, {});
    expect(() => api.createStateCheckpoint({ nativeLists: [list] })).toThrow(
      /Checkpoint requires .*native list/,
    );
    expect(reads).toBe(0);
    const next = api.createStateCheckpoint();
    next.release();
  });
});

it.each(["accessor", "readonly-length", "sealed"])(
  "preflights all selected lists before restoring guest or list storage: %s",
  async (kind) => {
    await withAbstractFixture(({ api, realm }) => {
      const first = [api.Value(1)],
        second = [api.Value(2)];
      const saved = api.createStateCheckpoint({
        objects: [realm.GlobalObject],
        nativeLists: [first, second],
      });
      let reads = 0;
      try {
        first.push(api.Value(3));
        api.X(api.CreateDataPropertyOrThrow(realm.GlobalObject, "branchOnly", api.Value.true));
        if (kind === "accessor")
          Object.defineProperty(second, "0", {
            get: () => {
              reads++;
              return api.Value(9);
            },
          });
        if (kind === "readonly-length")
          Object.defineProperty(second, "length", { writable: false });
        if (kind === "sealed") Object.seal(second);
        expect(() => saved.restore()).toThrow(/Checkpoint requires .*native list/);
        expect(reads).toBe(0);
        expect(first).toEqual([api.Value(1), api.Value(3)]);
        expect(realm.GlobalObject.properties.has("branchOnly")).toBe(true);
      } finally {
        saved.release();
      }
    });
  },
);

it("roots live and saved elements until release, not arbitrary native record contents", async () => {
  await withAbstractFixture(({ api, agent, realm, evaluate }) => {
    evaluate(
      "var target = {}, other = {}, hidden = {}; var firstWeak = new WeakRef(target), secondWeak = new WeakRef(other), hiddenWeak = new WeakRef(hidden);",
    );
    const original = realm.GlobalObject.properties.get("target")?.Value;
    const other = realm.GlobalObject.properties.get("other")?.Value;
    const hidden = realm.GlobalObject.properties.get("hidden")?.Value;
    if (
      !(original instanceof api.ObjectValue) ||
      !(other instanceof api.ObjectValue) ||
      !(hidden instanceof api.ObjectValue)
    )
      throw Error("Expected targets");
    const list = [original, { hidden }];
    const saved = api.createStateCheckpoint({ nativeLists: [list] });
    evaluate("target = other = hidden = null;");
    list.splice(0, 2, other);
    const observe = () => {
      agent.AgentRecord.KeptAlive.clear();
      api.gc();
      const completion = evaluate(
        "JSON.stringify([firstWeak.deref() !== undefined, secondWeak.deref() !== undefined, hiddenWeak.deref() !== undefined])",
      );
      if (!(completion.Value instanceof api.JSStringValue)) throw Error("Expected string");
      return completion.Value.stringValue();
    };
    try {
      expect(observe()).toBe("[true,true,false]");
      saved.restore();
      expect(list[0]).toBe(original);
      expect(observe()).toBe("[true,false,false]");
    } finally {
      saved.release();
    }
    expect(observe()).toBe("[false,false,false]");
  });
});

it("preserves shared Agent/LIFO guards and rejects preview capture and restore", async () => {
  await withAbstractFixture(({ api, agent }) => {
    const list = [1];
    agent.debugger_scopePreview(() =>
      expect(() => api.createStateCheckpoint({ nativeLists: [list] })).toThrow(
        "Native list checkpoints do not support debugger preview",
      ),
    );
    const outer = api.createStateCheckpoint({ nativeLists: [list] });
    list.push(2);
    const inner = api.createStateCheckpoint({ nativeLists: [list] });
    try {
      expect(() => outer.restore()).toThrow("last-in-first-out");
      expect(() => outer.release()).toThrow("last-in-first-out");
      api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
      expect(() => inner.restore()).toThrow("belongs to another agent");
      expect(() => inner.release()).toThrow("belongs to another agent");
      api.setSurroundingAgent(agent);
      agent.debugger_scopePreview(() =>
        expect(() => inner.restore()).toThrow(
          "Native list checkpoints do not support debugger preview",
        ),
      );
      list.length = 0;
      inner.restore();
      expect(list).toEqual([1, 2]);
    } finally {
      api.setSurroundingAgent(agent);
      inner.release();
    }
    try {
      outer.restore();
      expect(list).toEqual([1]);
    } finally {
      outer.release();
    }
  });
});

it.each([{}, new Uint8Array(1)])("rejects non-array native storage", async (value) => {
  await withAbstractFixture(({ api }) => {
    expect(() =>
      Reflect.apply(api.createStateCheckpoint, undefined, [{ nativeLists: [value] }]),
    ).toThrow("Checkpoint requires canonical native lists");
  });
});

it("does not restore unselected nested lists or callback state", async () => {
  await withAbstractFixture(({ api }) => {
    const nested = [1];
    let calls = 0;
    const callback = () => ++calls;
    const outer = [nested, callback];
    const saved = api.createStateCheckpoint({ nativeLists: [outer] });
    try {
      nested.push(2);
      expect(callback()).toBe(1);
      outer.length = 0;
      saved.restore();
      expect(outer).toEqual([nested, callback]);
      expect(nested).toEqual([1, 2]);
      expect(callback()).toBe(2);
    } finally {
      saved.release();
    }
  });
});

it.each(["object", "environment"])(
  "rejects direct foreign guest %s elements at capture and restore",
  async (kind) => {
    await withAbstractFixture(({ api, agent }) => {
      api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
      let foreign;
      try {
        const realm = new api.ManagedRealm();
        foreign = kind === "object" ? realm.GlobalObject : realm.GlobalEnv;
      } finally {
        api.setSurroundingAgent(agent);
      }
      const list: unknown[] = [];
      const saved = api.createStateCheckpoint({ nativeLists: [list] });
      list.push(foreign);
      try {
        expect(() => saved.restore()).toThrow(
          "Checkpoint native list values must belong to the current agent",
        );
      } finally {
        saved.release();
      }
      expect(() => api.createStateCheckpoint({ nativeLists: [list] })).toThrow(
        "Checkpoint native list values must belong to the current agent",
      );
    });
  },
);
