import { expect, it } from "vite-plus/test";
import type { IteratorRecord } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";

it.each([false, true])("restores only Done in the original record: saved=%s", async (done) => {
  await withAbstractFixture(({ api }) => {
    const iterator = api.OrdinaryObjectCreate(api.Value.null);
    const record: IteratorRecord = {
      Iterator: iterator,
      NextMethod: api.Value.undefined,
      Done: done,
    };
    const aliases = [record, record];
    const selections = [record, record];
    const saved = api.createStateCheckpoint({ iteratorRecords: selections });
    try {
      expect(saved.iteratorRecordCount).toBe(1);
      expect(saved.objectCount).toBe(0);
      selections.length = 0;
      record.Done = !done;
      api.X(api.CreateDataPropertyOrThrow(iterator, "unselected", api.Value.true));
      saved.restore();
      expect(record.Done).toBe(done);
      expect(aliases[0]).toBe(aliases[1]);
      expect(record.Iterator).toBe(iterator);
      expect(record.NextMethod).toBe(api.Value.undefined);
      expect(iterator.properties.has("unselected")).toBe(true);
      record.Done = !done;
      saved.restore();
      expect(record.Done).toBe(done);
    } finally {
      saved.release();
    }
    expect(() => saved.restore()).toThrow("released");
  });
});

it.each(["Iterator", "NextMethod", "Done"])(
  "preflights changed %s before any writes",
  async (field) => {
    await withAbstractFixture(({ api, realm }) => {
      const record: IteratorRecord = {
        Iterator: realm.GlobalObject,
        NextMethod: api.Value.undefined,
        Done: false,
      };
      const saved = api.createStateCheckpoint({
        objects: [realm.GlobalObject],
        iteratorRecords: [record],
      });
      try {
        record.Done = true;
        Object.defineProperty(record, field, {
          value:
            field === "Iterator"
              ? api.OrdinaryObjectCreate(api.Value.null)
              : field === "NextMethod"
                ? realm.GlobalObject
                : "invalid",
        });
        api.X(api.CreateDataPropertyOrThrow(realm.GlobalObject, "branchOnly", api.Value.true));
        expect(() => saved.restore()).toThrow(
          field === "Done" ? "valid iterator fields" : "iterator metadata changed",
        );
        expect(realm.GlobalObject.properties.has("branchOnly")).toBe(true);
      } finally {
        saved.release();
      }
    });
  },
);

it.each(["accessor", "frozen", "sealed", "prototype", "extra", "symbol", "flags", "missing"])(
  "rejects noncanonical iterator layouts without reading getters: %s",
  async (kind) => {
    await withAbstractFixture(({ api, realm }) => {
      const record: IteratorRecord = {
        Iterator: realm.GlobalObject,
        NextMethod: api.Value.undefined,
        Done: false,
      };
      let reads = 0;
      if (kind === "accessor")
        Object.defineProperty(record, "Done", {
          get: () => {
            reads++;
            return false;
          },
        });
      if (kind === "frozen") Object.freeze(record);
      if (kind === "sealed") Object.seal(record);
      if (kind === "prototype") Object.setPrototypeOf(record, null);
      if (kind === "extra") Object.defineProperty(record, "extra", { value: true });
      if (kind === "symbol") Object.defineProperty(record, Symbol(), { value: true });
      if (kind === "flags") Object.defineProperty(record, "Done", { enumerable: false });
      if (kind === "missing") Reflect.deleteProperty(record, "Done");
      expect(() => api.createStateCheckpoint({ iteratorRecords: [record] })).toThrow(
        "canonical iterator records",
      );
      expect(reads).toBe(0);
      const next = api.createStateCheckpoint();
      next.restore();
      next.release();
    });
  },
);

it.each(["Iterator", "NextMethod", "Done"])(
  "rejects invalid %s values on capture",
  async (field) => {
    await withAbstractFixture(({ api, realm }) => {
      const record: IteratorRecord = {
        Iterator: realm.GlobalObject,
        NextMethod: api.Value.undefined,
        Done: false,
      };
      Object.defineProperty(record, field, {
        value:
          field === "Iterator"
            ? api.Value.null
            : field === "NextMethod"
              ? undefined
              : api.Value.false,
      });
      expect(() => api.createStateCheckpoint({ iteratorRecords: [record] })).toThrow(
        "valid iterator fields",
      );
    });
  },
);

it.each(["Iterator", "NextMethod"])("rejects a foreign guest %s", async (field) => {
  let foreign: IteratorRecord["Iterator"] | undefined;
  await withAbstractFixture(({ api }) => {
    foreign = api.OrdinaryObjectCreate(api.Value.null);
  });
  await withAbstractFixture(({ api, realm }) => {
    const record: IteratorRecord = {
      Iterator: realm.GlobalObject,
      NextMethod: api.Value.undefined,
      Done: false,
    };
    Object.defineProperty(record, field, { value: foreign });
    expect(() => api.createStateCheckpoint({ iteratorRecords: [record] })).toThrow(
      "iterator values must belong to the current agent",
    );
  });
});

it("uses Agent/LIFO lifecycle checks and rejects debugger preview", async () => {
  await withAbstractFixture(({ api, agent, realm }) => {
    const record: IteratorRecord = {
      Iterator: realm.GlobalObject,
      NextMethod: api.Value.undefined,
      Done: false,
    };
    agent.debugger_scopePreview(() => {
      expect(() => api.createStateCheckpoint({ iteratorRecords: [record] })).toThrow(
        "Iterator checkpoints do not support debugger preview",
      );
    });
    const outer = api.createStateCheckpoint({ iteratorRecords: [record] });
    const inner = api.createStateCheckpoint({ iteratorRecords: [record] });
    try {
      expect(() => outer.restore()).toThrow("last-in-first-out");
      expect(() => outer.release()).toThrow("last-in-first-out");
      api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
      try {
        expect(() => inner.restore()).toThrow("another agent");
        expect(() => inner.release()).toThrow("another agent");
      } finally {
        api.setSurroundingAgent(agent);
      }
      agent.debugger_scopePreview(() => {
        expect(() => inner.restore()).toThrow(
          "Iterator checkpoints do not support debugger preview",
        );
      });
    } finally {
      inner.release();
      outer.release();
    }
  });
});

it("roots saved and current iterator edges until release without invoking next", async () => {
  await withAbstractFixture(({ api, agent, realm, evaluate }) => {
    evaluate(
      'var first = {}, second = function() { throw "must not run"; }, third = {}, fourth = function() {}; var weak = [first, second, third, fourth].map(value => new WeakRef(value));',
    );
    const iterator = realm.GlobalObject.properties.get("first")?.Value;
    const nextMethod = realm.GlobalObject.properties.get("second")?.Value;
    const replacementIterator = realm.GlobalObject.properties.get("third")?.Value;
    const replacementNext = realm.GlobalObject.properties.get("fourth")?.Value;
    if (!(iterator instanceof api.ObjectValue) || !(nextMethod instanceof api.ObjectValue))
      throw Error("Expected iterator edges");
    const record: IteratorRecord = { Iterator: iterator, NextMethod: nextMethod, Done: false };
    const saved = api.createStateCheckpoint({ iteratorRecords: [record] });
    try {
      Object.defineProperty(record, "Iterator", { value: replacementIterator });
      Object.defineProperty(record, "NextMethod", { value: replacementNext });
      evaluate("first = second = third = fourth = null;");
      agent.AgentRecord.KeptAlive.clear();
      api.gc();
      expect(evaluate("weak.every(value => value.deref() !== undefined)").Value).toBe(
        api.Value.true,
      );
      expect(() => saved.restore()).toThrow("iterator metadata changed");
    } finally {
      saved.release();
    }
    agent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(evaluate("weak.every(value => value.deref() === undefined)").Value).toBe(api.Value.true);
  });
});
