import { beforeAll, expect, it } from "vite-plus/test";
import { createConcreteRuntime } from "../src/concrete/runtime.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { buildScriptFixture } from "./helpers/build-script-fixture.js";
import { createNativeRuntime } from "./helpers/native-runtime.js";

let source: string;
beforeAll(async () => {
  const chunk = await buildScriptFixture(
    new URL("./fixtures/symbolic-react-tree.tsx", import.meta.url),
    "production",
  );
  source = chunk.code;
});

it.each([false, true].flatMap((enabled) => [false, true].map((details) => ({ enabled, details }))))(
  "specializes a real React tree with correlated Boolean decisions, enabled=$enabled details=$details",
  async ({ enabled, details }) => {
    const runtime = await createConcreteRuntime();
    const native = createNativeRuntime();
    const { api } = await getSymbolicEngine();
    try {
      runtime.evaluate(source);
      native.evaluate(source);
      expect(runtime.readString("JSON.stringify(fixture.versions)")).toBe('["19.3.0","19.3.0"]');
      runtime.evaluate("fixture.mount()");
      native.evaluate("fixture.mount()");
      runtime.drainJobs();
      native.drainJobs();
      expect(runtime.readString("fixture.observe()")).toBe(native.evaluate("fixture.observe()"));
      const previous = api.surroundingAgent;
      api.setSurroundingAgent(runtime.agent);
      let enabledDecisions = 0;
      let detailsDecisions = 0;
      try {
        const enabledInput = api.BooleanValue.createAbstract();
        const detailsInput = api.BooleanValue.createAbstract();
        api.X(api.CreateDataPropertyOrThrow(runtime.realm.GlobalObject, "enabled", enabledInput));
        api.X(api.CreateDataPropertyOrThrow(runtime.realm.GlobalObject, "details", detailsInput));
        const compiled = api.EnsureCompletion(
          runtime.realm.compileScript(`
          fixture.update(enabled, details);
          fixture.observe();
        `),
        );
        if (compiled.Type !== "normal") throw Error("Expected compiled update");
        runtime.agent.evaluate(api.ScriptEvaluation(compiled.Value), () => {}, false);
        let step = runtime.agent.resumeEvaluate({
          pauseOnAbstractBoolean: true,
          noBreakpoint: true,
        });
        while (!step.done) {
          const decision = step.value;
          if (!decision) throw Error("Unexpected debugger pause");
          if (enabledDecisions + detailsDecisions >= 16)
            throw Error("Unexpected decision expansion");
          let choice: boolean;
          if (decision.value === enabledInput) {
            enabledDecisions++;
            choice = enabled;
          } else if (decision.value === detailsInput) {
            detailsDecisions++;
            choice = details;
          } else {
            throw Error("Decision lost input identity");
          }
          runtime.agent.AgentRecord.KeptAlive.clear();
          api.gc();
          step = runtime.agent.resumeEvaluate({
            abstractBooleanDecision: { resume: "abstract-boolean", decision, value: choice },
            noBreakpoint: true,
          });
        }
        const completion = api.EnsureCompletion(step.value);
        expect(completion.Type).toBe("normal");
        if (!(completion.Value instanceof api.JSStringValue))
          throw Error("Expected committed tree observation");
        native.evaluate(`fixture.update(${enabled}, ${details})`);
        expect(completion.Value.stringValue()).toBe(native.evaluate("fixture.observe()"));
      } finally {
        api.setSurroundingAgent(previous);
      }
      expect(enabledDecisions).toBe(details ? 4 : 3);
      expect(detailsDecisions).toBe(1);
      runtime.drainJobs();
      native.drainJobs();
      const observation = runtime.readString("fixture.observe()");
      expect(observation).toBe(native.evaluate("fixture.observe()"));
      const label = enabled ? "Enabled" : "Disabled";
      const events = ["commit:Disabled:0", "cleanup:Disabled:0", `commit:${label}:0`];
      expect(JSON.parse(observation)).toEqual({
        renders: 2,
        events,
        tree: {
          type: "section",
          props: { "data-status": enabled ? "enabled" : "disabled" },
          children: [
            { type: "h1", props: {}, children: [label] },
            { type: "button", props: { disabled: !enabled }, children: ["0"] },
            ...(details
              ? [
                  {
                    type: "aside",
                    props: {},
                    children: [
                      {
                        type: enabled ? "strong" : "span",
                        props: {},
                        children: [enabled ? "Active details" : "Inactive details"],
                      },
                    ],
                  },
                ]
              : []),
          ],
        },
      });
      runtime.evaluate("fixture.unmount()");
      native.evaluate("fixture.unmount()");
      runtime.drainJobs();
      native.drainJobs();
      expect(runtime.readString("fixture.observe()")).toBe(native.evaluate("fixture.observe()"));
      expect(JSON.parse(runtime.readString("fixture.observe()"))).toEqual({
        renders: 2,
        events: [...events, `cleanup:${label}:0`],
        tree: null,
      });
      expect(runtime.unhandledRejections.size).toBe(0);
      expect(runtime.uncaughtExceptions).toEqual([]);
    } finally {
      runtime.dispose();
    }
  },
);
