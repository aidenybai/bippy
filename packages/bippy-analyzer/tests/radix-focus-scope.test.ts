import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, it } from "vite-plus/test";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/index.js";

const writeSource = (rootDirectory: string, fileName: string, source: string): string => {
  const filePath = join(rootDirectory, fileName);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);
  return filePath;
};

it("renders an as-child Radix FocusScope without mounting its document effects", async () => {
  const rootDirectory = mkdtempSync(join(import.meta.dirname, "radix-focus-scope-"));
  try {
    const packageDirectory = join(rootDirectory, "node_modules/@radix-ui/react-focus-scope");
    writeSource(
      packageDirectory,
      "package.json",
      JSON.stringify({
        name: "@radix-ui/react-focus-scope",
        version: "1.0.0",
        module: "index.js",
        sideEffects: false,
      }),
    );
    writeSource(
      packageDirectory,
      "index.js",
      'export const FocusScope = () => { throw new Error("source should not run"); };',
    );
    const entryPath = writeSource(
      rootDirectory,
      "entry.jsx",
      `
        import { FocusScope } from "@radix-ui/react-focus-scope";
        export default () => (
          <FocusScope asChild trapped>
            <section><button /></section>
          </FocusScope>
        );
      `,
    );
    const renderer = await createStaticRenderer({
      rootDirectory,
      externalPackageAllowList: ["@radix-ui/react-focus-scope"],
    });

    const result = await renderer.renderComponent(entryPath);
    const pattern = formatPattern(getRenderPattern(result));

    expect(result.stats.unknownCount).toBe(0);
    expect(result.diagnostics).toEqual([]);
    expect(pattern).toContain("<FocusScope>");
    expect(pattern).toContain("<Primitive.div>");
    expect(pattern).toContain("<Primitive.div.Slot>");
    expect(pattern).toContain("<Primitive.div.SlotClone>");
    expect(pattern).toContain("<section>");
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});
