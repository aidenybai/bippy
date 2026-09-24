import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { UNDEFINED_VALUE, describeValue } from "../src/evaluate/values.js";
import { createStaticRenderer } from "../src/index.js";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";
const cases = [
  {
    name: "class",
    expected: ["caught:01", "returned:012L"],
  },
  {
    name: "catch",
    expected: ["caught:01", "returned:012L"],
  },
  {
    name: "while",
    expected: ["caught:01", "returned:012L"],
  },
  {
    name: "do-while",
    expected: ["caught:01", "returned:012L"],
  },
  {
    name: "update",
    expected: ["caught:0U1", "returned:0U1U2UL"],
  },
  {
    name: "plain",
    expected: ["returned:012L"],
  },
  {
    name: "heap",
    expected: ["caught:01", "returned:012L"],
  },
  {
    name: "for-of",
    expected: ["caught:01", "returned:012L"],
  },
  {
    name: "for-in",
    expected: ["caught:01", "returned:012L"],
  },
  {
    name: "correlation",
    expected: ["no:returned:012L", "yes:caught:01"],
  },
  {
    name: "nested",
    expected: ["caught:000110", "returned:000110112021L"],
  },
  {
    name: "multiple",
    expected: ["caught:0", "caught:01", "returned:012L"],
  },
  {
    name: "continue-control",
    expected: ["returned:012L"],
  },
  {
    name: "return",
    expected: ["early:01", "late:012"],
  },
];
it.each(cases)("preserves loop completion: $name", async ({ name, expected }) => {
  await checkConcreteComponentStates(`loop-completion-${name}.tsx`, expected);
});

it("keeps ten thousand ordinary iterable iterations nonrecursive", async () => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-loop-completion-"));
  const entryFile = join(rootDirectory, "entry.ts");
  const items = Array.from({ length: 10_000 }, (_value, index) => index).join(",");
  writeFileSync(
    entryFile,
    `export const run = () => { let result; for (const value of [${items}]) result = value; return result; };`,
    { flag: "wx" },
  );
  try {
    const renderer = await createStaticRenderer({ rootDirectory });
    let actual = "";
    await renderer.renderWith((interpreter) => {
      const module = renderer.loadModule(entryFile);
      if (!module) throw new Error(`Could not parse ${entryFile}`);
      const exported = interpreter.evaluateModuleExport(module, "run");
      actual = describeValue(
        interpreter.callValue(exported, [], interpreter.createModuleContext(module), null),
      );
      return UNDEFINED_VALUE;
    });
    expect(actual).toBe("9999");
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});
