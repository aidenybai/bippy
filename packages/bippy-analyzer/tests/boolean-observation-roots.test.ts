import { expect, it } from "vite-plus/test";
import { createBooleanSnapshotExplorer } from "../src/index.js";
import { withAbstractFixture } from "./helpers/abstract-fixture.js";

it.each([false, true])(
  "retains a returned completion while observing, throw=%s",
  async (isThrow) => {
    const explorer = await createBooleanSnapshotExplorer();
    await withAbstractFixture(({ api, agent, realm, compile }) => {
      agent.evaluate(
        compile(`
        var reference;
        (() => {
          const target = {};
          reference = new WeakRef(target);
          ${isThrow ? "throw target" : "return target"};
        })();
      `),
        () => {},
        false,
      );
      const report = explorer.explore({
        agent,
        inputs: [],
        createOwner: () => {
          throw new Error("Unexpected fork");
        },
        observe: (completion) => {
          const reference = realm.GlobalObject.properties.get(api.Value("reference"))?.Value;
          if (!reference || !api.isWeakRef(reference)) throw new Error("Expected WeakRef");
          expect(completion.Type).toBe(isThrow ? "throw" : "normal");
          agent.AgentRecord.KeptAlive.clear();
          api.gc();
          expect(reference.WeakRefTarget === completion.Value).toBe(true);
          return { kind: "commit", snapshot: '"retained"' };
        },
      });
      expect(report.execution).toBe("not-verified");
      expect(report.exploration.forks).toBe(0);
      const reference = realm.GlobalObject.properties.get(api.Value("reference"))?.Value;
      if (!reference || !api.isWeakRef(reference)) throw new Error("Expected WeakRef");
      agent.AgentRecord.KeptAlive.clear();
      api.gc();
      expect(reference.WeakRefTarget).toBeUndefined();
    });
  },
);

it.each(["return", "observer-error", "snapshot-error"])(
  "roots through outcome copying and releases after %s",
  async (mode) => {
    const explorer = await createBooleanSnapshotExplorer();
    await withAbstractFixture(({ api, agent, realm, compile }) => {
      agent.evaluate(
        compile(
          "var reference; (() => { const target = {}; reference = new WeakRef(target); return target; })()",
        ),
        () => {},
        false,
      );
      const failure = new Error("observation failed");
      let caught: unknown;
      try {
        explorer.explore({
          agent,
          inputs: [],
          createOwner: () => {
            throw new Error("Unexpected fork");
          },
          observe: (completion) => {
            const getSnapshot = () => {
              const reference = realm.GlobalObject.properties.get(api.Value("reference"))?.Value;
              if (!reference || !api.isWeakRef(reference)) throw new Error("Expected WeakRef");
              agent.AgentRecord.KeptAlive.clear();
              api.gc();
              expect(reference.WeakRefTarget === completion.Value).toBe(true);
              if (mode !== "return") throw failure;
              return '"retained"';
            };
            if (mode === "observer-error") getSnapshot();
            return {
              kind: "commit",
              get snapshot() {
                return getSnapshot();
              },
            };
          },
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(mode === "return" ? undefined : failure);
      const reference = realm.GlobalObject.properties.get(api.Value("reference"))?.Value;
      if (!reference || !api.isWeakRef(reference)) throw new Error("Expected WeakRef");
      agent.AgentRecord.KeptAlive.clear();
      api.gc();
      expect(reference.WeakRefTarget).toBeUndefined();
    });
  },
);

it.each([false, true])(
  "retains branch results during observation, trueFirst=%s",
  async (trueFirst) => {
    const explorer = await createBooleanSnapshotExplorer();
    await withAbstractFixture(({ api, agent, realm, createBoolean, compile }) => {
      const enabled = createBoolean("enabled");
      const observed: boolean[] = [];
      let prefixes = 0;
      agent.hostDefinedOptions.onNodeEvaluation = (node) => {
        if (node.type === "UpdateExpression" && node.sourceText === "prefix++") prefixes++;
      };
      agent.evaluate(
        compile(`
      var prefix = 0, reference;
      prefix++;
      var selected = enabled ? true : false;
      (() => { const target = { selected }; reference = new WeakRef(target); return target; })();
    `),
        () => {},
        false,
      );
      const report = explorer.explore({
        agent,
        inputs: [{ name: "enabled", value: enabled }],
        trueFirst,
        createOwner: () => {
          const contexts = [...agent.executionContextStack];
          const storage = api.createStateCheckpoint({
            objects: [realm.GlobalObject],
            environments: [realm.GlobalEnv.DeclarativeRecord],
          });
          return {
            capture: () => ({
              restore: () => {
                storage.restore();
                agent.executionContextStack.splice(
                  0,
                  agent.executionContextStack.length,
                  ...contexts,
                );
              },
            }),
            release: () => storage.release(),
          };
        },
        observe: (completion) => {
          const reference = realm.GlobalObject.properties.get(api.Value("reference"))?.Value;
          if (
            !reference ||
            !api.isWeakRef(reference) ||
            !(completion.Value instanceof api.ObjectValue)
          )
            throw new Error("Expected target");
          agent.AgentRecord.KeptAlive.clear();
          api.gc();
          expect(reference.WeakRefTarget === completion.Value).toBe(true);
          const selected = completion.Value.properties.get(api.Value("selected"))?.Value;
          observed.push(selected === api.Value.true);
          return { kind: "commit", snapshot: JSON.stringify(String(selected === api.Value.true)) };
        },
      });
      expect(prefixes).toBe(1);
      expect(observed).toEqual(trueFirst ? [true, false] : [false, true]);
      expect(report.exploration.forks).toBe(1);
      expect(report.exploration.resumes).toBe(3);
      expect(report.execution).toBe("not-verified");
    });
  },
);
