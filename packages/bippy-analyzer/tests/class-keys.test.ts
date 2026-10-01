import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { UNDEFINED_VALUE, describeValue } from "../src/evaluate/values.js";
import { createStaticRenderer } from "../src/index.js";
import { checkConcreteComponentStates } from "./helpers/check-concrete-component-states.js";

it.each([
  { name: "error", expected: ["caught:K"] },
  { name: "early-static", expected: ["caught:K"] },
  { name: "later", expected: ["caught:K"] },
  { name: "guards", expected: ["caught:K", "returned:KLS"] },
  { name: "finite", expected: ["absent:ready", "ready:absent"] },
  { name: "repeated", expected: ["KL12:second"] },
  { name: "instance", expected: ["K"] },
  { name: "payloads", expected: ["null", "undefined"] },
  { name: "arguments", expected: ["caught:K"] },
])("preserves computed class keys: $name", ({ name, expected }) =>
  checkConcreteComponentStates(`class-keys-${name}.tsx`, expected),
);

it("evaluates ten thousand concrete computed keys without recursive sequencing", async () => {
  const rootDirectory = mkdtempSync(join(tmpdir(), "bippy-class-keys-"));
  const entryFile = join(rootDirectory, "entry.ts");
  const members = Array.from(
    { length: 10_000 },
    (_value, index) => `static ["key${index}"] = ${index};`,
  ).join("\n");
  writeFileSync(
    entryFile,
    `export const run = () => { class Holder { ${members} } return Holder.key9999; };`,
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
