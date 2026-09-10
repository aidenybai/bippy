import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { Interpreter, UNKNOWN_PROJECT } from "../src/evaluate/interpreter.js";
import { getObjectProperty } from "../src/evaluate/values.js";
import { ModuleGraph } from "../src/graph/module-graph.js";
import { ModuleResolver } from "../src/graph/module-resolver.js";
import {
  getWorkletClosureNames,
  getWorkletHash,
  getWorkletizedFunctions,
} from "../src/libraries/worklets-plugin.js";
import { parseSourceText, SourceFileCache } from "../src/parse/parse-source-file.js";
import type { FunctionLikeNode, StaticValue } from "../src/types.js";

const CALLBACK_SOURCE = `
import { useAnimatedStyle, useDerivedValue, withTiming, runOnUI } from "react-native-reanimated";
import { Gesture } from "react-native-gesture-handler";
import { FadeIn } from "react-native-reanimated";

const plain = () => ({});
const referenced = () => ({ opacity: 1 });
let reassigned = () => 1;
reassigned = () => 2;

export const useStyles = (progress, onDone) => {
  const style = useAnimatedStyle(() => ({ opacity: progress.value }));
  const styleByReference = useAnimatedStyle(referenced);
  const derived = useDerivedValue(reassigned);
  const timed = withTiming(1, {}, (isFinished) => onDone(isFinished));
  runOnUI(function scheduled() { return progress.value; })();
  const pan = Gesture.Pan().onStart((event) => event.x).onUpdate(plain);
  const entering = FadeIn.duration(300).withCallback((finished) => finished);
  const untouched = () => plain();
  return [style, styleByReference, derived, timed, pan, entering, untouched];
};

export const explicit = function explicit() {
  "worklet";
  return 1;
};
`;

const WORKLET_FILE_SOURCE = `
"worklet";
export const first = () => 1;
export function second() { return 2; }
export const bundle = { third: () => 3, fourth() { return 4; } };
const notExported = () => 5;
`;

const describeWorklets = (source: string): string[] => {
  const file = parseSourceText("/virtual/worklets.tsx", source, "tsx");
  return [...getWorkletizedFunctions(file.program)].map((node) => {
    const name = node.type === "ArrowFunctionExpression" ? null : node.id?.name;
    return `${name ?? "anonymous"}@${file.sourceText.slice(node.start, node.end).replace(/\s+/g, " ")}`;
  });
};

const findFunction = (source: string, snippet: string): FunctionLikeNode => {
  const file = parseSourceText("/virtual/closure.tsx", source, "tsx");
  const match = [...getWorkletizedFunctions(file.program)].find((node) =>
    file.sourceText.slice(node.start, node.end).includes(snippet),
  );
  if (match === undefined) throw new Error(`no worklet contains ${snippet}`);
  return match;
};

describe("react-native-worklets plugin model", () => {
  it("workletizes the callbacks Reanimated hooks, scheduling functions, gesture builders and layout animations receive", () => {
    expect(describeWorklets(CALLBACK_SOURCE).sort()).toEqual(
      [
        "anonymous@() => ({ opacity: progress.value })",
        "anonymous@() => ({ opacity: 1 })",
        "anonymous@() => 2",
        "anonymous@(isFinished) => onDone(isFinished)",
        "scheduled@function scheduled() { return progress.value; }",
        "anonymous@(event) => event.x",
        "anonymous@() => ({})",
        "anonymous@(finished) => finished",
        'explicit@function explicit() { "worklet"; return 1; }',
      ].sort(),
    );
  });

  it("workletizes every function a 'worklet' file declares at the top level", () => {
    expect(describeWorklets(WORKLET_FILE_SOURCE)).toEqual([
      "anonymous@() => 1",
      "second@function second() { return 2; }",
      "anonymous@() => 3",
      "anonymous@() { return 4; }",
      "anonymous@() => 5",
    ]);
  });

  it("collects the outer bindings a worklet references, skipping its own declarations and property names", () => {
    const source = `
      declare const useAnimatedStyle: any;
      const scale = 2;
      const theme = { colors: { primary: "red" } };
      export const use = (progress: { value: number }, isActive: boolean) => {
        useAnimatedStyle(() => {
          const offset = progress.value * scale;
          const [first, ...rest] = [offset, Math.round(offset)];
          const { colors: palette = theme.colors } = theme;
          return { transform: [{ translateX: first }], color: palette.primary, isActive, rest, console: console.log };
        });
      };
    `;
    expect(getWorkletClosureNames(findFunction(source, "translateX"))).toEqual([
      "progress",
      "scale",
      "Math",
      "theme",
      "isActive",
      "console",
    ]);
  });

  it("hashes code the way the plugin does", () => {
    expect(getWorkletHash("")).toBe(5381 * 4096 + 52711);
    expect(getWorkletHash("() => 1")).toBe(getWorkletHash("() => 1"));
    expect(getWorkletHash("() => 1")).not.toBe(getWorkletHash("() => 2"));
  });
});

const evaluateExport = (source: string, exportName: string): StaticValue => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-parser-worklets-"));
  const entryFile = join(rootDirectory, "app.tsx");
  writeFileSync(entryFile, source);
  const graph = new ModuleGraph({
    resolver: new ModuleResolver({ rootDirectory }),
    sourceFileCache: new SourceFileCache(),
  });
  const module = graph.getModule(entryFile);
  if (!module) throw new Error("entry did not parse");
  const interpreter = new Interpreter(graph, {
    hostPlatform: "react-native",
    babelTransform: { pragma: null, createElementRewrites: [], workletizes: true },
    project: { ...UNKNOWN_PROJECT, rootDirectory, servedDirectory: rootDirectory },
  });
  return interpreter.evaluateModuleExport(module, exportName);
};

describe("workletized functions", () => {
  it("carry the closure the plugin builds and a stable hash", () => {
    const source = `
      const scale = 2;
      const makeUpdater = (progress: number) => {
        const updater = () => {
          "worklet";
          return progress * scale + Math.PI;
        };
        return updater;
      };
      export const updater = makeUpdater(3);
      export const plain = () => scale;
    `;
    const updater = evaluateExport(source, "updater");
    if (updater.kind !== "function") throw new Error(`expected a function, got ${updater.kind}`);
    const closure = updater.properties.get("__closure");
    if (closure?.kind !== "object") throw new Error("expected __closure to be an object");
    expect(closure.entries.map((entry) => (entry.kind === "property" ? entry.key : "?"))).toEqual([
      "progress",
      "scale",
    ]);
    expect(getObjectProperty(closure, "progress")).toEqual({ kind: "primitive", value: 3 });
    expect(updater.properties.get("__workletHash")).toEqual({
      kind: "primitive",
      value: getWorkletHash(
        `() => {\n          "worklet";\n          return progress * scale + Math.PI;\n        }`,
      ),
    });
    const plain = evaluateExport(source, "plain");
    if (plain.kind !== "function") throw new Error(`expected a function, got ${plain.kind}`);
    expect(plain.properties.has("__workletHash")).toBe(false);
  });
});
