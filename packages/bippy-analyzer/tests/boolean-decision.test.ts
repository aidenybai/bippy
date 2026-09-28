import { expect, it } from "vite-plus/test";
import type { EvaluatorYieldType_AbstractBoolean } from "../engine/dist/declaration/index.mjs";
import { withAbstractFixture, type AbstractFixture } from "./helpers/abstract-fixture.js";

const getDecision = (
  iterator: ReturnType<AbstractFixture["compile"]>,
): EvaluatorYieldType_AbstractBoolean => {
  let step = iterator.next();
  while (!step.done) {
    if (step.value.suspend === "abstract-boolean") return step.value;
    if (step.value.suspend !== "debugger" && step.value.suspend !== "potential-debugger")
      throw new Error("Unexpected suspension");
    step = iterator.next({ resume: "debugger", value: undefined });
  }
  throw new Error("Expected an abstract Boolean decision");
};

it.each([false, true])(
  "suspends after the condition once, then selects an if branch: %s",
  async (choice) => {
    await withAbstractFixture(({ api, createBoolean, compile, evaluate, getNumber }) => {
      const input = createBoolean("enabled");
      const iterator = compile(
        "var reads=0;function read(){reads++;return enabled;} if(read()) 11;else 22;",
      );
      const decision = getDecision(iterator);
      expect(decision.value).toBe(input);
      expect(Object.isFrozen(decision)).toBe(true);
      expect(getNumber("reads").numberValue()).toBe(1);
      const step = iterator.next({ resume: "abstract-boolean", decision, value: choice });
      if (!step.done) throw new Error("Expected completion");
      const completion = api.EnsureCompletion(step.value);
      expect(completion.Value).toEqual(api.Value(choice ? 11 : 22));
      expect(getNumber("reads").numberValue()).toBe(1);
      expect(evaluate("enabled").Value).toBe(input);
    });
  },
);

it.each([false, true])("preserves if-without-else completion: %s", async (choice) => {
  await withAbstractFixture(({ api, createBoolean, compile }) => {
    createBoolean("enabled");
    const iterator = compile("if(enabled) 17;");
    const decision = getDecision(iterator);
    const step = iterator.next({ resume: "abstract-boolean", decision, value: choice });
    if (!step.done) throw new Error("Expected completion");
    expect(api.EnsureCompletion(step.value).Value).toEqual(
      choice ? api.Value(17) : api.Value.undefined,
    );
  });
});

it.each([false, true])("forwards a decision through a guest generator: %s", async (choice) => {
  await withAbstractFixture(({ api, createBoolean, compile }) => {
    createBoolean("enabled");
    const iterator = compile("function* run(){if(enabled) return 1;return 2;}run().next().value;");
    const decision = getDecision(iterator);
    let step = iterator.next({ resume: "abstract-boolean", decision, value: choice });
    while (!step.done) {
      if (step.value.suspend !== "debugger" && step.value.suspend !== "potential-debugger")
        throw new Error(`Unexpected suspension: ${step.value.suspend}`);
      step = iterator.next({ resume: "debugger", value: undefined });
    }
    expect(api.EnsureCompletion(step.value).Value).toEqual(api.Value(choice ? 1 : 2));
  });
});

it("preserves abstract Boolean identity and type without a concrete payload", async () => {
  await withAbstractFixture(({ api, createBoolean, evaluate }) => {
    const input = createBoolean("enabled");
    expect(api.BooleanValue.isAbstract(input)).toBe(true);
    expect(api.BooleanValue.isAbstract(api.Value.true)).toBe(false);
    expect(Object.isFrozen(input)).toBe(true);
    expect(() => input.value).toThrow("Unsupported concrete read of abstract Boolean");
    expect(() => input.booleanValue()).toThrow("Unsupported concrete read of abstract Boolean");
    expect(() => JSON.stringify(input)).toThrow("Unsupported concrete read of abstract Boolean");
    expect(evaluate("typeof enabled").Value).toEqual(api.Value("boolean"));
    expect(evaluate("Boolean.prototype.valueOf.call(enabled)").Value).toBe(input);
    expect(evaluate("enabled === 1").Value).toBe(api.Value.false);
  });
});

it.each([
  "Boolean(enabled)",
  "Number(enabled)",
  "BigInt(enabled)",
  "String(enabled)",
  "JSON.stringify(enabled)",
  "JSON.stringify({value:enabled})",
  "enabled === enabled",
  "Object.is(enabled, enabled)",
  "enabled == true",
  "enabled + 1",
  "let value=enabled;value &&= 2;",
  "let value=enabled;value ||= 2;",
  "for(;enabled;) break;",
  "do{}while(enabled);",
  "while(enabled) break;",
  "Object(enabled)",
  "Boolean.prototype.toString.call(enabled)",
  "new Map([[enabled,1]]).has(enabled)",
  "Object.defineProperty({}, 'value', {writable:enabled})",
])("rejects unsupported Boolean consumption rather than choosing false: %s", async (source) => {
  await withAbstractFixture(({ createBoolean, evaluate }) => {
    createBoolean("enabled");
    expect(() => evaluate(source)).toThrow("Unsupported concrete read of abstract Boolean");
  });
});

it.each(["debugger", "clone", "missing", "value", "empty"])(
  "rejects an invalid resume: %s",
  async (kind) => {
    await withAbstractFixture(({ api, createBoolean, compile }) => {
      createBoolean("enabled");
      const iterator = compile("if(enabled) 1;else 2;");
      const decision = getDecision(iterator);
      const response =
        kind === "empty"
          ? undefined
          : kind === "debugger"
            ? { resume: "debugger", value: undefined }
            : {
                resume: "abstract-boolean",
                decision:
                  kind === "clone" ? { ...decision } : kind === "missing" ? undefined : decision,
                value: kind === "value" ? api.Value.true : true,
              };
      expect(() => Reflect.apply(iterator.next, iterator, [response])).toThrow(
        "Invalid abstract Boolean decision response",
      );
    });
  },
);

it("reads and validates the resume choice once", async () => {
  await withAbstractFixture(({ api, createBoolean, compile }) => {
    createBoolean("enabled");
    const iterator = compile("if(enabled) 11;else 22;");
    const decision = getDecision(iterator);
    let reads = 0;
    const step = iterator.next({
      resume: "abstract-boolean",
      decision,
      get value() {
        reads++;
        return reads === 1;
      },
    });
    if (!step.done) throw new Error("Expected completion");
    expect(reads).toBe(1);
    expect(api.EnsureCompletion(step.value).Value).toEqual(api.Value(11));
  });
});

it("rejects stale decision records even when the input identity repeats", async () => {
  await withAbstractFixture(({ createBoolean, compile }) => {
    createBoolean("enabled");
    const iterator = compile("if(enabled) 1; if(enabled) 2;");
    const first = getDecision(iterator);
    const second = iterator.next({ resume: "abstract-boolean", decision: first, value: true });
    if (second.done || second.value.suspend !== "abstract-boolean")
      throw new Error("Expected another decision");
    expect(second.value.value).toBe(first.value);
    expect(second.value).not.toBe(first);
    expect(() =>
      iterator.next({ resume: "abstract-boolean", decision: first, value: false }),
    ).toThrow("Invalid abstract Boolean decision response");
  });
});

it.each(["skip", "agent"])(
  "requires an explicit driver instead of the default %s runner",
  async (runner) => {
    await withAbstractFixture(({ api, agent, createBoolean, compile }) => {
      createBoolean("enabled");
      const iterator = compile("if(enabled) 1;else 2;");
      expect(() =>
        runner === "skip" ? api.skipDebugger(iterator) : agent.evaluate(iterator, () => {}),
      ).toThrow("Abstract Boolean decision requires an explicit resume");
    });
  },
);

it("rejects an unknown Test262 debugger call flag before invoking its callback", async () => {
  await withAbstractFixture(({ api, agent, realm, createBoolean, evaluate }) => {
    createBoolean("enabled");
    api.createTest262Intrinsics(realm, false, () => {});
    let callbackVisits = 0;
    agent.hostDefinedOptions.onNodeEvaluation = (node) => {
      if (node.sourceText === "called++" && node.type === "UpdateExpression") callbackVisits++;
    };
    expect(() => evaluate("var called=0;$262.debugger(()=>called++,enabled)")).toThrow(
      "Unsupported concrete read of abstract Boolean",
    );
    expect(callbackVisits).toBe(0);
  });
});

it("does not let guest catch consume an unsupported abstraction error", async () => {
  await withAbstractFixture(({ createBoolean, evaluate }) => {
    createBoolean("enabled");
    expect(() => evaluate("try{String(enabled)}catch(error){17}")).toThrow(
      "Unsupported concrete read of abstract Boolean",
    );
  });
});
