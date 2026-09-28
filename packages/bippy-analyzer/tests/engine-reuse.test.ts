import * as api from "@engine262/engine262";
import { expect, it } from "vite-plus/test";

const withPublishedRealm = (run: (realm: api.ManagedRealm) => void) => {
  const previous = api.surroundingAgent;
  api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
  try {
    const realm = new api.ManagedRealm();
    const pop = realm.pushTopContext();
    try {
      run(realm);
    } finally {
      pop?.();
    }
  } finally {
    api.setSurroundingAgent(previous);
  }
};

it("verifies that upstream ExecutionContext.copy shares generator control and environments", () => {
  withPublishedRealm((realm) => {
    const evaluate = (source: string) =>
      api.EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    const iterator = evaluate(`
      let shared={count:0};
      function* run(){yield 0;shared.count++;yield 1;shared.count++;return 2;}
      let iterator=run();iterator.next();iterator;
    `).Value;
    if (!(iterator instanceof api.ObjectValue)) throw new Error("Expected a generator object");
    const context = Reflect.get(iterator, "GeneratorContext");
    if (!(context instanceof api.ExecutionContext)) throw new Error("Expected a generator context");
    const copy = context.copy();
    expect(copy !== context).toBe(true);
    expect(copy.CodeEvaluationState === context.CodeEvaluationState).toBe(true);
    expect(copy.LexicalEnvironment === context.LexicalEnvironment).toBe(true);
    expect(copy.VariableEnvironment === context.VariableEnvironment).toBe(true);
    expect(copy.callSite !== context.callSite).toBe(true);
    expect(evaluate("iterator.next().value").Value).toEqual(api.Value(1));
    expect(evaluate("shared.count").Value).toEqual(api.Value(1));
    expect(evaluate("iterator.next().value").Value).toEqual(api.Value(2));
    expect(evaluate("shared.count").Value).toEqual(api.Value(2));
    expect(copy.CodeEvaluationState === context.CodeEvaluationState).toBe(true);
  });
});

it("verifies that upstream debugger preview rejects mutation rather than rolling it back", () => {
  withPublishedRealm((realm) => {
    const evaluate = (source: string) =>
      api.EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    expect(evaluate("let shared={count:1};shared.count=2;").Type).toBe("normal");
    const result = api.surroundingAgent.debugger_scopePreview(() => evaluate("shared.count=99"));
    expect(result.Type).toBe("throw");
    if (!(result.Value instanceof api.ObjectValue)) throw new Error("Expected a guest error");
    const message = api.EnsureCompletion(
      api.skipDebugger(api.Get(result.Value, api.Value("message"))),
    );
    expect(message.Value).toEqual(
      api.Value("Preview evaluator cannot evaluate side-effecting code"),
    );
    expect(evaluate("shared.count").Value).toEqual(api.Value(2));
    expect(evaluate("shared.count=3;shared.count").Value).toEqual(api.Value(3));
  });
});
