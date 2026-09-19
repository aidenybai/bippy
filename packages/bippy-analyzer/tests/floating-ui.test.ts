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

it("settles Floating UI positioning without evaluating its middleware loop", async () => {
  const rootDirectory = mkdtempSync(join(import.meta.dirname, "floating-ui-"));
  try {
    const packageDirectory = join(rootDirectory, "node_modules/@floating-ui/core");
    writeSource(
      packageDirectory,
      "package.json",
      JSON.stringify({
        name: "@floating-ui/core",
        version: "1.0.0",
        module: "index.js",
        sideEffects: false,
      }),
    );
    writeSource(
      packageDirectory,
      "index.js",
      'export const computePosition = () => { throw new Error("source should not run"); };',
    );
    const entryPath = writeSource(
      rootDirectory,
      "entry.jsx",
      `
        import { useEffect, useState } from "react";
        import { computePosition } from "@floating-ui/core";

        export default () => {
          const [result, setResult] = useState("pending");
          useEffect(() => {
            computePosition(null, null, { placement: "top", strategy: "fixed" }).then(
              ({ placement, strategy, x }) => setResult(\`\${placement}:\${strategy}:\${x}\`),
            );
          }, []);
          return result === "top:fixed:0" ? <main /> : <aside />;
        };
      `,
    );
    const renderer = await createStaticRenderer({
      rootDirectory,
      externalPackageAllowList: ["@floating-ui/core"],
    });

    const result = await renderer.renderComponent(entryPath);
    const pattern = formatPattern(getRenderPattern(result));

    expect(result.stats.unknownCount).toBe(0);
    expect(result.diagnostics).toEqual([]);
    expect(pattern).toContain("<main>");
    expect(pattern).not.toContain("<aside>");
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});
