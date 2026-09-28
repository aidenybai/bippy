import { expect, it } from "vite-plus/test";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { withFixture } from "./helpers/engine-fixture.js";
import { getNativeGcObservation } from "./helpers/native-gc.js";

interface SuspendedFixture {
  name: string;
  body: string;
  result: string;
}

const fixtures: SuspendedFixture[] = [
  {
    name: "partial array",
    body: "return [create(), yield 'pause'];",
    result: "iterator.next().value[0]",
  },
  {
    name: "partial object",
    body: "return { retained: create(), pause: yield 'pause' };",
    result: "iterator.next().value.retained",
  },
  {
    name: "call argument list",
    body: "return first(create(), yield 'pause');",
    result: "iterator.next().value",
  },
  {
    name: "constructor argument list",
    body: "return new Holder(create(), yield 'pause');",
    result: "iterator.next().value.retained",
  },
  {
    name: "method receiver",
    body: "return create().read(yield 'pause');",
    result: "iterator.next().value",
  },
  {
    name: "return through finally",
    body: "try { return create(); } finally { yield 'pause'; }",
    result: "iterator.next().value",
  },
  {
    name: "throw through finally",
    body: "try { throw create(); } finally { yield 'pause'; }",
    result: "(() => { try { iterator.next(); } catch (error) { return error; } })()",
  },
  {
    name: "nested guest delegation",
    body: "return yield* inner();",
    result: "iterator.next().value[0]",
  },
];

const getSetup = (body: string): string => `
  var reference;
  function create() {
    const target = { value: 7, read() { return this; } };
    reference = new WeakRef(target);
    return target;
  }
  function first(value) { return value; }
  function Holder(value) { this.retained = value; }
  function* inner() { return [create(), yield 'pause']; }
  function* run() { ${body} }
  var iterator = run();
  iterator.next();
`;

it.each(fixtures)("retains a suspended $name", async ({ body, result }) => {
  const setup = getSetup(body);
  const observation = `JSON.stringify([reference.deref() !== undefined, ${result} === reference.deref()])`;
  const expected = getNativeGcObservation(setup, observation);
  expect(expected).toBe("[true,true]");
  await withFixture(({ api, evaluate, readString }) => {
    evaluate(setup);
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString(observation)).toBe(expected);
    evaluate("iterator = undefined");
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(readString("String(reference.deref() === undefined)")).toBe("true");
  });
});

it("retains temporaries during Agent-driven execution", async () => {
  await withFixture(({ api, realm, readString }) => {
    const agent = api.surroundingAgent;
    let collections = 0;
    agent.hostDefinedOptions.onNodeEvaluation = (node) => {
      if (node.type !== "CallExpression" || node.sourceText !== "collect()") return;
      agent.AgentRecord.KeptAlive.clear();
      api.gc();
      collections++;
    };
    const compiled = api.EnsureCompletion(
      realm.compileScript(`
      var reference, retained;
      function create() { const target = {}; reference = new WeakRef(target); return target; }
      function collect() {}
      retained = [create(), collect()];
    `),
    );
    if (compiled.Type !== "normal") throw new Error("Expected a compiled script");
    let isFinished = false;
    agent.evaluate(api.ScriptEvaluation(compiled.Value), (completion) => {
      expect(completion.Type).toBe("normal");
      isFinished = true;
    });
    expect(isFinished).toBe(true);
    expect(collections).toBe(1);
    expect(readString("String(retained[0] === reference.deref())")).toBe("true");
  });
});

it("does not finalize a partial array held by a suspended generator", async () => {
  await withFixture(({ api, evaluate }) => {
    evaluate(`${getSetup("return [create(), yield 'pause'];")}
      var registry = new FinalizationRegistry(() => {});
      registry.register(reference.deref(), 'held');
    `);
    api.surroundingAgent.AgentRecord.KeptAlive.clear();
    api.gc();
    expect(api.surroundingAgent.finalizationRegistryScheduledForCleanup.size).toBe(0);
  });
});

it("retains an Agent-owned debugger suspension and releases the completed evaluator", async () => {
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  const agent = new api.Agent({ startEventLoop: false, onDebugger: () => {} });
  api.setSurroundingAgent(agent);
  try {
    const realm = new api.ManagedRealm();
    const compiled = api.EnsureCompletion(
      realm.compileScript(`
      var reference, retained;
      function create() { const target = {}; reference = new WeakRef(target); return target; }
      function pause() { debugger; }
      retained = [create(), pause()];
    `),
    );
    if (compiled.Type !== "normal") throw new Error("Expected a compiled script");
    let isFinished = false;
    agent.evaluate(api.ScriptEvaluation(compiled.Value), (completion) => {
      expect(completion.Type).toBe("normal");
      isFinished = true;
    });
    expect(agent.isPaused()).toBe(true);
    expect(isFinished).toBe(false);
    agent.AgentRecord.KeptAlive.clear();
    api.gc();
    const before = api.EnsureCompletion(
      realm.evaluateScriptSkipDebugger("reference.deref() !== undefined"),
    );
    expect(before.Value).toBe(api.Value.true);
    agent.resumeEvaluate();
    expect(isFinished).toBe(true);
    expect(agent.isPaused()).toBe(false);
    const after = api.EnsureCompletion(
      realm.evaluateScriptSkipDebugger("retained[0] === reference.deref()"),
    );
    expect(after.Value).toBe(api.Value.true);
    realm.evaluateScriptSkipDebugger("retained = undefined");
    const pop = realm.pushTopContext();
    try {
      agent.AgentRecord.KeptAlive.clear();
      api.gc();
      const released = api.EnsureCompletion(
        realm.evaluateScriptSkipDebugger("reference.deref() === undefined"),
      );
      expect(released.Value).toBe(api.Value.true);
    } finally {
      pop?.();
    }
  } finally {
    api.setSurroundingAgent(previous);
  }
});
