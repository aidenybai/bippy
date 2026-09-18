import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { createStaticRenderer } from "../src/index.js";

it("does not evaluate tailwind-merge internals for uncertain class names", async () => {
  const rootDirectory = mkdtempSync(join(import.meta.dirname, "tailwind-merge-"));
  try {
    const filePath = join(rootDirectory, "merge.tsx");
    writeFileSync(
      filePath,
      `
import { twMerge } from "tailwind-merge";

declare const className: string;

export const Merge = () => <div className={twMerge("base", className)} />;
`,
    );
    const renderer = await createStaticRenderer({ rootDirectory });
    const result = await renderer.renderComponent(filePath, { exportName: "Merge" });
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: "budget-exhausted" }),
    );
  } finally {
    rmSync(rootDirectory, { recursive: true, force: true });
  }
});
