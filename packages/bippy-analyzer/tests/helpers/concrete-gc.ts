import type { ConcreteRuntime } from "../../src/concrete/runtime.js";
import { getSymbolicEngine } from "../../src/symbolic/load-engine.js";

export const getCollectedReference = async (runtime: ConcreteRuntime): Promise<string> => {
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  api.setSurroundingAgent(runtime.agent);
  const pop = runtime.realm.pushTopContext();
  try {
    runtime.agent.AgentRecord.KeptAlive.clear();
    api.gc();
    const result = api.EnsureCompletion(
      runtime.realm.evaluateScriptSkipDebugger("String(reference.deref() !== undefined)"),
    );
    if (result.Type !== "normal" || result.Value.type !== "String")
      throw new Error("Expected a GC observation");
    return result.Value.stringValue();
  } finally {
    pop?.();
    api.setSurroundingAgent(previous);
  }
};
