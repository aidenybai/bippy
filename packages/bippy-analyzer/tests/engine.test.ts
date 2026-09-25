import { expect, it } from "vite-plus/test";
import {
  Agent,
  ManagedRealm,
  ThrowCompletion,
  Value,
  ValueOfNormalCompletion,
  setSurroundingAgent,
  surroundingAgent,
} from "@engine262/engine262";

it("evaluates JavaScript through the public API and isolates realm globals", () => {
  const previousAgent = surroundingAgent;
  const agent = new Agent();
  agent.eventLoop.run("manual");
  setSurroundingAgent(agent);
  try {
    const realm = new ManagedRealm();
    const result = realm.evaluateScriptSkipDebugger(
      "const getTotal = (price) => price + 5; getTotal(10)",
    );
    expect(ValueOfNormalCompletion(result)).toEqual(Value(15));
    const otherRealm = new ManagedRealm();
    expect(otherRealm.evaluateScriptSkipDebugger("getTotal(10)")).toBeInstanceOf(ThrowCompletion);
  } finally {
    setSurroundingAgent(previousAgent);
  }
});
