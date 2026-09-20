import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { createStaticRenderer } from "../src/index.js";
import { nativeFunction } from "../src/evaluate/stubs.js";
import {
  branchValue,
  describeValue,
  getSymbolPropertyKey,
  objectFromRecord,
  primitiveValue,
  UNDEFINED_VALUE,
} from "../src/evaluate/values.js";
it.each(
  [8, 9].flatMap((count) =>
    [
      { operator: "++", expected: "8" },
      { operator: "+", expected: "7" },
      { operator: "-", expected: "-7" },
      { operator: "~", expected: "-8" },
    ].map((operation) => ({
      ...operation,
      count,
      label:
        operation.operator === "++"
          ? `bounds raw numeric conversion method choices at ${count}`
          : `bounds ${operation.operator} conversion choices at ${count}`,
    })),
  ),
)("$label", async ({ count, operator, expected }) => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-conversion-bound-"));
  try {
    const path = join(directory, "program.ts");
    writeFileSync(path, `export const probe=(value)=>${operator}value;`);
    const renderer = await createStaticRenderer({ rootDirectory: directory });
    await renderer.renderWith((interpreter) => {
      const module = renderer.loadModule(path);
      if (!module) throw new Error("Missing module");
      const context = interpreter.createModuleContext(module);
      let calls = 0;
      const methods = Array.from({ length: count }, (_value, index) =>
        nativeFunction(`convert-${index}`, () => {
          calls++;
          return primitiveValue(7);
        }),
      );
      const input = objectFromRecord({
        [getSymbolPropertyKey({ kind: "symbol", key: "Symbol.toPrimitive" })]: branchValue(
          methods,
          "conversion methods",
        ),
      });
      const result = interpreter.callValue(
        interpreter.evaluateModuleExport(module, "probe"),
        [input],
        context,
        null,
      );
      expect(calls).toBe(count === 8 ? 8 : 0);
      expect(describeValue(result)).toBe(
        count === 8 ? expected : "unknown(numeric conversion exceeds supported alternatives)",
      );
      return UNDEFINED_VALUE;
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
