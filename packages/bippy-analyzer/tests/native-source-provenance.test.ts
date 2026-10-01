import { expect, it } from "vite-plus/test";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";
import { evaluateLowered, evaluateNativeCaptures } from "./helpers/control-fixture.js";

it("identifies original engine classes and per-Agent closures without exposing the registrar", async () => {
  await withAbstractFixture(({ api, agent }) => {
    const sourceModule = "engine262/src/execution-context/Agent.mts";
    expect(api.getNativeSourceModule(api.Agent)).toBe(sourceModule);
    expect(api.getNativeSourceModule(agent.assertCanPerformHostEffect)).toBe(sourceModule);
    expect(Reflect.get(api, "registerEngineClosure")).toBeUndefined();
    expect(api.getNativeSourceModule(api.registerNativeClosure)).toBeUndefined();
    expect(api.getNativeSourceModule(api.getNativeSourceModule)).toBeUndefined();
  });
});

it("distinguishes guest function storage from its original native bound-call implementation", async () => {
  await withAbstractFixture(({ api, evaluate }) => {
    const completion = evaluate("(() => 7).bind(null)");
    if (!api.isBoundFunctionObject(completion.Value)) throw new Error("Expected bound function");
    expect(api.getNativeSourceModule(completion.Value)).toBeUndefined();
    expect(api.getNativeSourceModule(completion.Value.Call)).toBe(
      "engine262/src/intrinsics/FunctionPrototype.mts",
    );
    expect(evaluate("(() => 7).bind(null)()").Value).toEqual(api.Value(7));
  });
});

it("revokes source provenance when public registration replaces engine metadata", async () => {
  await withAbstractFixture(({ api, agent }) => {
    const closure = agent.assertCanPerformHostEffect;
    const keys = Reflect.ownKeys(closure);
    const prototype = Object.getPrototypeOf(closure);
    let reads = 0;
    expect(api.getNativeSourceModule(closure)).toBe("engine262/src/execution-context/Agent.mts");
    expect(
      api.registerNativeClosure(closure, () => {
        reads++;
        return { bindings: [], ambientNames: [] };
      }) === closure,
    ).toBe(true);
    expect(api.getNativeSourceModule(closure)).toBeUndefined();
    expect(reads).toBe(0);
    expect(api.getNativeCaptures(closure)).toEqual({ bindings: [], ambientNames: [] });
    expect(reads).toBe(1);
    expect(Reflect.ownKeys(closure)).toEqual(keys);
    expect(Object.getPrototypeOf(closure)).toBe(prototype);
    expect(() => closure()).not.toThrow();
  });
});

it("does not mint provenance from public arguments or spoofed properties", async () => {
  await withAbstractFixture(({ api }) => {
    const closure = () => 7;
    let reads = 0;
    Object.defineProperty(closure, "sourceModule", {
      get: () => {
        reads++;
        return "engine262/src/execution-context/Agent.mts";
      },
    });
    Reflect.apply(api.registerNativeClosure, undefined, [
      closure,
      () => ({ bindings: [], ambientNames: [] }),
      "engine262/src/execution-context/Agent.mts",
    ]);
    expect(api.getNativeSourceModule(closure)).toBeUndefined();
    expect(reads).toBe(0);
    expect(closure()).toBe(7);
  });
});

it("does not forward provenance through native bind, proxies, or copied own descriptors", async () => {
  await withAbstractFixture(({ api, agent }) => {
    const closure = agent.assertCanPerformHostEffect;
    const copied = () => 7;
    Object.defineProperties(copied, Object.getOwnPropertyDescriptors(closure));
    let traps = 0;
    const proxy = new Proxy(closure, {
      get: () => {
        traps++;
        throw new Error("Unexpected trap");
      },
      has: () => {
        traps++;
        throw new Error("Unexpected trap");
      },
    });
    const revoked = Proxy.revocable(closure, {});
    revoked.revoke();
    for (const value of [copied, closure.bind(undefined), proxy, revoked.proxy, undefined, {}, 7])
      expect(api.getNativeSourceModule(value)).toBeUndefined();
    expect(traps).toBe(0);
  });
});

it("does not execute capture getters when querying provenance", async () => {
  await withAbstractFixture(({ api }) => {
    const failure = new Error("Capture getter failed");
    const closure = api.registerNativeClosure(
      () => 7,
      () => {
        throw failure;
      },
    );
    expect(api.getNativeSourceModule(closure)).toBeUndefined();
    let caught: unknown;
    try {
      api.getNativeCaptures(closure);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(failure);
  });
});

it("does not certify mutable function properties or class state", async () => {
  await withAbstractFixture(({ api, agent }) => {
    const closure = agent.assertCanPerformHostEffect;
    const record = { count: 0 };
    Reflect.set(closure, "unowned", record);
    record.count++;
    expect(api.getNativeSourceModule(closure)).toBe("engine262/src/execution-context/Agent.mts");
    expect(Reflect.get(closure, "unowned")).toBe(record);
    expect(api.getNativeCaptures(api.Agent)?.ambientNames.includes("[[ClassState]]")).toBe(true);
  });
});

it.each([undefined, "fixture/native-source.mts"])(
  "preserves supported callable forms with compiler source=%s",
  async (sourceModule) => {
    const observation = await evaluateNativeCaptures(
      `
    function declared() { return 1; }
    const expressed = function () { return 2; };
    const arrow = () => 3;
    class DeclaredClass {}
    const ExpressedClass = class {};
    const result = [declared, expressed, arrow, DeclaredClass, ExpressedClass].map(closure => [
      closure.name, getNativeSourceModule(closure), Reflect.ownKeys(closure).map(String)
    ]);
  `,
      {},
      sourceModule,
    );
    expect(observation).toEqual([
      ["declared", sourceModule, ["length", "name", "prototype"]],
      ["expressed", sourceModule, ["length", "name", "prototype"]],
      ["arrow", sourceModule, ["length", "name"]],
      ["DeclaredClass", sourceModule, ["length", "name", "prototype"]],
      ["ExpressedClass", sourceModule, ["length", "name", "prototype"]],
    ]);
  },
);

it("reads compiler provenance before a captured lexical binding is initialized", async () => {
  expect(
    await evaluateNativeCaptures(
      `
    const read = () => later;
    const result = [getNativeSourceModule(read)];
    try { getNativeCaptures(read).bindings.find(binding => binding.name === 'later').get(); }
    catch (error) { result.push(error.name); }
    const later = 7;
    result.push(getNativeSourceModule(read), read());
  `,
      {},
      "fixture/native-source.mts",
    ),
  ).toEqual(["fixture/native-source.mts", "ReferenceError", "fixture/native-source.mts", 7]);
});

it("does not expose injected registration through parent capture manifests", async () => {
  expect(
    await evaluateNativeCaptures(
      `
    function create() { const nested = () => 7; return nested; }
    const nested = create();
    const result = [getNativeCaptures(create).bindings.map(binding => [binding.name, binding.get() === create]), getNativeCaptures(nested).bindings.length, nested()];
  `,
      {},
      "fixture/native-source.mts",
    ),
  ).toEqual([[["create", true]], 0, 7]);
});

it("preserves labeled nested generator captures and restoration", async () => {
  expect(
    await evaluateLowered(
      `
    function* run() {
      let count = 0;
      const increment = () => ++count;
      yield increment;
      yield increment();
      return increment();
    }
    const iterator = run();
    const increment = iterator.next().value;
    const checkpoint = captureControl(iterator, { capture: () => ({ restore() {} }) });
    const first = [increment(), iterator.next().value, iterator.next().value];
    checkpoint.restore();
    const second = [increment(), iterator.next().value, iterator.next().value];
    const result = [getNativeSourceModule(run), getNativeSourceModule(increment), first, second];
  `,
      {},
      "fixture/native-source.mts",
    ),
  ).toEqual(["fixture/native-source.mts", "fixture/native-source.mts", [1, 2, 3], [1, 2, 3]]);
});

it("does not accept another compiled bundle's private provenance brand", async () => {
  const closure = await evaluateNativeCaptures(
    "const result = () => 7;",
    {},
    "engine262/src/execution-context/Agent.mts",
  );
  await withAbstractFixture(({ api }) => {
    expect(typeof closure).toBe("function");
    expect(api.getNativeSourceModule(closure)).toBeUndefined();
    expect(api.getNativeCaptures(closure)).toBeUndefined();
  });
});
