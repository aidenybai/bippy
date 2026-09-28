import { fileURLToPath } from "node:url";
import { build } from "vite-plus";
import { beforeAll, expect, it } from "vitest";
import { createConcreteRuntime } from "../src/index.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";
import { createNativeRuntime } from "./helpers/native-runtime.js";

interface ReactScenario {
  name: string;
  mode: "production" | "development";
  commands: string[];
  initialText: string;
}

const bundles = new Map<string, string>();
beforeAll(async () => {
  for (const profile of [
    { name: "production", mode: "production", jsxDev: false },
    { name: "development", mode: "development", jsxDev: true },
    { name: "mismatched-jsx", mode: "production", jsxDev: true },
  ]) {
    const { mode } = profile;
    const result = await build({
      root: fileURLToPath(new URL("./fixtures/", import.meta.url)),
      configFile: false,
      envFile: false,
      logLevel: "silent",
      mode,
      esbuild: { jsxDev: profile.jsxDev },
      define: { "process.env.NODE_ENV": JSON.stringify(mode) },
      build: {
        write: false,
        minify: false,
        sourcemap: true,
        lib: {
          entry: fileURLToPath(new URL("./fixtures/concrete-react.tsx", import.meta.url)),
          name: "fixture",
          formats: ["iife"],
        },
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    expect(outputs).toHaveLength(1);
    const output = outputs[0];
    if (!("output" in output)) throw new Error("Unexpected native build result");
    const chunks = output.output.filter((item) => item.type === "chunk");
    expect(chunks).toHaveLength(1);
    const chunk = chunks[0];
    expect(chunk.imports).toEqual([]);
    expect(chunk.dynamicImports).toEqual([]);
    expect(chunk.map).not.toBeNull();
    expect(Object.keys(chunk.modules).some((name) => name.includes("react-test-renderer"))).toBe(
      true,
    );
    bundles.set(profile.name, chunk.code);
  }
});

const scenarios: ReactScenario[] = [
  {
    name: "counter",
    mode: "production",
    commands: ["mount()", "click()", "update({step:5})", "click()", "unmount()"],
    initialText: '"0"',
  },
  {
    name: "context",
    mode: "production",
    commands: ["mount('context')", "click()", "update({step:5})", "click()", "unmount()"],
    initialText: '"0:1"',
  },
  {
    name: "keyed",
    mode: "production",
    commands: [
      "mount('keyed')",
      "click('first')",
      "update({order:['second','first']})",
      "click('first')",
      "update({order:['first']})",
      "unmount()",
    ],
    initialText: '"first:0"',
  },
  {
    name: "boundary",
    mode: "production",
    commands: ["mount('boundary')", "click()", "unmount()"],
    initialText: '"ready"',
  },
  {
    name: "async",
    mode: "production",
    commands: ["mount('async')", "unmount()"],
    initialText: '"2"',
  },
  {
    name: "render-phase",
    mode: "production",
    commands: ["mount('render-phase')", "unmount()"],
    initialText: '"2"',
  },
  {
    name: "store",
    mode: "production",
    commands: ["mount('store')", "click()", "click()", "unmount()"],
    initialText: '"0"',
  },
  {
    name: "transition",
    mode: "production",
    commands: ["mount('transition')", "click()", "click()", "unmount()"],
    initialText: '"0:false"',
  },
  {
    name: "strict",
    mode: "development",
    commands: ["mount('counter', true)", "click()", "unmount()"],
    initialText: '"0"',
  },
];

it.each(scenarios)(
  "matches native React: $name ($mode)",
  async (scenario) => {
    const source = bundles.get(scenario.mode);
    if (!source) throw new Error("Missing native bundle");
    const runtime = await createConcreteRuntime();
    const native = createNativeRuntime();
    const { api } = await getSymbolicEngine();
    const observations: string[] = [];
    try {
      runtime.evaluate(source);
      native.evaluate(source);
      expect(runtime.readString("JSON.stringify(fixture.versions)")).toBe('["19.3.0","19.3.0"]');
      for (let index = 0; index < 5; index++)
        expect(api.isECMAScriptFunctionObject(runtime.evaluate(`fixture.owned[${index}]`))).toBe(
          true,
        );
      for (const command of scenario.commands) {
        runtime.evaluate(`fixture.${command}`);
        runtime.drainJobs();
        native.evaluate(`fixture.${command}`);
        native.drainJobs();
        const observation = runtime.readString("fixture.observe()");
        observations.push(observation);
        expect(observation, command).toBe(native.evaluate("fixture.observe()"));
      }
      expect(observations[0]).toContain(scenario.initialText);
      expect(JSON.parse(observations.at(-1)!)).toMatchObject({ tree: null });
      if (scenario.name === "counter") {
        expect(JSON.parse(observations[3])).toMatchObject({ tree: { children: ["12"] } });
      }
      if (scenario.name === "strict") {
        expect(JSON.parse(observations[0])).toMatchObject({
          events: [
            "layout:0",
            "effect:0",
            "layout-cleanup:0",
            "effect-cleanup:0",
            "layout:0",
            "effect:0",
          ],
        });
      }
      if (scenario.name === "boundary") {
        expect(runtime.consoleEntries).toHaveLength(1);
        expect(runtime.consoleEntries[0].arguments).toEqual([runtime.evaluate("fixture.caught")]);
        expect(native.consoleEntries).toEqual([["error", native.evaluate("fixture.caught")]]);
        expect(runtime.readString("fixture.caught.name + ':' + fixture.caught.message")).toBe(
          native.evaluate("fixture.caught.name + ':' + fixture.caught.message"),
        );
      } else {
        expect(
          runtime.consoleEntries.map((entry) => [
            entry.method,
            ...entry.arguments.map((value) => (value.type === "String" ? value.value : value.type)),
          ]),
        ).toEqual(native.consoleEntries);
      }
      expect(runtime.uncaughtExceptions).toEqual([]);
      expect(runtime.unhandledRejections.size).toBe(0);
    } finally {
      runtime.dispose();
    }
  },
  30_000,
);

it("retains the invalid production React/development JSX fixture as a failing render", async () => {
  const source = bundles.get("mismatched-jsx");
  if (!source) throw new Error("Missing rejected native bundle");
  const runtime = await createConcreteRuntime();
  const native = createNativeRuntime();
  const capture = `
    globalThis.renderError = undefined;
    const recordError = console.error;
    console.error = (...args) => { renderError = args[0]; recordError(...args); };
  `;
  try {
    for (const evaluator of [runtime, native]) {
      evaluator.evaluate(capture);
      evaluator.evaluate(source);
      evaluator.evaluate("fixture.mount()");
      evaluator.drainJobs();
    }
    expect(runtime.readString("fixture.observe()")).toBe(native.evaluate("fixture.observe()"));
    expect(JSON.parse(runtime.readString("fixture.observe()"))).toEqual({ tree: null, events: [] });
    expect(runtime.readString("renderError.name")).toBe("TypeError");
    expect(native.evaluate("renderError.name")).toBe("TypeError");
    expect(runtime.consoleEntries).toHaveLength(1);
    expect(runtime.consoleEntries[0].arguments[0]).toBe(runtime.evaluate("renderError"));
    expect(native.consoleEntries).toEqual([["error", native.evaluate("renderError")]]);
  } finally {
    runtime.dispose();
  }
}, 30_000);
