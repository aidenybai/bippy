import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import type { IteratorRecord, StateCheckpoint } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";

it.each(
  [false, true].flatMap((isReversed) =>
    [false, true].flatMap((isAssignment) =>
      [false, true].map((isThrowing) => ({ isReversed, isAssignment, isThrowing })),
    ),
  ),
)(
  "restores iterator exhaustion and close: assignment=$isAssignment reversed=$isReversed throwing=$isThrowing",
  async ({ isReversed, isAssignment, isThrowing }) => {
    const initializer = isThrowing
      ? 'enabled ? (() => { throw "failure"; })() : 22'
      : "enabled ? 11 : 22";
    const source = `
    var prefix = 0, cursor = 0, calls = 0, closes = 0, first, rest, failure;
    var iterator = {
      next() { calls++; return cursor++ < 2 ? { value: undefined, done: false } : { done: true }; },
      return() { closes++; return { done: true }; },
      [Symbol.iterator]() { return this; }
    };
    prefix++;
    try { ${isAssignment ? "" : "var "}[first = ${initializer}, ...rest] = iterator; } catch (error) { failure = error; }
    JSON.stringify([first, rest, calls, closes, prefix, failure]);
  `;
    await withAbstractFixture(({ api, agent, realm, compile, createBoolean }) => {
      createBoolean("enabled");
      let prefixes = 0;
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.type === "UpdateExpression" && node.sourceText === "prefix++") prefixes++;
      };
      const observations: string[] = [];
      agent.evaluate(
        compile(source),
        (completion) => {
          if (!(completion.Value instanceof api.JSStringValue)) throw Error("Expected observation");
          observations.push(completion.Value.stringValue());
        },
        false,
      );
      const pause = agent.resumeEvaluate({ pauseOnAbstractBoolean: true, noBreakpoint: true });
      if (pause.done || !pause.value) throw Error("Expected decision");
      const records = new Set<IteratorRecord>();
      const contexts = [...agent.executionContextStack];
      let storage: StateCheckpoint | undefined;
      const isIteratorRecord = (value: object): value is IteratorRecord =>
        "Iterator" in value &&
        "NextMethod" in value &&
        "Done" in value &&
        value.Iterator instanceof api.ObjectValue &&
        value.NextMethod instanceof api.Value &&
        typeof value.Done === "boolean";
      const saved = agent.captureEvaluation({
        references: (value) => {
          if (isIteratorRecord(value)) records.add(value);
          return [];
        },
        capture: () => {
          expect(records.size).toBe(1);
          const state = api.createStateCheckpoint({
            objects: [realm.GlobalObject],
            environments: [realm.GlobalEnv],
            iteratorRecords: [...records],
          });
          storage = state;
          return {
            restore: () => {
              state.restore();
              agent.executionContextStack.splice(
                0,
                agent.executionContextStack.length,
                ...contexts,
              );
            },
          };
        },
      });
      try {
        for (const choice of isReversed ? [true, false] : [false, true]) {
          saved.restore();
          agent.AgentRecord.KeptAlive.clear();
          api.gc();
          expect(
            agent.resumeEvaluate({
              abstractBooleanDecision: {
                resume: "abstract-boolean",
                decision: pause.value,
                value: choice,
              },
            }).done,
          ).toBe(true);
          expect(observations.at(-1)).toBe(runInNewContext(source, { enabled: choice }));
        }
        expect(prefixes).toBe(1);
        expect(storage?.iteratorRecordCount).toBe(1);
      } finally {
        saved.release();
        storage?.release();
      }
    });
  },
);
