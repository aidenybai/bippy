import * as published from "@engine262/engine262";
import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { EnvironmentRecord } from "../engine/dist/declaration/index.mjs";
import { withFixture, type EngineFixture } from "./helpers/engine-fixture.js";

const getEnvironment = ({ api, evaluate }: EngineFixture, source: string, bindingName?: string) => {
  const closure = evaluate(source);
  if (!api.isECMAScriptFunctionObject(closure)) throw new Error("Expected a guest closure");
  let environment: EnvironmentRecord | null = closure.Environment;
  while (environment) {
    const selected =
      environment instanceof api.GlobalEnvironmentRecord
        ? environment.DeclarativeRecord
        : environment;
    if (
      selected instanceof api.DeclarativeEnvironmentRecord &&
      (!bindingName || selected.bindings.has(bindingName))
    )
      return selected;
    environment = environment.OuterEnv;
  }
  throw new Error("Expected a declarative environment");
};

const getPublishedObservation = (source: string) => {
  const previous = published.surroundingAgent;
  published.setSurroundingAgent(new published.Agent({ startEventLoop: false }));
  try {
    const result = published.EnsureCompletion(
      new published.ManagedRealm().evaluateScriptSkipDebugger(source),
    );
    if (result.Type !== "normal" || !(result.Value instanceof published.JSStringValue))
      throw new Error("Expected a published string observation");
    return result.Value.stringValue();
  } finally {
    published.setSurroundingAgent(previous);
  }
};

const setup = `
  var prefixRuns = (globalThis.prefixRuns ?? 0) + 1;
  var bundle = (() => {
    let count = 0;
    let current = { value: 1 };
    const original = current;
    const fixed = 7;
    return {
      original,
      read: () => JSON.stringify([prefixRuns, count, current.value, current === original, fixed]),
      left: () => { count++; current.value = 3; current = { value: 9 }; },
      right: () => { count += 5; current.value *= 2; },
      abrupt: () => { try { count = 2; fixed = 8; } catch (error) { current.value = error.name; } finally { count++; } }
    };
  })();
`;
const branches = ["bundle.left()", "bundle.right()", "bundle.abrupt()"];

it.each([branches, [...branches].reverse()])(
  "restores closure bindings and aliases across branch order %j",
  async (...order) => {
    await withFixture((fixture) => {
      const { api, evaluate, getObject, readString } = fixture;
      evaluate(setup);
      const environment = getEnvironment(fixture, "bundle.read");
      const originalBinding = environment.bindings.get("count");
      const original = getObject("bundle.original");
      const checkpoint = api.createStateCheckpoint({
        objects: [original, original],
        environments: [environment, environment],
      });
      expect(checkpoint.scope).toBe("selected-objects-and-bindings-v1");
      expect(checkpoint.objectCount).toBe(1);
      expect(checkpoint.environmentCount).toBe(1);
      expect(checkpoint.bindingCount).toBe(environment.bindings.size);
      try {
        for (const branch of order) {
          checkpoint.restore();
          expect(environment.bindings.get("count")).toBe(originalBinding);
          evaluate(branch);
          const source = `${setup}\n${branch}; bundle.read()`;
          expect(readString("bundle.read()")).toBe(runInNewContext(source));
          expect(readString("bundle.read()")).toBe(getPublishedObservation(source));
        }
        checkpoint.restore();
        expect(readString("bundle.read()")).toBe("[1,0,1,true,7]");
      } finally {
        checkpoint.release();
      }
    });
  },
);

it("restores function parameter and var cells without replacing the environment", async () => {
  await withFixture((fixture) => {
    const { api, evaluate, readString } = fixture;
    evaluate(
      "var bundle = (function(parameter) { var count = 1; return { read: () => JSON.stringify([parameter, count]), mutate: () => { parameter = 9; count++; } }; })(3)",
    );
    const environment = getEnvironment(fixture, "bundle.read", "parameter");
    expect(environment).toBeInstanceOf(api.FunctionEnvironmentRecord);
    const checkpoint = api.createStateCheckpoint({ environments: [environment] });
    evaluate("bundle.mutate()");
    checkpoint.restore();
    expect(readString("bundle.read()")).toBe("[3,1]");
    expect(getEnvironment(fixture, "bundle.read", "parameter")).toBe(environment);
    checkpoint.release();
  });
});

it("restores separate default-parameter and body environments together", async () => {
  await withFixture((fixture) => {
    const { api, evaluate, readString } = fixture;
    evaluate(
      "var bundle = (function(parameter = 3) { var count = 1; return { read: () => JSON.stringify([parameter, count]), mutate: () => { parameter = 9; count++; } }; })()",
    );
    const parameterEnvironment = getEnvironment(fixture, "bundle.read", "parameter");
    const bodyEnvironment = getEnvironment(fixture, "bundle.read", "count");
    expect(bodyEnvironment).not.toBe(parameterEnvironment);
    const checkpoint = api.createStateCheckpoint({
      environments: [parameterEnvironment, bodyEnvironment],
    });
    evaluate("bundle.mutate()");
    checkpoint.restore();
    expect(readString("bundle.read()")).toBe("[3,1]");
    checkpoint.release();
  });
});

it("restores global lexical declarations and removes branch-only bindings", async () => {
  await withFixture((fixture) => {
    const { api, evaluate, readString } = fixture;
    evaluate("let count = 1; const fixed = 3; var read = () => count;");
    const environment = getEnvironment(fixture, "read");
    const checkpoint = api.createStateCheckpoint({ environments: [environment] });
    evaluate("count = 4; let branchOnly = 9");
    checkpoint.restore();
    expect(readString("JSON.stringify([read(), fixed, typeof branchOnly])")).toBe(
      '[1,3,"undefined"]',
    );
    evaluate("let branchOnly = 8");
    checkpoint.restore();
    expect(readString("typeof branchOnly")).toBe("undefined");
    checkpoint.release();
  });
});

it("preserves TDZ, binding identities, flags, deletion and insertion order", async () => {
  await withFixture(({ api }) => {
    const environment = new api.DeclarativeEnvironmentRecord(null);
    api.X(environment.CreateMutableBinding("mutable", true));
    api.X(environment.InitializeBinding("mutable", api.Value(1)));
    environment.CreateImmutableBinding("fixed", true);
    const original = environment.bindings.get("mutable");
    const fixed = environment.bindings.get("fixed");
    const checkpoint = api.createStateCheckpoint({ environments: [environment] });
    api.X(environment.InitializeBinding("fixed", api.Value(2)));
    api.X(environment.DeleteBinding("mutable"));
    api.X(environment.CreateMutableBinding("extra", false));
    api.X(environment.CreateMutableBinding("mutable", false));
    api.X(environment.InitializeBinding("mutable", api.Value(5)));
    checkpoint.restore();
    expect([...environment.bindings.keys()]).toEqual(["mutable", "fixed"]);
    expect(environment.bindings.get("mutable")).toBe(original);
    expect(environment.bindings.get("fixed")).toBe(fixed);
    expect(api.SameValue(api.X(environment.GetBindingValue("mutable", false)), api.Value(1))).toBe(
      true,
    );
    expect(
      api.EnsureCompletion(api.skipDebugger(environment.GetBindingValue("fixed", true))).Type,
    ).toBe("throw");
    api.X(environment.InitializeBinding("fixed", api.Value(7)));
    expect(
      api.EnsureCompletion(
        api.skipDebugger(environment.SetMutableBinding("fixed", api.Value(8), true)),
      ).Type,
    ).toBe("throw");
    checkpoint.restore();
    expect(fixed?.initialized).toBe(false);
    checkpoint.release();
  });
});

it("shares nested access order with ordinary-object checkpoints", async () => {
  await withFixture((fixture) => {
    const { api, evaluate, getObject, readString } = fixture;
    evaluate(setup);
    const environment = getEnvironment(fixture, "bundle.read");
    const original = getObject("bundle.original");
    const outer = api.createStateCheckpoint({ objects: [original], environments: [environment] });
    evaluate("bundle.right()");
    const inner = api.createOrdinaryObjectCheckpoint([original]);
    expect(() => outer.restore()).toThrow("last-in-first-out");
    expect(() => outer.release()).toThrow("last-in-first-out");
    evaluate("bundle.right()");
    inner.restore();
    expect(readString("bundle.read()")).toBe("[1,10,2,true,7]");
    inner.release();
    outer.restore();
    expect(readString("bundle.read()")).toBe("[1,0,1,true,7]");
    outer.release();
    expect(() => outer.restore()).toThrow("released");
    expect(() => outer.release()).toThrow("released");
  });
});

it("rejects foreign environments and cross-agent operations", async () => {
  await withFixture(({ api }) => {
    const environment = new api.DeclarativeEnvironmentRecord(null);
    const owner = api.surroundingAgent;
    const checkpoint = api.createStateCheckpoint({ environments: [environment] });
    api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
    try {
      expect(() => api.createStateCheckpoint({ environments: [environment] })).toThrow(
        "current agent",
      );
      expect(() => checkpoint.restore()).toThrow("another agent");
      expect(() => checkpoint.release()).toThrow("another agent");
    } finally {
      api.setSurroundingAgent(owner);
      checkpoint.release();
    }
  });
});

it("accepts selected environments from multiple realms owned by one agent", async () => {
  await withFixture(({ api, realm }) => {
    const otherRealm = new api.ManagedRealm();
    const environments = [realm, otherRealm].map((selectedRealm) => {
      selectedRealm.evaluateScriptSkipDebugger("let count = 1");
      if (!(selectedRealm.GlobalEnv instanceof api.GlobalEnvironmentRecord))
        throw new Error("Expected a global environment");
      return selectedRealm.GlobalEnv.DeclarativeRecord;
    });
    const checkpoint = api.createStateCheckpoint({ environments });
    environments.length = 0;
    for (const selectedRealm of [realm, otherRealm])
      selectedRealm.evaluateScriptSkipDebugger("count = 2");
    checkpoint.restore();
    for (const selectedRealm of [realm, otherRealm]) {
      const result = api.EnsureCompletion(selectedRealm.evaluateScriptSkipDebugger("count"));
      expect(result.Type).toBe("normal");
      expect(api.SameValue(result.Value, api.Value(1))).toBe(true);
    }
    expect(checkpoint.environmentCount).toBe(2);
    checkpoint.release();
  });
});

it("supports an empty selected checkpoint without changing state", async () => {
  await withFixture(({ api }) => {
    const checkpoint = api.createStateCheckpoint();
    expect([checkpoint.objectCount, checkpoint.environmentCount, checkpoint.bindingCount]).toEqual([
      0, 0, 0,
    ]);
    checkpoint.restore();
    checkpoint.release();
  });
});

it("rejects module environments and pending this initialization", async () => {
  await withFixture(({ api, evaluate }) => {
    expect(() =>
      api.createStateCheckpoint({ environments: [new api.ModuleEnvironmentRecord(null)] }),
    ).toThrow("declarative or function");
    const constructor = evaluate("(function Constructor() {})");
    if (!api.isECMAScriptFunctionObject(constructor)) throw new Error("Expected a constructor");
    const environment = new api.FunctionEnvironmentRecord(constructor, api.Value.undefined);
    expect(() => api.createStateCheckpoint({ environments: [environment] })).toThrow(
      "uninitialized this",
    );
    environment.BindThisValue(api.Value.undefined);
    api.createStateCheckpoint({ environments: [environment] }).release();
  });
});

it("validates all selected resources before restoring objects or bindings", async () => {
  await withFixture((fixture) => {
    const { api, evaluate, getObject, readString } = fixture;
    evaluate(setup);
    const environment = getEnvironment(fixture, "bundle.read");
    const original = getObject("bundle.original");
    const checkpoint = api.createStateCheckpoint({
      objects: [original],
      environments: [environment],
    });
    evaluate("bundle.right()");
    api.X(
      api.AddDisposableResource(
        environment.DisposableResourceStack,
        api.Value.undefined,
        "async-dispose",
      ),
    );
    expect(() => checkpoint.restore()).toThrow("pending disposal");
    expect(() => api.createStateCheckpoint({ environments: [environment] })).toThrow(
      "pending disposal",
    );
    expect(readString("bundle.read()")).toBe("[1,5,2,true,7]");
    environment.DisposableResourceStack.pop();
    api.surroundingAgent.debugger_scopePreview(() => {
      expect(() => checkpoint.restore()).toThrow("during preview");
    });
    expect(readString("bundle.read()")).toBe("[1,5,2,true,7]");
    checkpoint.restore();
    expect(readString("bundle.read()")).toBe("[1,0,1,true,7]");
    checkpoint.release();
  });
});

it("rejects prototype cycles before restoring selected bindings", async () => {
  await withFixture((fixture) => {
    const { api, evaluate, getObject, readString } = fixture;
    evaluate(
      "let count = 1; var read = () => count; var parent = {}; var object = Object.create(parent)",
    );
    const checkpoint = api.createStateCheckpoint({
      objects: [getObject("object")],
      environments: [getEnvironment(fixture, "read")],
    });
    evaluate(
      "count = 2; Object.setPrototypeOf(object, null); Object.setPrototypeOf(parent, object)",
    );
    expect(() => checkpoint.restore()).toThrow("prototype cycle");
    expect(readString("String(count)")).toBe("2");
    evaluate("Object.setPrototypeOf(parent, null)");
    checkpoint.restore();
    expect(readString("String(count)")).toBe("1");
    checkpoint.release();
  });
});

it("retains the original cell after deletion and garbage collection", async () => {
  await withFixture(({ api, evaluate, readString }) => {
    const environment = new api.DeclarativeEnvironmentRecord(null);
    const value = evaluate(
      "var reference; (() => { const value = {}; reference = new WeakRef(value); return value; })()",
    );
    api.X(environment.CreateMutableBinding("saved", true));
    api.X(environment.InitializeBinding("saved", value));
    const binding = environment.bindings.get("saved");
    const checkpoint = api.createStateCheckpoint({ environments: [environment] });
    api.X(environment.DeleteBinding("saved"));
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    checkpoint.restore();
    expect(environment.bindings.get("saved")).toBe(binding);
    expect(api.X(environment.GetBindingValue("saved", false))).toBe(value);
    expect(readString("String(reference.deref() !== undefined)")).toBe("true");
    checkpoint.release();
  });
});

it("keeps saved binding values alive independently of mutated cells", async () => {
  await withFixture((fixture) => {
    const { api, evaluate, readString } = fixture;
    evaluate("let retained = {}; var reference = new WeakRef(retained); var read = () => retained");
    const environment = getEnvironment(fixture, "read");
    const checkpoint = api.createStateCheckpoint({ environments: [environment] });
    evaluate("retained = undefined");
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    checkpoint.restore();
    expect(readString("String(reference.deref() === retained)")).toBe("true");
    evaluate("retained = undefined");
    checkpoint.release();
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref() === undefined)")).toBe("true");
  });
});

it("does not restore unselected objects or outer bindings", async () => {
  await withFixture((fixture) => {
    const { api, evaluate, readString } = fixture;
    evaluate(
      "let outer = 0; var bundle = (() => { let inner = 0; const object = { value: 0 }; return { read: () => JSON.stringify([outer, inner, object.value]), mutate: () => { outer++; inner++; object.value++; } }; })()",
    );
    const checkpoint = api.createStateCheckpoint({
      environments: [getEnvironment(fixture, "bundle.read")],
    });
    evaluate("bundle.mutate()");
    checkpoint.restore();
    expect(readString("bundle.read()")).toBe("[1,0,1]");
    checkpoint.release();
  });
});
