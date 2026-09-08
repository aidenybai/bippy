import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { UNDEFINED_VALUE, describeValue } from "../src/evaluate/values.js";
import { createStaticRenderer } from "../src/index.js";

const BRANCHED_SOURCE = `
declare const isWide: boolean;
const isLarge = (value: string) => value === "lg";

export const narrowedByEquality = () => {
  const size = isWide ? "lg" : "sm";
  if (size === "lg") return size.toUpperCase();
  return size;
};

export const narrowedByDiscriminant = () => {
  const shape = isWide ? { kind: "circle", radius: 1 } : { kind: "rect", width: 2 };
  return shape.kind === "circle" ? shape.radius : shape.width;
};

export const narrowedByMethodCall = () => {
  const color = isWide ? "#fff" : "rgb(0, 0, 0)";
  return color.charAt(0) === "#" ? color.slice(1) : color;
};

export const notNarrowedByFunctionCall = () => {
  const size = isWide ? "lg" : "sm";
  return isLarge(size) ? size.toUpperCase() : size;
};

export const regExpFromBranch = () => {
  const pattern = isWide ? "a+" : "b+";
  return new RegExp(pattern, "g");
};

export const matchWithBranch = () => {
  const pattern = isWide ? "a+" : "b+";
  return "aaab".match(new RegExp(pattern));
};

export const startsWithBranch = () => {
  const prefix = isWide ? "#" : "rgb";
  return "#fff".startsWith(prefix);
};

export const sliceWithTwoBranches = () => {
  const start = isWide ? 0 : 1;
  const end = isWide ? 2 : 3;
  return "abcd".slice(start, end);
};
`;

const evaluateExports = async (
  source: string,
  exportNames: string[],
): Promise<Record<string, string>> => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-parser-evaluate-"));
  const entryFile = join(rootDirectory, "module.ts");
  writeFileSync(entryFile, source);
  const renderer = createStaticRenderer({ rootDirectory });
  const described: Record<string, string> = {};
  await renderer.renderWith((interpreter) => {
    const module = renderer.loadModule(entryFile);
    if (!module) throw new Error(`could not parse ${entryFile}`);
    const context = interpreter.createModuleContext(module);
    for (const exportName of exportNames) {
      const exported = interpreter.evaluateModuleExport(module, exportName);
      described[exportName] = describeValue(interpreter.callValue(exported, [], context, null));
    }
    return UNDEFINED_VALUE;
  });
  return described;
};

describe("branch-valued primitives", () => {
  it("narrows a branched binding by evaluating a pure test once per alternative", async () => {
    const results = await evaluateExports(BRANCHED_SOURCE, [
      "narrowedByEquality",
      "narrowedByDiscriminant",
      "narrowedByMethodCall",
      "notNarrowedByFunctionCall",
    ]);
    expect(results).toEqual({
      narrowedByEquality: 'branch("LG" | "sm")',
      narrowedByDiscriminant: "branch(1 | 2)",
      narrowedByMethodCall: 'branch("fff" | "rgb(0, 0, 0)")',
      notNarrowedByFunctionCall: 'branch("LG" | "SM" | "lg" | "sm")',
    });
  });

  it("distributes builtin calls over a single branched primitive argument", async () => {
    const results = await evaluateExports(BRANCHED_SOURCE, [
      "regExpFromBranch",
      "matchWithBranch",
      "startsWithBranch",
      "sliceWithTwoBranches",
    ]);
    expect(results).toEqual({
      regExpFromBranch: "branch(/a+/g | /b+/g)",
      matchWithBranch: 'branch(["aaa"] | ["b"])',
      startsWithBranch: "branch(true | false)",
      sliceWithTwoBranches: "<string: slice()>",
    });
  });
});
