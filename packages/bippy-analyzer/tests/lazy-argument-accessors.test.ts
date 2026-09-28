import { expect, it } from "vite-plus/test";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";

it.each([false, true])(
  "retains accessor realm and aliases with debugger option %s",
  async (withDebugger) => {
    const { api } = await getSymbolicEngine();
    const previous = api.surroundingAgent;
    const agent = new api.Agent({
      startEventLoop: false,
      onDebugger: withDebugger ? () => {} : undefined,
    });
    api.setSurroundingAgent(agent);
    try {
      const owner = new api.ManagedRealm();
      const result = api.EnsureCompletion(
        owner.evaluateScriptSkipDebugger(
          "var getValue; (function(value) { getValue = () => value; return arguments; })(2)",
        ),
      );
      expect(result.Type).toBe("normal");
      if (!api.isArgumentExoticObject(result.Value) || !result.Value.ParameterMap)
        throw new Error("Expected mapped arguments");
      const argumentsValue = result.Value;
      const map = argumentsValue.ParameterMap;
      expect(map.properties.size).toBe(withDebugger ? 1 : 0);
      const reader = new api.ManagedRealm();
      const pop = reader.pushTopContext();
      try {
        const descriptor = api.EnsureCompletion(
          api.skipDebugger(map.GetOwnProperty(api.Value("0"))),
        );
        if (descriptor instanceof api.ThrowCompletion || !descriptor.Value)
          throw new Error("Missing mapping descriptor");
        const { Get: getter, Set: setter } = descriptor.Value;
        if (!api.isBuiltinFunctionObject(getter) || !api.isBuiltinFunctionObject(setter))
          throw new Error("Expected builtin mapping accessors");
        expect(getter.Realm === owner).toBe(true);
        expect(setter.Realm === owner).toBe(true);
        expect(
          api.EnsureCompletion(api.skipDebugger(api.Set(argumentsValue, "0", api.Value(7), false)))
            .Type,
        ).toBe("normal");
        expect(agent.currentRealmRecord === reader).toBe(true);
        expect(map.GetOwnProperty === api.ObjectValue.prototype.GetOwnProperty).toBe(true);
      } finally {
        pop?.();
      }
      const value = api.EnsureCompletion(owner.evaluateScriptSkipDebugger("getValue()"));
      expect(value.Type).toBe("normal");
      if (value.Value.type !== "Number") throw new Error("Expected a number binding");
      expect(value.Value.numberValue()).toBe(7);
    } finally {
      api.setSurroundingAgent(previous);
    }
  },
);

it("materializes mappings on preview reads without permitting writes to an existing map", async () => {
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  const agent = new api.Agent({ startEventLoop: false });
  api.setSurroundingAgent(agent);
  try {
    const realm = new api.ManagedRealm();
    const result = api.EnsureCompletion(
      realm.evaluateScriptSkipDebugger(
        "var getValue; (function(value) { getValue = () => value; return arguments; })(2)",
      ),
    );
    if (!api.isArgumentExoticObject(result.Value) || !result.Value.ParameterMap)
      throw new Error("Expected mapped arguments");
    const map = result.Value.ParameterMap;
    expect(map.properties.size).toBe(0);
    const pop = realm.pushTopContext();
    try {
      agent.debugger_scopePreview(() => {
        const read = api.EnsureCompletion(api.skipDebugger(api.Get(map, "0")));
        expect(read.Type).toBe("normal");
        const write = api.EnsureCompletion(
          api.skipDebugger(api.Set(map, "0", api.Value(9), false)),
        );
        expect(write.Type).toBe("throw");
      });
      const result = api.EnsureCompletion(realm.evaluateScriptSkipDebugger("getValue()"));
      if (result.Value.type !== "Number") throw new Error("Expected an unchanged number binding");
      expect(result.Value.numberValue()).toBe(2);
    } finally {
      pop?.();
    }
  } finally {
    api.setSurroundingAgent(previous);
  }
});

it("materializes own keys in numeric order after an out-of-order read", async () => {
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
  try {
    const realm = new api.ManagedRealm();
    const result = api.EnsureCompletion(
      realm.evaluateScriptSkipDebugger(
        "(function(first, second, third) { return arguments; })(1, 2, 3)",
      ),
    );
    if (!api.isArgumentExoticObject(result.Value) || !result.Value.ParameterMap)
      throw new Error("Expected mapped arguments");
    const map = result.Value.ParameterMap;
    const pop = realm.pushTopContext();
    try {
      api.skipDebugger(map.GetOwnProperty("2"));
      expect(map.properties.size).toBe(1);
      const keys = api.EnsureCompletion(api.skipDebugger(map.OwnPropertyKeys()));
      if (keys instanceof api.ThrowCompletion) throw new Error("Unexpected own-key failure");
      expect(
        keys.Value.map((key) =>
          key instanceof api.JSStringValue ? key.stringValue() : "unexpected symbol",
        ),
      ).toEqual(["0", "1", "2"]);
      expect(map.properties.size).toBe(3);
      expect(map.GetOwnProperty === api.ObjectValue.prototype.GetOwnProperty).toBe(true);
      expect(map.OwnPropertyKeys === api.ObjectValue.prototype.OwnPropertyKeys).toBe(true);
    } finally {
      pop?.();
    }
  } finally {
    api.setSurroundingAgent(previous);
  }
});
