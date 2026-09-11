import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { StaticRenderer } from "../src/render/static-renderer.js";

const ROOT = join(import.meta.dirname, "components");

describe("component recursion limits", () => {
  it.each([
    { expression: "0", count: 2, message: "equivalent props and contexts" },
    { expression: "depth + 1", count: 4, message: "truncated after 3 levels" },
  ])("bounds recursive context value $expression", async ({ expression, count, message }) => {
    const renderer = new StaticRenderer({ rootDirectory: ROOT, maxRecursionPerComponent: 3 });
    const filePath = join(ROOT, "internal/context-recursion-limit.tsx");
    renderer.graph.addVirtualModule(
      filePath,
      `
      import { createContext, useContext } from "react";
      const DepthContext = createContext(0);
      const Loop = () => {
        const depth = useContext(DepthContext);
        return <DepthContext.Provider value={${expression}}><Loop /></DepthContext.Provider>;
      };
      export default () => <DepthContext.Provider value={0}><Loop /></DepthContext.Provider>;
    `,
    );
    const rendered = await renderer.renderComponent(filePath);
    const pattern = formatPattern(getRenderPattern(rendered));
    expect(pattern.split("<Loop>").length - 1).toBe(count);
    expect(pattern).toContain("?unknown(recursive Loop)");
    expect(
      rendered.diagnostics.filter((diagnostic) => diagnostic.code === "max-recursion"),
    ).toEqual([expect.objectContaining({ message: expect.stringContaining(message) })]);
  });
});
