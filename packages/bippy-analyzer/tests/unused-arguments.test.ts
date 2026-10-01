import type { AgentHostDefined } from "../engine/dist/declaration/index.mjs";
import { expect, it } from "vite-plus/test";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";

interface ArgumentsCase {
  name: string;
  source: string;
  options: AgentHostDefined;
  hasArguments: boolean;
}

const source = `(function collect(value) {
    return () => value;
  })(7)`;
const cases: ArgumentsCase[] = [
  { name: "default host", source, options: {}, hasArguments: true },
  {
    name: "explicitly disabled",
    source,
    options: { elideUnusedArguments: false },
    hasArguments: true,
  },
  {
    name: "explicitly enabled",
    source,
    options: { elideUnusedArguments: true },
    hasArguments: false,
  },
  {
    name: "debugger at entry",
    source,
    options: { elideUnusedArguments: true, onDebugger: () => {} },
    hasArguments: true,
  },
  {
    name: "observer at entry",
    source,
    options: { elideUnusedArguments: true, onNodeEvaluation: () => {} },
    hasArguments: true,
  },
  {
    name: "evaluation hook at entry",
    source,
    options: { elideUnusedArguments: true, evaluateNode: () => undefined },
    hasArguments: true,
  },
  {
    name: "default initializer",
    source: `(function collect(value = arguments.length) {
        return () => value;
      })()`,
    options: { elideUnusedArguments: true },
    hasArguments: true,
  },
  {
    name: "escaped parameter name",
    source: String.raw`(function collect(val\u0075e) { return () => value; })(7)`,
    options: { elideUnusedArguments: true },
    hasArguments: true,
  },
  {
    name: "conservative string match",
    source: `(function collect(value) {
        "arguments";
        return () => value;
      })(7)`,
    options: { elideUnusedArguments: true },
    hasArguments: true,
  },
  {
    name: "nested eval",
    source: `(function collect(value) {
        return () => eval("value");
      })(7)`,
    options: { elideUnusedArguments: true },
    hasArguments: true,
  },
];

it.each(cases)("uses the argument-binding policy for $name", async (fixture) => {
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  api.setSurroundingAgent(new api.Agent({ startEventLoop: false, ...fixture.options }));
  try {
    const result = api.EnsureCompletion(
      new api.ManagedRealm().evaluateScriptSkipDebugger(fixture.source),
    );
    if (result.Type !== "normal" || !api.isECMAScriptFunctionObject(result.Value))
      throw new Error("Expected an escaped closure");
    let environment = result.Value.Environment;
    let hasArguments = false;
    while (true) {
      if (environment instanceof api.DeclarativeEnvironmentRecord)
        hasArguments ||= environment.bindings.has("arguments");
      if (environment instanceof api.FunctionEnvironmentRecord) break;
      if (!environment.OuterEnv) throw new Error("Missing function environment");
      environment = environment.OuterEnv;
    }
    expect(hasArguments).toBe(fixture.hasArguments);
  } finally {
    api.setSurroundingAgent(previous);
  }
});
