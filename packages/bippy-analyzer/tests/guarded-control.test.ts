import * as published from "@engine262/engine262";
import { createContext, runInContext, runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { BooleanValue } from "../engine/dist/declaration/index.mjs";
import type { NumericExpression } from "../src/index.js";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";
import { getExpressionSource } from "./helpers/numeric-expression.js";

interface GuardedObservation {
  guard: Record<string, boolean>;
  completion: "normal" | "throw";
  value: NumericExpression;
  count: NumericExpression;
  deferred: NumericExpression;
  prefix: number;
  conditionReads: number;
  sameObject: boolean;
}
interface ConcreteObservation {
  completion: string;
  value: string;
  count: string;
  deferred: string;
  prefix: number;
  conditionReads: number;
  sameObject: boolean;
}

const source = `
  let prefixRuns=0;prefixRuns++;let conditionReads=0;
  let shared={count:amount};let alias=shared;let scheduled;
  const schedule=(callback)=>{scheduled=callback;};
  const getEnabled=()=>{conditionReads++;return enabled;};
  try {
    if(getEnabled()) shared.count=shared.count+1;
    if(enabled) alias.count=shared.count;
    schedule(()=>alias.count);
    if(fail) throw shared.count;
    shared.count;
  } finally { shared.count=shared.count+10; }
`;
const stateSource = `JSON.stringify({
  count:Object.is(shared.count,-0)?'-0':String(shared.count),
  deferred:Object.is(scheduled(),-0)?'-0':String(scheduled()),
  prefix:prefixRuns,conditionReads,sameObject:alias===shared
})`;
const getNumberText = (value: number): string => (Object.is(value, -0) ? "-0" : String(value));

const getNativeObservation = (
  amount: number,
  guard: Record<string, boolean>,
): ConcreteObservation => {
  const context = createContext({ amount, ...guard });
  let completion = "normal";
  let value: unknown;
  try {
    value = runInContext(source, context, { timeout: 1000 });
  } catch (error) {
    completion = "throw";
    value = error;
  }
  if (typeof value !== "number") throw new Error("Expected a native numeric completion");
  const state: unknown = runInContext(stateSource, context, { timeout: 1000 });
  if (typeof state !== "string") throw new Error("Expected native state text");
  return { completion, value: getNumberText(value), ...JSON.parse(state) };
};

const getPublishedObservation = (
  amount: number,
  guard: Record<string, boolean>,
): ConcreteObservation => {
  const previous = published.surroundingAgent;
  published.setSurroundingAgent(new published.Agent({ startEventLoop: false }));
  try {
    const realm = new published.ManagedRealm();
    const result = published.EnsureCompletion(
      realm.evaluateScriptSkipDebugger(
        `var amount=${getNumberText(amount)},enabled=${guard.enabled},fail=${guard.fail};${source}`,
      ),
    );
    const state = published.EnsureCompletion(realm.evaluateScriptSkipDebugger(stateSource));
    if (
      !(result.Value instanceof published.NumberValue) ||
      state.Type !== "normal" ||
      !(state.Value instanceof published.JSStringValue)
    )
      throw new Error("Expected published numeric observations");
    return {
      completion: result.Type,
      value: getNumberText(result.Value.numberValue()),
      ...JSON.parse(state.Value.stringValue()),
    };
  } finally {
    published.setSurroundingAgent(previous);
  }
};

const getSpecialized = (expression: NumericExpression, amount: number): string => {
  const value: unknown = runInNewContext(
    getExpressionSource(expression),
    { inputs: { amount } },
    { timeout: 1000 },
  );
  if (typeof value !== "number") throw new Error("Expected a numeric specialization");
  return getNumberText(value);
};

it.each([false, true])(
  "forks actual unknown decisions with unbounded amounts and selected state, reversed=%s",
  async (isReversed) => {
    const observations: GuardedObservation[] = [];
    let prefixVisits = 0;
    let forks = 0;
    let reusedDecisions = 0;
    await withAbstractFixture(
      ({ api, agent, realm, domain, createBoolean, compile, evaluate, getNumber }) => {
        const names = new Map<BooleanValue, string>();
        for (const name of ["enabled", "fail", "unused"]) names.set(createBoolean(name), name);
        agent.hostDefinedOptions.onNodeEvaluation = (node) => {
          if (node.type === "UpdateExpression" && node.sourceText === "prefixRuns++")
            prefixVisits++;
        };
        const iterator = compile(source);
        const visit = (
          initialStep: ReturnType<typeof iterator.next>,
          assignments: ReadonlyMap<BooleanValue, boolean>,
        ): void => {
          let step = initialStep;
          while (!step.done && step.value.suspend !== "abstract-boolean") {
            if (step.value.suspend !== "debugger" && step.value.suspend !== "potential-debugger")
              throw new Error("Unsupported suspension in selected-state fixture");
            step = iterator.next({ resume: "debugger", value: undefined });
          }
          if (step.done) {
            const completion = api.EnsureCompletion(step.value);
            if (!(completion.Value instanceof api.NumberValue))
              throw new Error("Expected a numeric completion");
            observations.push({
              guard: Object.fromEntries(
                [...assignments].map(([input, choice]) => {
                  const name = names.get(input);
                  if (!name) throw new Error("Unknown decision input");
                  return [name, choice];
                }),
              ),
              completion: completion.Type,
              value: domain.getExpression(completion.Value),
              count: domain.getExpression(getNumber("shared.count")),
              deferred: domain.getExpression(getNumber("scheduled()")),
              prefix: getNumber("prefixRuns").numberValue(),
              conditionReads: getNumber("conditionReads").numberValue(),
              sameObject: evaluate("alias === shared").Value === api.Value.true,
            });
            return;
          }
          const decision = step.value;
          if (decision.suspend !== "abstract-boolean")
            throw new Error("Expected a Boolean decision");
          const existing = assignments.get(decision.value);
          if (existing !== undefined) {
            reusedDecisions++;
            visit(
              iterator.next({ resume: "abstract-boolean", decision, value: existing }),
              assignments,
            );
            return;
          }
          if (++forks > 3) throw new Error("Unexpected decision expansion");
          const shared = evaluate("shared");
          if (
            shared.Type !== "normal" ||
            !api.isOrdinaryObject(shared.Value) ||
            !(realm.GlobalEnv instanceof api.GlobalEnvironmentRecord)
          )
            throw new Error("Expected selected state");
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
            for (const choice of isReversed ? [true, false] : [false, true]) {
              checkpoint.restore();
              const branch = new Map(assignments);
              branch.set(decision.value, choice);
              visit(iterator.next({ resume: "abstract-boolean", decision, value: choice }), branch);
            }
          } finally {
            state.release();
          }
        };
        visit(iterator.next(), new Map());
      },
    );
    expect(prefixVisits).toBe(1);
    expect(forks).toBe(3);
    expect(reusedDecisions).toBe(2);
    expect(observations).toHaveLength(4);
    expect(new Set(observations.map(({ guard }) => JSON.stringify(guard))).size).toBe(4);
    const witnesses = [
      NaN,
      Infinity,
      -Infinity,
      -0,
      0,
      1,
      Number.MIN_VALUE,
      Number.MAX_VALUE,
      2 ** 53,
    ];
    for (const observation of observations) {
      expect(Object.keys(observation.guard)).toEqual(["enabled", "fail"]);
      expect(observation.prefix).toBe(1);
      expect(observation.conditionReads).toBe(1);
      expect(observation.sameObject).toBe(true);
      expect(getExpressionSource(observation.value)).toBe(
        observation.guard.enabled ? '((inputs["amount"])+(1))' : 'inputs["amount"]',
      );
      expect(getExpressionSource(observation.count)).toBe(
        observation.guard.enabled
          ? '((((inputs["amount"])+(1)))+(10))'
          : '((inputs["amount"])+(10))',
      );
      expect(observation.deferred).toEqual(observation.count);
      for (const amount of witnesses) {
        const concrete = {
          completion: observation.completion,
          value: getSpecialized(observation.value, amount),
          count: getSpecialized(observation.count, amount),
          deferred: getSpecialized(observation.deferred, amount),
          prefix: observation.prefix,
          conditionReads: observation.conditionReads,
          sameObject: observation.sameObject,
        };
        expect(concrete).toEqual(getNativeObservation(amount, observation.guard));
        expect(concrete).toEqual(getPublishedObservation(amount, observation.guard));
      }
    }
  },
);
