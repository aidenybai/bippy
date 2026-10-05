import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { UNDEFINED_VALUE, describeValue } from "../src/evaluate/values.js";
import { createStaticRenderer } from "../src/index.js";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "assignment", expected: ["caught:F:old"] },
  { name: "guards", expected: ["caught:F:old", "returned:FSA:new"] },
  { name: "callee", expected: ["caught:F"] },
  { name: "receiver", expected: ["unbound"] },
])("preserves comma completion: $name", ({ name, expected }) =>
  checkConcreteComponentStates(`sequence-completion-${name}.tsx`, expected),
);

it("evaluates ten thousand comma operands without recursive sequencing", async () => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-sequence-completion-"));
  const entryFile = join(rootDirectory, "entry.ts");
  const operands = Array.from({ length: 10_000 }, (_, index) => index).join(",");
  writeFileSync(entryFile, `export const run = () => (${operands});`, { flag: "wx" });
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
