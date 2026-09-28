import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { SourceMap } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as published from "@engine262/engine262";
import { expect, it } from "vite-plus/test";
import type { AgentHostDefined, ValueEvaluator } from "../engine/dist/declaration/index.mjs";
import { EngineBuildError } from "../engine/errors.js";
import { engineDirectory, outputDirectory, verifyEngineBuild } from "../engine/manifest.js";
import { getSymbolicEngine } from "../src/symbolic/load-engine.js";

const getPublishedResult = (source: string): string => {
  const previous = published.surroundingAgent;
  published.setSurroundingAgent(new published.Agent({ startEventLoop: false }));
  try {
    const realm = new published.ManagedRealm();
    const pop = realm.pushTopContext();
    try {
      const result = published.EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
      if (result instanceof published.ThrowCompletion)
        return `throw:${published.inspect(result.Value)}`;
      return published.inspect(result.Value);
    } finally {
      pop?.();
    }
  } finally {
    published.setSurroundingAgent(previous);
  }
};

const concreteCases = [
  "const object = { value: 1 }; const alias = object; alias.value++; object.value",
  "let value = 1; const get = () => value; value = 4; get()",
  "let count = 0; const object = { get value() { return ++count; } }; object.value + object.value",
  "let count = 0; const object = { set value(value) { count += value; } }; object.value = 4; count",
  "const object = {}; Object.defineProperty(object, 'value', { value: 3 }); Reflect.set(object, 'value', 4)",
  "let count = 0; const object = new Proxy({}, { get() { return ++count; } }); object.value + object.value",
  "let count = 0; try { throw 2; } catch (error) { count = error; } finally { count++; } count",
  "const get = () => { try { return 1; } finally { return 2; } }; get()",
  "class Counter { #value = 0; increment() { return ++this.#value; } }; const counter = new Counter(); counter.increment() + counter.increment()",
  "const values = [1, 2, 3].map(value => value * 2); values.reduce((sum, value) => sum + value, 0)",
  "const object = {}; const values = new Map([[object, 3]]); values.get(object)",
  "new Set([1, 1, 2]).size",
  "const values = new Uint8Array([256, 257]); values[0] + values[1]",
  "Object.is(-0, 0) === false && Object.is(NaN, NaN)",
  "2n ** 50n",
  "JSON.stringify(Object.keys({ b: 1, 2: 2, a: 3, 1: 4 }))",
  "const get = function* () { yield 1; yield 2; }; Array.from(get()).join(',')",
  "const value = Symbol('value'); const object = { [value]: 3 }; object[value]",
  "JSON.stringify([/k/iu.test('K'), /s/iu.test('ſ'), /[\\p{ASCII}&&\\p{Letter}]/v.test('a')])",
  "const π = 3; π + 1",
  "let value = 0; for (let index = 0; index < 4; index++) { if (index === 2) continue; value += index; } value",
  "'use strict'; const value = Object.freeze({ value: 1 }); try { value.value = 2; } catch (error) { error.name; }",
];

it.each(concreteCases)("source build matches the published engine: %s", async (source) => {
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  api.setSurroundingAgent(new api.Agent({ startEventLoop: false }));
  try {
    const realm = new api.ManagedRealm();
    const pop = realm.pushTopContext();
    try {
      const result = api.EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
      const observation =
        result instanceof api.ThrowCompletion
          ? `throw:${api.inspect(result.Value)}`
          : api.inspect(result.Value);
      expect(observation).toBe(getPublishedResult(source));
      expect(result).toBeInstanceOf(api.NormalCompletion);
    } finally {
      pop?.();
    }
  } finally {
    api.setSurroundingAgent(previous);
  }
});

it("emits a typed hook after node observation, with an untouched fallback", async () => {
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  const observed: string[] = [];
  const options: AgentHostDefined = {
    startEventLoop: false,
    onNodeEvaluation(node) {
      if (node.type === "NumericLiteral") observed.push(`observe:${node.sourceText}`);
    },
    evaluateNode(node, realm) {
      expect(realm).toBe(api.surroundingAgent.currentRealmRecord);
      if (node.type === "NumericLiteral" && node.sourceText === "1") {
        observed.push("override:1");
        return api.GetValue(api.Value(41));
      }
      return undefined;
    },
  };
  api.setSurroundingAgent(new api.Agent(options));
  try {
    const realm = new api.ManagedRealm();
    expect(api.EnsureCompletion(realm.evaluateScriptSkipDebugger("1 + 2")).Value).toEqual(
      api.Value(43),
    );
    expect(observed).toEqual(["observe:1", "override:1", "observe:2"]);
  } finally {
    api.setSurroundingAgent(previous);
  }
});

it("preserves abrupt hook completions and does not evaluate the remaining operand", async () => {
  const { api } = await getSymbolicEngine();
  const previous = api.surroundingAgent;
  const observed: string[] = [];
  const handler = {
    *replace(): ValueEvaluator {
      return api.ThrowCompletion(
        api.EnsureCompletion(yield* api.GetValue(api.Value("hook error"))).Value,
      );
    },
  };
  const options: AgentHostDefined = {
    startEventLoop: false,
    onNodeEvaluation: (node) => {
      observed.push(node.sourceText);
    },
    evaluateNode: (node) => (node.type === "NumericLiteral" ? handler.replace() : undefined),
  };
  api.setSurroundingAgent(new api.Agent(options));
  try {
    const result = new api.ManagedRealm().evaluateScriptSkipDebugger("1 + missing()");
    expect(result).toBeInstanceOf(api.ThrowCompletion);
    expect(api.EnsureCompletion(result).Value).toEqual(api.Value("hook error"));
    expect(observed).not.toContain("missing()");
  } finally {
    api.setSurroundingAgent(previous);
  }
});

it("runs the CLI without a launcher child that could outlive harness termination", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bippy-cli-process-"));
  try {
    const filename = join(directory, "processes.txt");
    const preload = `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(filename)}, process.pid + '\\n');`;
    const result = execFileSync(
      join(engineDirectory, "scripts/cli.ts"),
      ["--no-inspect", "--eval", "console.log(3)"],
      {
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=data:text/javascript,${encodeURIComponent(preload)}`,
        },
      },
    );
    expect(result).toBe("3\n");
    const processes = new Set((await readFile(filename, "utf8")).trim().split("\n"));
    expect(processes.size).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("accepts module flags before other CLI arguments", () => {
  const result = execFileSync(
    join(engineDirectory, "scripts/cli.ts"),
    ["--module", "--no-inspect", "--eval", "console.log(await Promise.resolve(3))"],
    { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 },
  );
  expect(result).toBe("3\n");
});

it("maps the built hook back to its patched TypeScript source", async () => {
  const code = await readFile(join(outputDirectory, "engine.mjs"), "utf8");
  const payload = JSON.parse(await readFile(join(outputDirectory, "engine.mjs.map"), "utf8"));
  const offset = code.indexOf("surroundingAgent.hostDefinedOptions.evaluateNode");
  expect(offset).toBeGreaterThan(0);
  const preceding = code.slice(0, offset);
  const line = preceding.split("\n").length;
  const column = offset - preceding.lastIndexOf("\n");
  const location = new SourceMap(payload).findOrigin(line, column);
  if (!("fileName" in location) || !("lineNumber" in location))
    throw new EngineBuildError("Missing source-map location for the hook");
  expect(location.fileName).toBe("engine262/src/evaluator.mts");
  const index = payload.sources.indexOf(location.fileName);
  expect(payload.sourcesContent[index].split("\n")[location.lineNumber - 1]).toContain(
    "evaluateNode",
  );
  expect(
    payload.sources.every(
      (name: string) => name.startsWith("engine262/") || name.startsWith("node_modules/"),
    ),
  ).toBe(true);
});

it("rejects changed, missing, extra, and stale build artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bippy-engine-artifacts-"));
  try {
    await cp(outputDirectory, directory, { recursive: true });
    const code = await readFile(join(directory, "engine.mjs"));
    await writeFile(join(directory, "engine.mjs"), "corrupt");
    await expect(verifyEngineBuild(directory)).rejects.toBeInstanceOf(EngineBuildError);
    await writeFile(join(directory, "engine.mjs"), code);
    await writeFile(join(directory, "extra"), "unexpected");
    await expect(verifyEngineBuild(directory)).rejects.toBeInstanceOf(EngineBuildError);
    await rm(join(directory, "extra"));
    const map = await readFile(join(directory, "engine.mjs.map"));
    await rm(join(directory, "engine.mjs.map"));
    await expect(verifyEngineBuild(directory)).rejects.toBeInstanceOf(EngineBuildError);
    await writeFile(join(directory, "engine.mjs.map"), map);
    const manifest = await verifyEngineBuild(directory);
    await writeFile(
      join(directory, "manifest.json"),
      JSON.stringify({ ...manifest, inputSha256: "0".repeat(64) }),
    );
    await expect(verifyEngineBuild(directory)).rejects.toThrow("stale");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
