import type { ManagedRealm, ObjectValue, Value } from "../../engine/dist/declaration/index.mjs";
import { getSymbolicEngine, type SymbolicEngine } from "../../src/symbolic/load-engine.js";

export interface EngineFixture {
  api: SymbolicEngine["api"];
  realm: ManagedRealm;
  evaluate: (source: string) => Value;
  getObject: (source: string) => ObjectValue;
  readString: (source: string) => string;
}

export const withFixture = async (run: (fixture: EngineFixture) => void) => {
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
  try {
    const realm = new api.ManagedRealm();
    const pop = realm.pushTopContext();
    try {
      const evaluate = (source: string) => {
        const result = api.EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
        if (result instanceof api.ThrowCompletion) throw new Error(api.inspect(result.Value));
        return result.Value;
      };
      run({
        api,
        realm,
        evaluate,
        getObject: (source) => {
          const value = evaluate(source);
          if (!(value instanceof api.ObjectValue)) throw new Error("Expected an object");
          return value;
        },
        readString: (source) => {
          const value = evaluate(source);
          if (!(value instanceof api.JSStringValue)) throw new Error("Expected a string");
          return value.stringValue();
        },
      });
    } finally {
      pop?.();
    }
  } finally {
    api.setSurroundingAgent(previous);
  }
};
