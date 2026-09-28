import type {
  Agent,
  BooleanValue,
  ManagedRealm,
  NumberValue,
  NormalCompletion,
  ThrowCompletion,
  Value,
} from "../../engine/dist/declaration/index.mjs";
import { createNumericDomain, type NumericDomain } from "../../src/index.js";
import { getSymbolicEngine, type SymbolicEngine } from "../../src/symbolic/load-engine.js";

export interface AbstractFixture {
  api: SymbolicEngine["api"];
  agent: Agent;
  realm: ManagedRealm;
  domain: NumericDomain;
  evaluate: (source: string) => NormalCompletion<Value> | ThrowCompletion;
  getNumber: (source: string) => NumberValue;
  createBoolean: (name: string) => BooleanValue;
  compile: (source: string) => ReturnType<SymbolicEngine["api"]["ScriptEvaluation"]>;
}

export const withAbstractFixture = async (
  run: (fixture: AbstractFixture) => void,
  providedDomain?: NumericDomain,
) => {
  const domain = providedDomain ?? (await createNumericDomain());
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  const agent = new api.Agent({ startEventLoop: false, ...domain.agentOptions });
  api.setSurroundingAgent(agent);
  try {
    const realm = new api.ManagedRealm();
    realm.pushTopContext();
    try {
      api.X(
        api.CreateDataPropertyOrThrow(realm.GlobalObject, "amount", domain.createInput("amount")),
      );
      const evaluate = (source: string) =>
        api.EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
      const getNumber = (source: string) => {
        const result = evaluate(source);
        if (result.Type !== "normal" || !(result.Value instanceof api.NumberValue))
          throw new Error("Expected a normal Number result");
        return result.Value;
      };
      run({
        api,
        agent,
        realm,
        domain,
        evaluate,
        getNumber,
        createBoolean: (name) => {
          const input = api.BooleanValue.createAbstract();
          api.X(api.CreateDataPropertyOrThrow(realm.GlobalObject, name, input));
          return input;
        },
        compile: (source) => {
          const compiled = api.EnsureCompletion(realm.compileScript(source));
          if (compiled.Type !== "normal") throw new Error("Expected a compiled script");
          return api.ScriptEvaluation(compiled.Value);
        },
      });
    } finally {
      // HACK: Host errors bypass context unwinding; discard this fixture Agent without resuming it.
      agent.executionContextStack.length = 0;
    }
  } finally {
    api.setSurroundingAgent(previous);
  }
};
