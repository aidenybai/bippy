import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { ReferenceRecord, StateCheckpoint } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";

const programs = [
  {
    name: "assignment",
    body: `object[key] = enabled ? (choice = "left", 11) : (choice = "right", 22);`,
  },
  {
    name: "destructuring default",
    body: `({ value: object[key] = enabled ? (choice = "left", 11) : (choice = "right", 22) } = {});`,
  },
  {
    name: "super assignment",
    body: `
    Object.setPrototypeOf(object, {});
    Object.assign(object, { write() { super[key] = enabled ? (choice = "left", 11) : (choice = "right", 22); } });
    object.write();
  `,
  },
  {
    name: "symbol key",
    body: `
    var leftSymbol = Symbol("left"), rightSymbol = Symbol("right");
    key.toString = undefined;
    key[Symbol.toPrimitive] = () => { hits++; return choice === "left" ? leftSymbol : rightSymbol; };
    object[key] = enabled ? (choice = "left", 11) : (choice = "right", 22);
    object.symbols = Object.getOwnPropertySymbols(object).map(symbol => [symbol.description, object[symbol]]);
  `,
  },
];

it.each(
  programs.flatMap((program) => [false, true].map((isReversed) => ({ ...program, isReversed }))),
)("rewinds cached reference keys: $name reversed=$isReversed", async ({ body, isReversed }) => {
  const source = `
    var prefix = 0, hits = 0, choice = "base", object = {};
    var key = { toString() { hits++; return choice; } };
    prefix++;
    ${body}
    JSON.stringify([object, hits, prefix]);
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
    const object = realm.GlobalObject.properties.get("object")?.Value;
    const key = realm.GlobalObject.properties.get("key")?.Value;
    if (!(object instanceof api.ObjectValue) || !(key instanceof api.ObjectValue))
      throw Error("Expected objects");
    const references = new Set<ReferenceRecord>();
    const contexts = [...agent.executionContextStack];
    let storage: StateCheckpoint | undefined;
    const saved = agent.captureEvaluation({
      references: (value) => {
        if (value instanceof api.ReferenceRecord) references.add(value);
        return [];
      },
      capture: () => {
        expect([...references].some((reference) => reference.ReferencedName === key)).toBe(true);
        const state = api.createStateCheckpoint({
          objects: [realm.GlobalObject, object, key],
          environments: [realm.GlobalEnv],
          referenceRecords: [...references],
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
      expect(storage?.referenceRecordCount).toBe(references.size);
    } finally {
      saved.release();
      storage?.release();
    }
  });
});

it("preserves reference identity, deduplicates selections, and leaves unselected referents alone", async () => {
  await withAbstractFixture(({ api, realm, evaluate }) => {
    evaluate("var base = { value: 1 };");
    const base = realm.GlobalObject.properties.get("base")?.Value;
    if (!(base instanceof api.ObjectValue)) throw Error("Expected object");
    const original = api.Value("value");
    const reference = new api.ReferenceRecord({
      Base: base,
      ReferencedName: original,
      Strict: true,
      ThisValue: base,
    });
    const aliases = [reference, reference];
    const selected = [reference, reference];
    const saved = api.createStateCheckpoint({ referenceRecords: selected });
    try {
      expect(saved.referenceRecordCount).toBe(1);
      expect(saved.objectCount).toBe(0);
      selected.length = 0;
      reference.ReferencedName = api.Value("other");
      evaluate("base.value = 2;");
      saved.restore();
      expect(aliases[0]).toBe(aliases[1]);
      expect(reference.ReferencedName).toBe(original);
      expect(reference.Base).toBe(base);
      expect(reference.ThisValue).toBe(base);
      expect(evaluate("base.value").Value).toEqual(api.Value(2));
    } finally {
      saved.release();
    }
    expect(() => saved.restore()).toThrow("Object checkpoint is released");
  });
});

it.each(["Base", "Strict", "ThisValue"])(
  "preflights immutable reference field %s before any restoration",
  async (field) => {
    await withAbstractFixture(({ api, realm }) => {
      const reference = new api.ReferenceRecord({
        Base: "unresolvable",
        ReferencedName: api.Value.undefined,
        Strict: true,
        ThisValue: undefined,
      });
      const saved = api.createStateCheckpoint({
        referenceRecords: [reference],
        objects: [realm.GlobalObject],
      });
      try {
        const changed = api.Value("changed");
        reference.ReferencedName = changed;
        Object.defineProperty(reference, field, {
          value: field === "Strict" ? false : realm.GlobalObject,
        });
        api.X(api.CreateDataPropertyOrThrow(realm.GlobalObject, "branchOnly", api.Value.true));
        expect(() => saved.restore()).toThrow("Checkpoint reference metadata changed");
        expect(reference.ReferencedName).toBe(changed);
        expect(realm.GlobalObject.properties.has("branchOnly")).toBe(true);
      } finally {
        saved.release();
      }
    });
  },
);

it.each(["getter", "frozen", "prototype", "extra"])(
  "rejects noncanonical reference storage: %s",
  async (kind) => {
    await withAbstractFixture(({ api }) => {
      const reference = new api.ReferenceRecord({
        Base: "unresolvable",
        ReferencedName: api.Value.undefined,
        Strict: false,
        ThisValue: undefined,
      });
      let reads = 0;
      if (kind === "getter")
        Object.defineProperty(reference, "ReferencedName", {
          get: () => {
            reads++;
            return api.Value.undefined;
          },
        });
      if (kind === "frozen") Object.freeze(reference);
      if (kind === "prototype") Object.setPrototypeOf(reference, {});
      if (kind === "extra") Object.defineProperty(reference, "extra", { value: true });
      expect(() => api.createStateCheckpoint({ referenceRecords: [reference] })).toThrow(
        "Checkpoint requires canonical reference records",
      );
      expect(reads).toBe(0);
      const next = api.createStateCheckpoint();
      next.release();
    });
  },
);

it.each(["Base", "ReferencedName", "Strict", "ThisValue"])(
  "rejects invalid reference field %s",
  async (field) => {
    await withAbstractFixture(({ api }) => {
      const reference = new api.ReferenceRecord({
        Base: "unresolvable",
        ReferencedName: api.Value.undefined,
        Strict: false,
        ThisValue: undefined,
      });
      Object.defineProperty(reference, field, { value: {} });
      expect(() => api.createStateCheckpoint({ referenceRecords: [reference] })).toThrow(
        "Checkpoint requires valid reference fields",
      );
    });
  },
);

it("restores private-name identity and accepts same-Agent environment bases without owning their bindings", async () => {
  await withAbstractFixture(({ api, realm, evaluate }) => {
    const name = new api.PrivateName("selected");
    const reference = new api.ReferenceRecord({
      Base: realm.GlobalEnv,
      ReferencedName: name,
      Strict: true,
      ThisValue: undefined,
    });
    const saved = api.createStateCheckpoint({ referenceRecords: [reference] });
    try {
      reference.ReferencedName = api.Value.true;
      evaluate("let branchBinding = 19;");
      saved.restore();
      expect(reference.ReferencedName).toBe(name);
      expect(evaluate("branchBinding").Value).toEqual(api.Value(19));
      expect(saved.environmentCount).toBe(0);
    } finally {
      saved.release();
    }
  });
});

it("rejects foreign environment bases", async () => {
  await withAbstractFixture(({ api, agent }) => {
    api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
    let environment;
    try {
      environment = new api.ManagedRealm().GlobalEnv;
    } finally {
      api.setSurroundingAgent(agent);
    }
    const reference = new api.ReferenceRecord({
      Base: environment,
      ReferencedName: api.Value("binding"),
      Strict: true,
      ThisValue: undefined,
    });
    expect(() => api.createStateCheckpoint({ referenceRecords: [reference] })).toThrow(
      "Checkpoint reference values must belong to the current agent",
    );
  });
});

it("rejects changed native layout before restoring selected storage", async () => {
  await withAbstractFixture(({ api, realm }) => {
    const reference = new api.ReferenceRecord({
      Base: "unresolvable",
      ReferencedName: api.Value.undefined,
      Strict: true,
      ThisValue: undefined,
    });
    const saved = api.createStateCheckpoint({
      referenceRecords: [reference],
      objects: [realm.GlobalObject],
    });
    let reads = 0;
    try {
      Object.defineProperty(reference, "ReferencedName", {
        get: () => {
          reads++;
          return api.Value.true;
        },
      });
      api.X(api.CreateDataPropertyOrThrow(realm.GlobalObject, "branchOnly", api.Value.true));
      expect(() => saved.restore()).toThrow("Checkpoint requires canonical reference records");
      expect(reads).toBe(0);
      expect(realm.GlobalObject.properties.has("branchOnly")).toBe(true);
    } finally {
      saved.release();
    }
  });
});

it("uses the existing Agent/LIFO stack and rejects preview capture and restore", async () => {
  await withAbstractFixture(({ api, agent }) => {
    const reference = new api.ReferenceRecord({
      Base: "unresolvable",
      ReferencedName: api.Value.undefined,
      Strict: false,
      ThisValue: undefined,
    });
    agent.debugger_scopePreview(() => {
      expect(() => api.createStateCheckpoint({ referenceRecords: [reference] })).toThrow(
        "Reference checkpoints do not support debugger preview",
      );
    });
    const outer = api.createStateCheckpoint({ referenceRecords: [reference] });
    reference.ReferencedName = api.Value.true;
    const inner = api.createStateCheckpoint({ referenceRecords: [reference] });
    try {
      expect(() => outer.restore()).toThrow("last-in-first-out");
      expect(() => outer.release()).toThrow("last-in-first-out");
      api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
      expect(() => inner.restore()).toThrow("belongs to another agent");
      expect(() => inner.release()).toThrow("belongs to another agent");
      api.setSurroundingAgent(agent);
      agent.debugger_scopePreview(() => {
        expect(() => inner.restore()).toThrow(
          "Reference checkpoints do not support debugger preview",
        );
      });
      reference.ReferencedName = api.Value.false;
      inner.restore();
      expect(reference.ReferencedName).toBe(api.Value.true);
    } finally {
      api.setSurroundingAgent(agent);
      inner.release();
    }
    try {
      outer.restore();
      expect(reference.ReferencedName).toBe(api.Value.undefined);
    } finally {
      outer.release();
    }
  });
});

it.each(["Base", "ReferencedName", "ThisValue"])(
  "rejects foreign guest references in %s at capture and restore",
  async (field) => {
    await withAbstractFixture(({ api, agent, realm }) => {
      const reference = new api.ReferenceRecord({
        Base: realm.GlobalObject,
        ReferencedName: api.Value.undefined,
        Strict: false,
        ThisValue: undefined,
      });
      const saved = api.createStateCheckpoint({ referenceRecords: [reference] });
      let foreign;
      api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
      try {
        foreign = new api.ManagedRealm().GlobalObject;
      } finally {
        api.setSurroundingAgent(agent);
      }
      Object.defineProperty(reference, field, { value: foreign });
      try {
        expect(() => saved.restore()).toThrow(
          "Checkpoint reference values must belong to the current agent",
        );
      } finally {
        saved.release();
      }
      expect(() => api.createStateCheckpoint({ referenceRecords: [reference] })).toThrow(
        "Checkpoint reference values must belong to the current agent",
      );
    });
  },
);

it("roots both saved and live reference fields until release without rooting the caller's local", async () => {
  await withAbstractFixture(({ api, agent, realm, evaluate }) => {
    evaluate(
      "var target = {}, other = {}; var savedWeak = new WeakRef(target), liveWeak = new WeakRef(other);",
    );
    const original = realm.GlobalObject.properties.get("target")?.Value;
    const other = realm.GlobalObject.properties.get("other")?.Value;
    if (!(original instanceof api.ObjectValue) || !(other instanceof api.ObjectValue))
      throw Error("Expected targets");
    const reference = new api.ReferenceRecord({
      Base: "unresolvable",
      ReferencedName: original,
      Strict: false,
      ThisValue: undefined,
    });
    const saved = api.createStateCheckpoint({ referenceRecords: [reference] });
    evaluate("target = other = null;");
    reference.ReferencedName = other;
    const observe = () => {
      agent.AgentRecord.KeptAlive.clear();
      api.gc();
      const completion = evaluate(
        "JSON.stringify([savedWeak.deref() !== undefined, liveWeak.deref() !== undefined])",
      );
      if (!(completion.Value instanceof api.JSStringValue)) throw Error("Expected string");
      return completion.Value.stringValue();
    };
    try {
      expect(observe()).toBe("[true,true]");
      saved.restore();
      expect(reference.ReferencedName).toBe(original);
      expect(observe()).toBe("[true,false]");
    } finally {
      saved.release();
    }
    expect(observe()).toBe("[false,false]");
  });
});
