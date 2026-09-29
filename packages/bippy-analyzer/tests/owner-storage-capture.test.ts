import { expect, it } from "vite-plus/test";
import type { StateCheckpoint, DataGraphCheckpoint } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";

it.each([false, true])(
  "captures storage inside an Agent owner callback, transitive=%s",
  async (transitive) => {
    await withAbstractFixture(({ api, agent, realm, compile, evaluate, createBoolean }) => {
      evaluate(`
        var root = Object.create(null);
        root.value = 1;
      `);
      createBoolean("enabled");
      const root = realm.GlobalObject.properties.get(api.Value("root"))?.Value;
      if (!(root instanceof api.ObjectValue)) throw Error("Expected root");
      agent.evaluate(
        compile(`
          root.value += enabled ? 1 : 2;
          root.value;
        `),
        () => {},
        false,
      );
      const step = agent.resumeEvaluate({ pauseOnAbstractBoolean: true });
      if (step.done || !step.value) throw Error("Expected decision");
      const contexts = [...agent.executionContextStack];
      let storage: StateCheckpoint | DataGraphCheckpoint | undefined;
      const control = agent.captureEvaluation({
        capture: () => {
          const checkpoint = transitive
            ? api.createDataGraphCheckpoint({ roots: [root] })
            : api.createStateCheckpoint({ objects: [root] });
          storage = checkpoint;
          expect(() => root.properties.entries().next()).toThrow(
            "Cannot resume during a control checkpoint",
          );
          return {
            restore: () => {
              checkpoint.restore();
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
        for (const choice of [false, true]) {
          control.restore();
          const result = agent.resumeEvaluate({
            abstractBooleanDecision: {
              resume: "abstract-boolean",
              decision: step.value,
              value: choice,
            },
          });
          if (!result.done) throw Error("Expected completion");
          expect(api.EnsureCompletion(result.value).Value).toEqual(api.Value(choice ? 2 : 3));
        }
      } finally {
        control.release();
        storage?.release();
      }
    });
  },
);
