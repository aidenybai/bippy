import * as published from "@engine262/engine262";
import { expect, it } from "vite-plus/test";
import { createConcreteRuntime } from "../src/index.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { createNativeRuntime } from "./helpers/native-runtime.js";

const programs = [
  "function collect(value) { const saved = arguments; value = 9; return [saved, () => value]; } const [saved, get] = collect(2); saved[0] = 7; return [saved[0], get()];",
  "function collect(value) { eval('value = 9'); return arguments; } const saved = collect(2); return [saved[0], Object.getOwnPropertyDescriptor(saved, '0').value];",
  "function collect(value) { Object.defineProperty(arguments, '0', { get() { return 8; } }); value = 9; return [value, arguments[0]]; } return collect(2);",
  "function collect(first, second) { return [first, second, arguments.length, [...arguments]]; } return [collect(), collect(1), collect(1, 2, 3)];",
  "function collect(first, first) { first = 4; return [first, arguments[0], arguments[1]]; } return [collect(), collect(1), collect(1, 2)];",
  "function collect(first, second) { first = 4; arguments[1] = 5; return [first, second, [...arguments]]; } return collect(1, 2);",
  "function collect(first, second) { 'use strict'; first = 4; arguments[1] = 5; return [first, second, [...arguments]]; } return collect(1, 2);",
  "function collect(first) { delete arguments[0]; first = 4; return [first, arguments[0], arguments.length]; } return collect(1);",
  "function collect(first) { Object.defineProperty(arguments, '0', { value: 7, writable: false }); first = 4; return [first, arguments[0]]; } return collect(1);",
  "function collect(arguments) { return arguments; } return collect(9);",
  "function collect(first) { return eval('[first, arguments[0], arguments.length]'); } return collect(3, 4);",
  "function collect(first) { return (() => [first, arguments[0], arguments.length])(99); } return collect(3, 4);",
  "function collect(first) { const get = () => [first, arguments[0]]; first = 7; return get; } return collect(1)();",
  "function collect(first = 4, second = first + 1) { first = 8; return [first, second, arguments[0]]; } return [collect(), collect(1)];",
  "function collect({ first }, [second], ...rest) { return [first, second, rest]; } return collect({first: 1}, [2], 3, 4);",
  "class Base { constructor(first) { this.value = first; } } class Child extends Base { constructor(first, second) { super(first); this.other = second; this.args = [...arguments]; } } return new Child(1, 2);",
  "function collect(first) { return [first, new.target === collect, arguments[0]]; } return [collect(1), new collect(2)];",
  "function collect(first) { return first; } return [collect.call(null, 3), collect.apply(null, [4]), collect.bind(null, 5)()];",
  "return ((first, second) => [first, second])(...[1, 2]);",
  "function* collect(first) { yield [first, arguments[0]]; } return [...collect(8)];",
  "function collect(first) { Object.freeze(arguments); first = 9; return [first, arguments[0]]; } return collect(2);",
  "let calls = 0; Object.defineProperty(Object.prototype, 'done', { configurable: true, get() { calls++; return true; } }); function collect(first) { return first; } const result = collect(4); delete Object.prototype.done; return [result, calls];",
];

const getPublishedObservation = (source: string) => {
  const previous = published.surroundingAgent;
  published.setSurroundingAgent(new published.Agent({ startEventLoop: false }));
  try {
    const result = published.EnsureCompletion(
      new published.ManagedRealm().evaluateScriptSkipDebugger(source),
    );
    expect(result.Type).toBe("normal");
    if (result.Value.type !== "String") throw new Error("Expected a published string observation");
    return result.Value.value;
  } finally {
    published.setSurroundingAgent(previous);
  }
};

it.each(programs)("preserves native and published parameter binding: %s", async (program) => {
  const source = `JSON.stringify((() => { ${program} })())`;
  const runtime = await createConcreteRuntime();
  try {
    const observation = runtime.readString(source);
    expect(observation).toBe(getPublishedObservation(source));
    expect(observation).toBe(createNativeRuntime().evaluate(source));
  } finally {
    runtime.dispose();
  }
});

it.each([false, true])(
  "preserves internal iterator breakpoints with debugger option %s",
  async (withDebugger) => {
    const { api } = await getSymbolicEngine();
    const previous = api.surroundingAgent;
    const agent = new api.Agent({
      startEventLoop: false,
      onDebugger: withDebugger ? () => {} : undefined,
    });
    api.setSurroundingAgent(agent);
    try {
      const realm = new api.ManagedRealm();
      const pop = realm.pushTopContext();
      try {
        const nextMethod = agent.intrinsic("%GeneratorFunction.prototype.prototype.next%");
        agent.breakpointsByFunction.add(nextMethod);
        const compiled = realm.compileScript(
          "function identity(value) { return value; } identity(7)",
        );
        if (compiled instanceof api.ThrowCompletion)
          throw new Error("Unexpected fixture parse error");
        const record = api.EnsureCompletion(compiled).Value;
        if (!record) throw new Error("Missing fixture script");
        const evaluation = api.ScriptEvaluation(record);
        let pauses = 0;
        let state = evaluation.next({ resume: "debugger", value: undefined });
        while (!state.done) {
          if (state.value.suspend === "debugger") pauses++;
          state = evaluation.next({ resume: "debugger", value: undefined });
        }
        expect(pauses).toBeGreaterThan(0);
        const result = api.EnsureCompletion(state.value);
        expect(result.Type).toBe("normal");
        expect(result.Value.type).toBe("Number");
      } finally {
        pop?.();
      }
    } finally {
      api.setSurroundingAgent(previous);
    }
  },
);
