import { expect, it } from "vite-plus/test";
import type { Value } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";

it.each(["default", "named", "async", "frozen"])(
  "exposes the original from target without changing the bound adapter (%s)",
  async (mode) => {
    await withAbstractFixture(({ api }) => {
      let calls = 0;
      const steps = (value: Value = api.Value.undefined) => {
        calls++;
        return value;
      };
      if (mode === "frozen") Object.freeze(steps);
      const builtin =
        mode === "default"
          ? api.CreateBuiltinFunction.from(steps)
          : api.CreateBuiltinFunction.from(steps, "custom", mode === "async");
      const adapter = builtin.nativeFunction;
      const expected = Reflect.apply.bind(null, steps, null);
      const captures = api.getNativeCaptures(adapter);
      expect(captures?.ambientNames).toEqual([]);
      expect(captures?.bindings.map((binding) => binding.name)).toEqual(["steps"]);
      const binding = captures?.bindings[0];
      expect(binding?.get()).toBe(steps);
      expect(binding?.set).toBeUndefined();
      expect(api.getNativeCaptures(steps)).toBeUndefined();
      expect(Reflect.ownKeys(adapter)).toEqual(Reflect.ownKeys(expected));
      expect(Object.getOwnPropertyDescriptors(adapter)).toEqual(
        Object.getOwnPropertyDescriptors(expected),
      );
      expect(Object.getPrototypeOf(adapter)).toBe(Object.getPrototypeOf(expected));
      expect(Function.prototype.toString.call(adapter)).toBe(
        Function.prototype.toString.call(expected),
      );
      expect(() => Reflect.construct(adapter, [])).toThrow(TypeError);
      expect(calls).toBe(0);
      const value = api.Value(7);
      expect(Reflect.apply(adapter, {}, [[value], undefined])).toBe(value);
      expect(calls).toBe(1);
      expect(builtin.Async).toBe(mode === "async");
    });
  },
);

it.each([false, true])("marks builtin behaviour without calling it, from=%s", async (from) => {
  await withAbstractFixture(({ api }) => {
    let calls = 0;
    const steps = () => {
      calls++;
      return api.Value.undefined;
    };
    const builtin = from
      ? api.CreateBuiltinFunction.from(steps)
      : api.CreateBuiltinFunction(steps, 0, "direct", []);
    const references: unknown[] = [];
    builtin.mark((value) => references.push(value));
    expect(references).toContain(builtin.nativeFunction);
    expect(calls).toBe(0);
    expect(builtin.nativeFunction).toBe(
      from ? references.find((value) => typeof value === "function") : steps,
    );
  });
});

it.each([false, true])(
  "lets a controlled owner reject an unregistered callback before branching, from=%s",
  async (from) => {
    await withAbstractFixture(({ api, agent, realm, compile, createBoolean }) => {
      let calls = 0;
      const steps = () => {
        calls++;
        return api.Value(12);
      };
      const builtin = from
        ? api.CreateBuiltinFunction.from(steps)
        : api.CreateBuiltinFunction(steps, 0, "direct", []);
      api.X(api.CreateDataPropertyOrThrow(realm.GlobalObject, "host", builtin));
      createBoolean("enabled");
      agent.evaluate(compile("if (enabled) host();"), () => {}, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true });
      if (pause.done || !pause.value) throw Error("Expected decision");
      const rejection = Error("Unregistered callback state");
      let isSeeded = false;
      let isCaptured = false;
      expect(() =>
        agent.captureEvaluation({
          references: (value) => {
            if (!isSeeded) {
              isSeeded = true;
              return [builtin];
            }
            if (value === steps) throw rejection;
            if (value === builtin) {
              const references: unknown[] = [];
              builtin.mark((reference) => references.push(reference));
              return references;
            }
            return [];
          },
          capture: () => {
            isCaptured = true;
            return { restore: () => {} };
          },
        }),
      ).toThrow(rejection);
      expect(isCaptured).toBe(false);
      expect(calls).toBe(0);
      expect(agent.resumeEvaluate({ pauseOnAbstractBoolean: true }).value).toBe(pause.value);
      expect(
        agent.resumeEvaluate({
          abstractBooleanDecision: {
            resume: "abstract-boolean",
            decision: pause.value,
            value: true,
          },
        }).done,
      ).toBe(true);
      expect(calls).toBe(1);
    });
  },
);

it("keeps exception identity, default naming, and argument order through the adapter", async () => {
  await withAbstractFixture(({ api }) => {
    const failure = Error("target failure");
    const received: unknown[][] = [];
    const steps = (...values: unknown[]) => {
      received.push(values);
      throw failure;
    };
    const builtin = api.CreateBuiltinFunction.from(steps);
    const values = [api.Value(1), api.Value(2)];
    let caught: unknown;
    try {
      Reflect.apply(builtin.nativeFunction, null, [values, undefined]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
    expect(received).toEqual([values]);
    expect(builtin.properties.get("name")?.Value).toEqual(api.Value("steps"));
    expect(api.getNativeCaptures(builtin.nativeFunction)?.bindings[0]?.get()).toBe(steps);
  });
});

it("does not infer or rewind state inside an unregistered target", async () => {
  await withAbstractFixture(({ api }) => {
    let count = 0;
    const steps = () => api.Value(++count);
    const builtin = api.CreateBuiltinFunction.from(steps);
    const captures = api.getNativeCaptures(builtin.nativeFunction);
    expect(captures?.bindings[0]?.get()).toBe(steps);
    expect(api.getNativeCaptures(steps)).toBeUndefined();
    const saved = api.createStateCheckpoint({ objects: [builtin] });
    expect(Reflect.apply(builtin.nativeFunction, null, [[], undefined])).toEqual(api.Value(1));
    saved.restore();
    expect(Reflect.apply(builtin.nativeFunction, null, [[], undefined])).toEqual(api.Value(2));
    saved.release();
  });
});
