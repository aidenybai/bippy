import * as published from "@engine262/engine262";
import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { withFixture } from "./helpers/engine-fixture.js";

it("executes maintained algorithms through measured control frames", async () => {
  await withFixture(({ api, evaluate }) => {
    const measured = api.measureSynchronousExecution(() => evaluate("1 + 2 * 3"));
    expect(api.SameValue(measured.value, api.Value(7))).toBe(true);
    expect(measured.metrics.framesCreated).toBeGreaterThan(1);
    expect(measured.metrics.peakFrames).toBeGreaterThan(1);
  });
});

interface Branch {
  enabled: boolean;
  fail: boolean;
}
interface Observation {
  completion: string;
  value: number;
  count: number;
  prefix: number;
}
const branches: Branch[] = [
  { enabled: false, fail: false },
  { enabled: true, fail: false },
  { enabled: false, fail: true },
  { enabled: true, fail: true },
];
const getSource = ({ enabled, fail }: Branch): string => `
  var prefixRuns = 0; prefixRuns++;
  var shared = { count: 0 }; var alias = shared;
  let enabled = ${enabled}; let fail = ${fail};
  debugger;
  try {
    if (enabled) shared.count++;
    if (fail) throw shared.count;
    shared.count;
  } finally { alias.count += 10; }
`;

const getNativeObservation = (source: string): Observation => {
  const globals = { shared: { count: -1 }, prefixRuns: -1 };
  try {
    const value: unknown = runInNewContext(source, globals, { timeout: 10000 });
    if (typeof value !== "number") throw new Error("Expected a native number");
    return { completion: "normal", value, count: globals.shared.count, prefix: globals.prefixRuns };
  } catch (value) {
    if (typeof value !== "number") throw value;
    return { completion: "throw", value, count: globals.shared.count, prefix: globals.prefixRuns };
  }
};

const getPublishedObservation = (source: string): Observation => {
  const previous = published.surroundingAgent;
  published.setSurroundingAgent(new published.Agent({ startEventLoop: false }));
  try {
    const realm = new published.ManagedRealm();
    const completion = published.EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    const result = published.EnsureCompletion(
      realm.evaluateScriptSkipDebugger("JSON.stringify([shared.count, prefixRuns])"),
    );
    if (
      completion.Value.type !== "Number" ||
      result.Type !== "normal" ||
      result.Value.type !== "String"
    )
      throw new Error("Expected published observations");
    const [count, prefix]: number[] = JSON.parse(result.Value.stringValue());
    return { completion: completion.Type, value: completion.Value.numberValue(), count, prefix };
  } finally {
    published.setSurroundingAgent(previous);
  }
};

it.each([{ order: branches }, { order: [...branches].reverse() }])(
  "resumes branch completions with selected state: $order",
  async ({ order }) => {
    const { api } = await getSymbolicEngine();
    const previous = api.surroundingAgent;
    let prefixVisits = 0;
    const agent = new api.Agent({
      startEventLoop: false,
      onDebugger: () => {},
      onNodeEvaluation: (node) => {
        if (node.type === "UpdateExpression" && node.sourceText === "prefixRuns++") prefixVisits++;
      },
    });
    api.setSurroundingAgent(agent);
    try {
      const realm = new api.ManagedRealm();
      const compiled = api.EnsureCompletion(
        realm.compileScript(getSource({ enabled: false, fail: false })),
      );
      if (compiled.Type !== "normal") throw new Error("Expected a compiled script");
      const iterator = api.ScriptEvaluation(compiled.Value);
      let step = iterator.next();
      while (!step.done && step.value.suspend !== "debugger")
        step = iterator.next({ resume: "debugger", value: undefined });
      expect(step.done).toBe(false);
      if (!(realm.GlobalEnv instanceof api.GlobalEnvironmentRecord))
        throw new Error("Expected a global environment");
      const shared = api.EnsureCompletion(realm.evaluateScriptSkipDebugger("shared"));
      if (shared.Type !== "normal" || !api.isOrdinaryObject(shared.Value))
        throw new Error("Expected a shared ordinary object");
      const contexts = [...agent.executionContextStack];
      const state = api.createStateCheckpoint({
        objects: [shared.Value],
        environments: [realm.GlobalEnv.DeclarativeRecord],
      });
      try {
        const checkpoint = api.captureControl(iterator, {
          capture: () => ({
            restore: () => {
              state.restore();
              agent.executionContextStack.splice(
                0,
                agent.executionContextStack.length,
                ...contexts,
              );
            },
          }),
        });
        for (const branch of order) {
          checkpoint.restore();
          realm.evaluateScriptSkipDebugger(`enabled = ${branch.enabled}; fail = ${branch.fail};`);
          const completion = api.EnsureCompletion(api.skipDebugger(iterator));
          const result = api.EnsureCompletion(
            realm.evaluateScriptSkipDebugger("JSON.stringify([shared.count, prefixRuns])"),
          );
          if (
            completion.Value.type !== "Number" ||
            result.Type !== "normal" ||
            result.Value.type !== "String"
          )
            throw new Error("Expected branch observations");
          const [count, prefix]: number[] = JSON.parse(result.Value.stringValue());
          const observation = {
            completion: completion.Type,
            value: completion.Value.numberValue(),
            count,
            prefix,
          };
          expect(observation).toEqual(getNativeObservation(getSource(branch)));
          expect(observation).toEqual(getPublishedObservation(getSource(branch)));
        }
        expect(prefixVisits).toBe(1);
      } finally {
        state.release();
      }
    } finally {
      api.setSurroundingAgent(previous);
    }
  },
);
