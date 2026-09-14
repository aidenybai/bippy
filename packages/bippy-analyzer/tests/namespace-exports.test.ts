import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { createStaticRenderer } from "../src/index.js";
import { compareStaticToRuntime, enumerateStaticStates } from "../src/harness/compare-render.js";
import { replayEnumeratedStates } from "../src/harness/state-replay.js";
import {
  parseSnapshot,
  type RuntimeFiberSnapshot,
  type RuntimeSnapshot,
} from "../src/harness/snapshot.js";
import { runComponentFixture } from "./helpers/component-runner.js";
import { getConcretePatternText } from "./helpers/concrete-pattern-text.js";

const requireDependency = createRequire(join(import.meta.dirname, "../package.json"));
const directory = join(import.meta.dirname, "components/internal/namespace-exports");
const getRuntimeText = (fiber: RuntimeFiberSnapshot): string[] => [
  ...(fiber.text === null ? [] : [fiber.text]),
  ...fiber.children.flatMap(getRuntimeText),
];

const captureNative = (filePath: string): RuntimeSnapshot => {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "bippy-native-namespace-"));
  try {
    const capturePath = join(temporaryDirectory, "capture.json");
    const captured = spawnSync(
      process.execPath,
      [
        "--experimental-vm-modules",
        "--import",
        requireDependency.resolve("tsx"),
        join(import.meta.dirname, "helpers/capture-esm-component.ts"),
        filePath,
        capturePath,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    expect(captured.error).toBeUndefined();
    expect(captured.status, captured.stderr).toBe(0);
    return parseSnapshot(readFileSync(capturePath, "utf8"));
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
};

it.each([
  { name: "keys", expected: "left,right", ssrExpected: "value,left,right" },
  { name: "symbol", expected: "yes", ssrExpected: "yes" },
  {
    name: "symbol-properties",
    expected: "yes:yes:no:no:no:no",
    ssrExpected: "yes:yes:no:no:no:no",
  },
  {
    name: "registry-symbols",
    expected: "different:same:different:well-known:registered:escaped:3:Symbol.toStringTag",
    ssrExpected: "different:same:different:well-known:registered:escaped:3:Symbol.toStringTag",
  },
  {
    name: "own-control",
    expected: "yes:no:yes:yes:no:yes:no",
    ssrExpected: "yes:no:yes:yes:no:yes:no",
  },
  { name: "nullish", expected: "TypeError,TypeError:", ssrExpected: "TypeError,TypeError:" },
  { name: "read", expected: "undefined:L:R:undefined", ssrExpected: "string:L:R:undefined" },
  { name: "spread", expected: "left,right:absent", ssrExpected: "value,left,right:present" },
  {
    name: "override",
    expected: "default,left,right,value:chosen:hidden",
    ssrExpected: "value,default,left,right:chosen:hidden",
  },
  { name: "diamond", expected: "value:L", ssrExpected: "value:L" },
  {
    name: "nested",
    expected: "left,right,third:undefined",
    ssrExpected: "third,value,left,right:string",
  },
])("preserves native ESM namespace membership: $name", async ({ name, expected, ssrExpected }) => {
  const filePath = join(directory, `namespace-exports-${name}.tsx`);
  const renderer = await createStaticRenderer({ rootDirectory: directory });
  const rendered = await renderer.renderComponent(filePath);
  const model = enumerateStaticStates(rendered);
  expect(model.omitted).toBeNull();
  expect(model.states.map((state) => getConcretePatternText(state.tree).join("|"))).toEqual([
    expected,
  ]);
  const runtime = captureNative(filePath);
  expect(runtime.roots.flatMap(getRuntimeText)).toEqual([expected]);
  const comparison = await replayEnumeratedStates(
    compareStaticToRuntime(model, runtime),
    (decisions) => renderer.derive({ decisions }).renderComponent(filePath),
  );
  expect(comparison.report.status, JSON.stringify(comparison.report)).toBe("exact");
  expect(comparison.stateReplay?.mismatched).toEqual([]);
  const ssr = await runComponentFixture({ name, filePath });
  expect(ssr.runtime.roots.flatMap(getRuntimeText)).toEqual([ssrExpected]);
  expect(ssr.comparison.report.status).toBe(expected === ssrExpected ? "exact" : "mismatch");
});
