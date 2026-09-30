import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { SymbolicEngine } from "../src/symbolic/load-engine.js";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";
import { getNativeGcObservation } from "./helpers/native-gc.js";

const getCallable = (api: SymbolicEngine["api"]) => {
  const target = Object.getOwnPropertyDescriptor(api.Descriptor.prototype, "constructor")?.value;
  const callable = api
    .getNativeCaptures(target)
    ?.bindings.find((binding) => binding.name === "callable")
    ?.get();
  if (typeof callable !== "function") throw new Error("Missing original callable decorator");
  return (target: Function, onCalled?: Function): Function => {
    const decorate = Reflect.apply(callable, undefined, onCalled ? [onCalled] : []);
    const proxy = Reflect.apply(decorate, undefined, [target, undefined]);
    if (typeof proxy !== "function") throw new Error("Expected callable proxy");
    return proxy;
  };
};

it.each([
  "Value",
  "Descriptor",
  "Completion",
  "NormalCompletion",
  "ReturnCompletion",
  "ThrowCompletion",
])("exposes original callable %s target and frozen handler", async (name) => {
  await withAbstractFixture(({ api }) => {
    const proxy = Reflect.get(api, name);
    const target = proxy.prototype.constructor;
    const manifest = api.getNativeCaptures(proxy);
    expect(manifest?.ambientNames).toEqual(["[[CallableProxyState]]"]);
    expect(manifest?.bindings.map((binding) => binding.name)).toEqual([
      "target",
      "handler",
      "onCalled",
    ]);
    expect(manifest?.bindings[0].get()).toBe(target);
    const handler = manifest?.bindings[1].get();
    if (!handler || typeof handler !== "object") throw Error("Expected handler");
    expect(Object.isFrozen(handler)).toBe(true);
    expect(Object.getPrototypeOf(handler)).toBe(null);
    expect(Reflect.ownKeys(handler)).toEqual(["apply"]);
    expect(Reflect.get(handler, "apply")).toBe(manifest?.bindings[2].get());
    expect(manifest?.bindings.every((binding) => binding.set === undefined)).toBe(true);
  });
});

it.each([false, true])(
  "preserves call, construct, receiver, reflection and failure identity, custom=%s",
  async (custom) => {
    await withAbstractFixture(({ api }) => {
      const calls: unknown[] = [];
      const failure = new Error("original failure");
      class Target {
        value: unknown;
        constructor(value: unknown) {
          calls.push(new.target);
          this.value = value;
        }
      }
      const onCalled = (target: Function, receiver: unknown, values: unknown[]) => {
        calls.push(receiver);
        if (values[0] === failure) throw failure;
        return Reflect.construct(target, values);
      };
      const proxy = getCallable(api)(Target, custom ? onCalled : undefined);
      const descriptors = Object.getOwnPropertyDescriptors(Target);
      const manifest = api.getNativeCaptures(proxy);
      expect(manifest?.bindings[0].get()).toBe(Target);
      expect(calls).toEqual([]);
      expect(Object.getOwnPropertyDescriptors(proxy)).toEqual(descriptors);
      expect(Object.getPrototypeOf(proxy)).toBe(Object.getPrototypeOf(Target));
      expect(proxy.prototype).toBe(Target.prototype);
      const receiver = {};
      expect(Reflect.apply(proxy, receiver, [7]).value).toBe(7);
      expect(calls).toEqual(custom ? [receiver, Target] : [Target]);
      expect(Reflect.construct(proxy, [8]).value).toBe(8);
      expect(calls.at(-1)).toBe(proxy);
      if (custom) {
        let thrown: unknown;
        try {
          Reflect.apply(proxy, receiver, [failure]);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBe(failure);
      }
      Object.freeze(Target);
      expect(Object.isFrozen(proxy)).toBe(true);
      expect(api.getNativeCaptures(proxy)?.bindings[0].get()).toBe(Target);
    });
  },
);

it.each([false, true].flatMap((first) => [false, true].map((trap) => ({ first, trap }))))(
  "restores a cell reached only through the callable proxy, first=$first trap=$trap",
  async ({ first, trap }) => {
    await withAbstractFixture(({ api, agent, realm, compile, createBoolean }) => {
      let count = 0;
      let prefixes = 0;
      class Target {
        value: number;
        constructor(delta: number) {
          this.value = delta;
        }
      }
      class CountingTarget {
        value: number;
        constructor(delta: number) {
          this.value = count += delta;
        }
      }
      const onCalled = (_target: unknown, _receiver: unknown, values: number[]) => ({
        value: (count += values[0]),
      });
      const bindings = [
        {
          name: "count",
          get: () => count,
          set: (value: unknown) => {
            if (typeof value !== "number") throw Error("Expected count");
            count = value;
          },
        },
      ];
      api.registerNativeClosure(Target, () => ({ bindings: [], ambientNames: ["[[ClassState]]"] }));
      api.registerNativeClosure(CountingTarget, () => ({
        bindings,
        ambientNames: ["[[ClassState]]"],
      }));
      api.registerNativeClosure(onCalled, () => ({ bindings, ambientNames: [] }));
      const proxy = getCallable(api)(trap ? Target : CountingTarget, trap ? onCalled : undefined);
      const steps = api.registerNativeClosure(
        (delta: unknown) => {
          if (!(delta instanceof api.NumberValue)) throw Error("Expected delta");
          return api.Value(Reflect.apply(proxy, undefined, [delta.numberValue()]).value);
        },
        () => ({
          bindings: [
            { name: "proxy", get: () => proxy },
            { name: "api", get: () => api },
          ],
          ambientNames: [],
        }),
      );
      const builtin = api.CreateBuiltinFunction.from(steps);
      api.X(api.CreateDataPropertyOrThrow(realm.GlobalObject, "host", builtin));
      createBoolean("enabled");
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.type === "UnaryExpression" && node.sourceText === "void 1") prefixes++;
      };
      agent.evaluate(compile("void 1; if (enabled) host(1); else host(10);"), () => {}, false);
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true });
      if (pause.done || !pause.value) throw Error("Expected decision");
      const contexts = [...agent.executionContextStack];
      let seeded = false;
      const saved = agent.captureEvaluation({
        references: () => {
          if (seeded) return [];
          seeded = true;
          return [builtin.nativeFunction];
        },
        capture: () => ({
          restore: () => {
            agent.executionContextStack.splice(0, agent.executionContextStack.length, ...contexts);
          },
        }),
      });
      try {
        for (const choice of [first, !first]) {
          saved.restore();
          const result = agent.resumeEvaluate({
            abstractBooleanDecision: {
              resume: "abstract-boolean",
              decision: pause.value,
              value: choice,
            },
            noBreakpoint: true,
          });
          expect(result.done).toBe(true);
          const completion = api.EnsureCompletion(result.value);
          if (!(completion.Value instanceof api.NumberValue)) throw Error("Expected result");
          const native = runInNewContext(
            `let count=0; class Target {constructor(delta){this.value=${trap ? "delta" : "count+=delta"};}}; new Proxy(Target,{apply(target,receiver,args){return ${trap ? "{value:count+=args[0]}" : "Reflect.construct(target,args)"};}})(${choice ? 1 : 10}).value`,
          );
          expect(completion.Value.numberValue()).toBe(native);
        }
        expect(prefixes).toBe(1);
      } finally {
        saved.release();
      }
    });
  },
);

it.each([false, true].flatMap((trap) => [false, true].map((symbol) => ({ trap, symbol }))))(
  "retains declared callable roots without invocation and drops removed roots, trap=$trap symbol=$symbol",
  async ({ trap, symbol }) => {
    const expression = symbol ? "Symbol('held')" : "{}";
    expect(
      getNativeGcObservation(
        `
    var reference;
    globalThis.retained = (() => {
      const held = ${expression}; reference = new WeakRef(held);
      class Target {}
      class RetainingTarget {value = held;}
      return new Proxy(${trap ? "Target" : "RetainingTarget"}, {apply: ${trap ? "() => held" : "(target, receiver, args) => Reflect.construct(target, args)"}});
    })();
  `,
        "String(reference.deref() !== undefined)",
      ),
    ).toBe("true");
    await withAbstractFixture(({ api, agent, realm, evaluate }) => {
      const held = api.X(
        evaluate(`var held = ${expression}; var reference = new WeakRef(held); held;`),
      );
      let calls = 0;
      class Target {}
      class RetainingTarget {
        value = held;
      }
      const onCalled = () => {
        calls++;
        return held;
      };
      api.registerNativeClosure(RetainingTarget, () => ({
        bindings: [{ name: "held", get: () => held }],
        ambientNames: ["[[ClassState]]"],
      }));
      api.registerNativeClosure(onCalled, () => ({
        bindings: [
          { name: "held", get: () => held },
          {
            name: "calls",
            get: () => calls,
            set: (value) => {
              if (typeof value !== "number") throw Error("Expected calls");
              calls = value;
            },
          },
        ],
        ambientNames: [],
      }));
      const proxy = getCallable(api)(trap ? Target : RetainingTarget, trap ? onCalled : undefined);
      const steps = api.registerNativeClosure(
        () => {
          void proxy;
          return api.Value.undefined;
        },
        () => ({
          bindings: [
            { name: "proxy", get: () => proxy },
            { name: "api", get: () => api },
          ],
          ambientNames: [],
        }),
      );
      api.X(
        api.CreateDataPropertyOrThrow(
          realm.GlobalObject,
          "retained",
          api.CreateBuiltinFunction(steps, 0, "retained", []),
        ),
      );
      api.X(evaluate("held = null;"));
      const collect = () => {
        agent.AgentRecord.KeptAlive.clear();
        api.gc();
        return api.X(evaluate("reference.deref() !== undefined"));
      };
      expect(collect()).toBe(api.Value.true);
      expect(calls).toBe(0);
      api.X(evaluate("retained = null;"));
      expect(collect()).toBe(api.Value.false);
      expect(calls).toBe(0);
    });
  },
);

it("does not register arbitrary foreign proxies or inspect their properties", async () => {
  await withAbstractFixture(({ api }) => {
    let calls = 0;
    const foreign = new Proxy(class {}, {
      get() {
        calls++;
        throw Error("Unexpected property access");
      },
    });
    expect(api.getNativeCaptures(foreign)).toBeUndefined();
    expect(calls).toBe(0);
  });
});
