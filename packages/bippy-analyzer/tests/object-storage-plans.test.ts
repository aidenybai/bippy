import { expect, it } from "vite-plus/test";
import type { ObjectValue, EnvironmentRecord } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture, type AbstractFixture } from "./helpers/abstract-fixture.js";

interface StorageReference {
  path: string;
  kind: string;
  value: unknown;
}

interface NativeStoragePlan {
  state: { object: ObjectValue; properties: readonly unknown[] };
  objects: ObjectValue[];
  environments: EnvironmentRecord[];
  visitReferences: (
    scope: "data" | "execution",
    visit: (reference: StorageReference) => void,
  ) => void;
}

interface StoragePlan extends NativeStoragePlan {
  getReferences: (scope: "data" | "execution") => StorageReference[];
}

const getPlanner = ({ api, agent }: AbstractFixture) => {
  const getBinding = (closure: unknown, name: string) => {
    const binding = api
      .getNativeCaptures(closure)
      ?.bindings.find((innerBinding) => innerBinding.name === name);
    const value = binding?.get();
    if (typeof value !== "function") throw new Error(`Missing private binding: ${name}`);
    return value;
  };
  const checkpoint = getBinding(api.createStateCheckpoint, "createCheckpoint");
  const planner = getBinding(checkpoint, "getObjectStoragePlan");
  expect(Reflect.has(api, "getObjectStoragePlan")).toBe(false);
  return (value: unknown): StoragePlan => {
    const plan: NativeStoragePlan = Reflect.apply(planner, undefined, [value, agent, true]);
    return {
      ...plan,
      getReferences: (scope) => {
        const references: StorageReference[] = [];
        plan.visitReferences(scope, (reference) => references.push(reference));
        return references;
      },
    };
  };
};

it("uses original selected storage while exposing property, symbol and accessor dependencies without guest reads", async () => {
  await withAbstractFixture((fixture) => {
    const { api, evaluate } = fixture;
    const object = evaluate(`
      var reads=0, child=Object.create(null), key=Symbol("key"), root=Object.create(null);
      Object.defineProperty(root, "hidden", {value:child, writable:true, configurable:true});
      root[key]=child;
      Object.defineProperty(root, "accessor", {get(){reads++;return child;}, configurable:true});
      root;
    `).Value;
    const plan = getPlanner(fixture)(object);
    const data = plan.getReferences("data"),
      execution = plan.getReferences("execution");
    expect(plan.state.object === object).toBe(true);
    expect(plan.objects).toEqual([]);
    expect(data.map((reference) => reference.path)).toEqual([
      "Prototype",
      ...[0, 1, 2].flatMap((index) =>
        ["key", "Value", "Get", "Set"].map((field) => `properties[${index}].${field}`),
      ),
    ]);
    expect(
      data.find((reference) => reference.path === "properties[0].Value")?.value ===
        data.find((reference) => reference.path === "properties[1].Value")?.value,
    ).toBe(true);
    expect(
      data.find((reference) => reference.path === "properties[1].key")?.value instanceof
        api.SymbolValue,
    ).toBe(true);
    expect(
      data.find((reference) => reference.path === "properties[2].Get")?.value instanceof
        api.ObjectValue,
    ).toBe(true);
    expect(evaluate("reads").Value).toEqual(api.Value(0));
    expect(
      execution.find((reference) => reference.path === "properties[0].descriptor")?.value instanceof
        api.Descriptor,
    ).toBe(true);
    expect(
      execution.some(
        (reference) => reference.kind === "implementation" && reference.path === "nativePrototype",
      ),
    ).toBe(true);
    expect(
      execution.some(
        (reference) => reference.path === "internalSlotsList" && Array.isArray(reference.value),
      ),
    ).toBe(true);
  });
});

it("reports closure, Realm, Script and native implementation boundaries at the actual aliased-call pause", async () => {
  await withAbstractFixture((fixture) => {
    const { api, agent, realm, compile, createBoolean } = fixture;
    createBoolean("enabled");
    agent.evaluate(
      compile(`
      var prefix=0, state={total:0}, alias=state;
      var apply=(()=>{ var held=state; return (head,choice,tail)=>{ held.total+=choice+tail; return [head===held,held.total,prefix]; }; })();
      prefix++; apply(alias, enabled ? 1 : 2, 10);
    `),
      () => {},
      false,
    );
    const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
    if (pause.done || !pause.value) throw new Error("Expected pause");
    const apply = realm.GlobalObject.properties.get("apply")?.Value;
    const state = realm.GlobalObject.properties.get("state")?.Value;
    const planner = getPlanner(fixture);
    const references = planner(apply).getReferences("execution");
    expect(references.find((reference) => reference.path === "Realm")?.value === realm).toBe(true);
    expect(
      references.find((reference) => reference.path === "Environment")?.value instanceof
        api.EnvironmentRecord,
    ).toBe(true);
    expect(
      references.find((reference) => reference.path === "ScriptOrModule")?.value instanceof
        api.ScriptRecord,
    ).toBe(true);
    expect(typeof references.find((reference) => reference.path === "Call")?.value).toBe(
      "function",
    );
    expect(
      references.find((reference) => reference.path === "ECMAScriptCode")?.value,
    ).toBeDefined();
    expect(
      planner(state)
        .getReferences("execution")
        .find((reference) => reference.path === "Prototype")?.value instanceof api.ObjectValue,
    ).toBe(true);
    let foundAccumulator = false;
    const rejection = new Error("Native dependency requires an execution policy");
    expect(() =>
      agent.captureEvaluation({
        references: (value) => {
          const accumulator = api.getArgumentAccumulatorStorage(value);
          if (accumulator?.references.includes(state)) foundAccumulator = true;
          if (typeof value === "function") throw rejection;
          return [];
        },
        capture: () => {
          throw new Error("Must not publish a partial owner");
        },
      }),
    ).toThrow(rejection);
    expect(foundAccumulator).toBe(false);
    expect(agent.resumeEvaluate({ pauseOnAbstractBoolean: true }).value).toBe(pause.value);
    expect(realm.GlobalObject.properties.get("prefix")?.Value).toEqual(api.Value(1));
    expect(() => agent.assertCanPerformHostEffect()).not.toThrow();
  });
});

it.each(["array", "map", "set", "weak-map"])(
  "exposes saved %s entries without converting weak edges to strong data edges",
  async (kind) => {
    await withAbstractFixture((fixture) => {
      const { api, evaluate } = fixture;
      const expression =
        kind === "array"
          ? "Object.setPrototypeOf([child,,child],null)"
          : kind === "set"
            ? "Object.setPrototypeOf(new Set([child]),null)"
            : kind === "map"
              ? "Object.setPrototypeOf(new Map([[child,child]]),null)"
              : "Object.setPrototypeOf(new WeakMap([[child,child]]),null)";
      const child = evaluate("var child=Object.create(null); child").Value;
      const object = evaluate(`var root=${expression}; root`).Value;
      const plan = getPlanner(fixture)(object);
      const references = plan.getReferences("execution");
      const targets = references.filter((reference) => reference.value === child);
      expect(targets.length).toBeGreaterThan(0);
      if (kind === "weak-map") {
        expect(targets.map((reference) => reference.kind)).toEqual(["weak-key", "weak-value"]);
        expect(() => api.createDataGraphCheckpoint({ roots: [plan.state.object] })).toThrow(
          "Checkpoint requires ordinary objects",
        );
      } else expect(targets.every((reference) => reference.kind === "data")).toBe(true);
      const saved = api.createStateCheckpoint({ objects: [plan.state.object] });
      try {
        if (kind === "array") evaluate("root.length=0");
        else if (kind === "set") evaluate("Set.prototype.clear.call(root)");
        else if (kind === "map") evaluate("Map.prototype.clear.call(root)");
        else evaluate("WeakMap.prototype.delete.call(root,child)");
        expect(
          plan.getReferences("execution").filter((reference) => reference.value === child).length,
        ).toBe(targets.length);
        saved.restore();
      } finally {
        saved.release();
      }
    });
  },
);

it("exposes bound target, receiver, indexed arguments and the original native list", async () => {
  await withAbstractFixture((fixture) => {
    const { evaluate, realm } = fixture;
    const bound = evaluate(
      "var receiver={}, child={}, target=function(){}; target.bind(receiver,child)",
    ).Value;
    const references = getPlanner(fixture)(bound).getReferences("execution");
    expect(
      references.find((reference) => reference.path === "BoundTargetFunction")?.value ===
        realm.GlobalObject.properties.get("target")?.Value,
    ).toBe(true);
    expect(
      references.find((reference) => reference.path === "BoundThis")?.value ===
        realm.GlobalObject.properties.get("receiver")?.Value,
    ).toBe(true);
    expect(
      references.find((reference) => reference.path === "BoundArguments[0]")?.value ===
        realm.GlobalObject.properties.get("child")?.Value,
    ).toBe(true);
    expect(
      Array.isArray(references.find((reference) => reference.path === "BoundArguments")?.value),
    ).toBe(true);
  });
});

it("returns mapped-argument implicit storage selections without confusing their dependencies with owned leaves", async () => {
  await withAbstractFixture((fixture) => {
    const { api, evaluate } = fixture;
    const argumentsObject = evaluate(
      "var argumentRoot=(function(value){return arguments})(7); argumentRoot",
    ).Value;
    const planner = getPlanner(fixture),
      plan = planner(argumentsObject);
    expect(plan.objects.length).toBe(1);
    const mapping = planner(plan.objects[0]);
    expect(mapping.environments.length).toBe(1);
    expect(mapping.environments[0] instanceof api.DeclarativeEnvironmentRecord).toBe(true);
    const references = mapping.getReferences("execution");
    expect(
      references.find((reference) => reference.path === "ArgumentsParameterMapData.environment")
        ?.value === mapping.environments[0],
    ).toBe(true);
    expect(
      references.some((reference) => reference.path === "ArgumentsParameterMapData.realm"),
    ).toBe(true);
    expect(
      references.some(
        (reference) => reference.path === "ArgumentsParameterMapData.pendingMappings",
      ),
    ).toBe(true);
    expect(
      references.some(
        (reference) => reference.path === "ArgumentsParameterMapData.pendingMappings[0].key",
      ),
    ).toBe(true);
    evaluate("argumentRoot[0]");
    const materialized = planner(plan.objects[0]).getReferences("execution");
    expect(
      materialized.find((reference) => reference.path === "GetOwnProperty")?.value ===
        materialized.find(
          (reference) => reference.path === "ArgumentsParameterMapData.getOwnProperty",
        )?.value,
    ).toBe(false);
    expect(
      materialized.find(
        (reference) => reference.path === "ArgumentsParameterMapData.getOwnProperty",
      )?.value ===
        references.find(
          (reference) => reference.path === "ArgumentsParameterMapData.getOwnProperty",
        )?.value,
    ).toBe(true);
  });
});

it.each(["error", "regexp", "string", "intrinsic", "constructed"])(
  "preserves %s metadata dependencies",
  async (kind) => {
    await withAbstractFixture((fixture) => {
      const { evaluate } = fixture;
      const source =
        kind === "error"
          ? "new Error('failure')"
          : kind === "regexp"
            ? "/x/g"
            : kind === "string"
              ? "new String('text')"
              : kind === "intrinsic"
                ? "Object.prototype"
                : "new (function Constructor(){this.value=1})()";
      const references = getPlanner(fixture)(evaluate(source).Value).getReferences("execution");
      const path =
        kind === "error"
          ? "HostDefinedStack"
          : kind === "regexp"
            ? "RegExpMatcher"
            : kind === "string"
              ? "StringData"
              : kind === "intrinsic"
                ? "exoticMethods"
                : "ConstructedBy[0]";
      expect(references.find((reference) => reference.path === path)?.value).toBeDefined();
    });
  },
);

it("exposes builtin native captures without executing their factory", async () => {
  await withAbstractFixture((fixture) => {
    const { api } = fixture;
    let reads = 0;
    const steps = api.registerNativeClosure(
      () => api.Value(1),
      () => {
        reads++;
        throw new Error("Must not expand captures");
      },
    );
    const builtin = api.CreateBuiltinFunction(steps, 0, "custom", []);
    const references = getPlanner(fixture)(builtin).getReferences("execution");
    expect(
      references.find((reference) => reference.path === "nativeFunction")?.value === steps,
    ).toBe(true);
    expect(reads).toBe(0);
  });
});

it.each(["promise", "proxy", "typed-array", "class", "private"])(
  "rejects unsupported %s storage through the original validator",
  async (kind) => {
    await withAbstractFixture((fixture) => {
      const { evaluate } = fixture;
      const source =
        kind === "promise"
          ? "Promise.resolve(1)"
          : kind === "proxy"
            ? "new Proxy({}, {})"
            : kind === "typed-array"
              ? "new Uint8Array(2)"
              : kind === "class"
                ? "(class {})"
                : "new (class { #value=1 })";
      const object = evaluate(source).Value;
      expect(() => getPlanner(fixture)(object)).toThrow("Checkpoint requires ordinary objects");
    });
  },
);

it("keeps the data entry budget ahead of property snapshot traversal", async () => {
  await withAbstractFixture(({ api, evaluate }) => {
    const root = evaluate("Object.create(null)").Value;
    if (!(root instanceof api.ObjectValue)) throw new Error("Expected object");
    let reads = 0;
    Object.defineProperty(root.properties, "forEach", {
      configurable: true,
      get: () => {
        reads++;
        throw new Error("Unexpected traversal");
      },
    });
    try {
      expect(() => api.createDataGraphCheckpoint({ roots: [root], maxEntries: 1 })).toThrow(
        "entry budget",
      );
      expect(reads).toBe(0);
    } finally {
      Reflect.deleteProperty(root.properties, "forEach");
    }
  });
});

it("does not publish a checkpoint or root guest data merely by producing a private plan", async () => {
  await withAbstractFixture((fixture) => {
    const { api, agent, realm, evaluate } = fixture;
    const target = evaluate(
      "var target=Object.create(null), weak=new WeakRef(target); target",
    ).Value;
    const weak = realm.GlobalObject.properties.get("weak")?.Value;
    if (!(weak instanceof api.ObjectValue)) throw new Error("Expected WeakRef");
    const outer = api.createStateCheckpoint();
    const plan = getPlanner(fixture)(target);
    outer.restore();
    outer.release();
    evaluate("target=undefined");
    agent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(Reflect.get(weak, "WeakRefTarget") === target).toBe(false);
    expect(plan.state.object === target).toBe(true);
  });
});

it("retains rejection of foreign objects and native records", async () => {
  await withAbstractFixture((fixture) => {
    const { api, agent } = fixture;
    const planner = getPlanner(fixture);
    expect(() => planner({})).toThrow("Checkpoint objects must be guest objects");
    api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
    let foreign;
    try {
      foreign = new api.ManagedRealm().GlobalObject;
    } finally {
      api.setSurroundingAgent(agent);
    }
    expect(() => planner(foreign)).toThrow("Checkpoint objects must belong to the current agent");
  });
});

it("does not accept a native record smuggled through a guest data slot", async () => {
  await withAbstractFixture(({ api, evaluate }) => {
    const root = evaluate("var root=Object.create(null); root.value=1; root").Value;
    if (!(root instanceof api.ObjectValue)) throw new Error("Expected object");
    const descriptor = root.properties.get("value");
    if (!descriptor) throw new Error("Expected descriptor");
    const savedValue = descriptor.Value;
    Reflect.set(descriptor, "Value", { unowned: true });
    try {
      expect(() => api.createDataGraphCheckpoint({ roots: [root] })).toThrow(
        "Data graph contains a non-guest reference",
      );
    } finally {
      Reflect.set(descriptor, "Value", savedValue);
    }
  });
});

it.each(["Map", "Set"])("charges entries before copying %s storage", async (kind) => {
  await withAbstractFixture(({ api, evaluate }) => {
    const root = evaluate(`Object.setPrototypeOf(new ${kind}(),null)`).Value;
    if (!(root instanceof api.ObjectValue)) throw new Error("Expected object");
    const storage = Reflect.get(root, `${kind}Data`);
    if (!Array.isArray(storage)) throw new Error("Expected storage");
    const key = kind === "Map" ? "map" : Symbol.iterator;
    let reads = 0;
    Object.defineProperty(storage, key, {
      configurable: true,
      get: () => {
        reads++;
        throw new Error("Unexpected copying");
      },
    });
    try {
      expect(() => api.createDataGraphCheckpoint({ roots: [root], maxEntries: 1 })).toThrow(
        "entry budget",
      );
      expect(reads).toBe(0);
    } finally {
      Reflect.deleteProperty(storage, key);
    }
  });
});

it("validates a schema before charging its entries", async () => {
  await withAbstractFixture(({ api, evaluate }) => {
    const root = evaluate("new WeakMap()").Value;
    if (!(root instanceof api.ObjectValue)) throw new Error("Expected object");
    expect(() => api.createDataGraphCheckpoint({ roots: [root], maxEntries: 1 })).toThrow(
      "Checkpoint requires ordinary objects",
    );
  });
});

it("checks exhausted object budget before inspecting the next schema", async () => {
  await withAbstractFixture(({ api, evaluate }) => {
    const first = evaluate("Object.create(null)").Value,
      second = evaluate("new WeakMap()").Value;
    if (!(first instanceof api.ObjectValue) || !(second instanceof api.ObjectValue))
      throw new Error("Expected objects");
    expect(() => api.createDataGraphCheckpoint({ roots: [first, second], maxObjects: 1 })).toThrow(
      "object budget",
    );
  });
});

it.each(["Map", "Set"])("keeps property-before-entry ordering and %s tombstones", async (kind) => {
  await withAbstractFixture((fixture) => {
    const { evaluate, realm } = fixture;
    const expression =
      kind === "Map"
        ? "new Map([[first,second],[second,first],[third,first]])"
        : "new Set([first,second,third])";
    const root = evaluate(`
      var first=Object.create(null), second=Object.create(null), third=Object.create(null);
      var root=Object.setPrototypeOf(${expression},null);
      root.marker=first; ${kind}.prototype.delete.call(root,second); root;
    `).Value;
    const references = getPlanner(fixture)(root).getReferences("data");
    const entryPaths =
      kind === "Map"
        ? [0, 1, 2].flatMap((index) => [`MapData[${index}].Key`, `MapData[${index}].Value`])
        : [0, 1, 2].map((index) => `SetData[${index}]`);
    expect(references.map((reference) => reference.path)).toEqual([
      "Prototype",
      "properties[0].key",
      "properties[0].Value",
      "properties[0].Get",
      "properties[0].Set",
      ...entryPaths,
    ]);
    const first = realm.GlobalObject.properties.get("first")?.Value,
      second = realm.GlobalObject.properties.get("second")?.Value,
      third = realm.GlobalObject.properties.get("third")?.Value;
    const expected =
      kind === "Map"
        ? [first, second, undefined, undefined, third, first]
        : [first, undefined, third];
    expect(
      references.slice(5).map((reference, index) => reference.value === expected[index]),
    ).toEqual(expected.map(() => true));
  });
});

it("does not turn mixed saved and live execution metadata into a stable certificate", async () => {
  await withAbstractFixture((fixture) => {
    const { api, evaluate } = fixture;
    const root = evaluate("Object.create(null)").Value;
    if (!(root instanceof api.ObjectValue)) throw new Error("Expected object");
    const plan = getPlanner(fixture)(root);
    const slots = Object.getOwnPropertyDescriptor(root, "internalSlotsList");
    if (!slots) throw new Error("Expected slots");
    const replacement = ["Prototype", "Extensible"];
    Object.defineProperty(root, "internalSlotsList", { value: replacement });
    try {
      expect(
        plan.getReferences("execution").find((reference) => reference.path === "internalSlotsList")
          ?.value === replacement,
      ).toBe(true);
      expect(plan.getReferences("data")[0].value === api.Value.null).toBe(true);
    } finally {
      Object.defineProperty(root, "internalSlotsList", slots);
    }
  });
});

it("stops reference inspection at a throwing visitor before reading later fields", async () => {
  await withAbstractFixture((fixture) => {
    const { api, evaluate } = fixture;
    const root = evaluate("var root=Object.create(null);root.value=1;root").Value;
    if (!(root instanceof api.ObjectValue)) throw new Error("Expected object");
    const plan = getPlanner(fixture)(root),
      descriptor = root.properties.get("value");
    if (!descriptor) throw new Error("Expected descriptor");
    const original = Object.getOwnPropertyDescriptor(descriptor, "Value");
    if (!original) throw new Error("Expected field");
    let reads = 0;
    Object.defineProperty(descriptor, "Value", {
      get: () => {
        reads++;
        return api.Value(1);
      },
    });
    const failure = new Error("Visitor stopped"),
      paths: string[] = [];
    let observed: unknown;
    try {
      try {
        plan.visitReferences("data", (reference) => {
          paths.push(reference.path);
          throw failure;
        });
      } catch (error) {
        observed = error;
      }
      expect(observed).toBe(failure);
      expect(paths).toEqual(["Prototype"]);
      expect(reads).toBe(0);
    } finally {
      Object.defineProperty(descriptor, "Value", original);
    }
  });
});
