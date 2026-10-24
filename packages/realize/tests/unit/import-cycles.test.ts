import { describe, expect, it } from "vite-plus/test";
import { getCycleImporters, parseImports } from "../conformance/verifier/source-index";
import type { FileImports } from "../conformance/verifier/types";

const createImports = (edges: Record<string, string[]>): Map<string, FileImports> =>
  new Map(Object.entries(edges).map(([file, files]) => [file, { packages: [], files }]));

describe("import cycles", () => {
  it("names the importer a layout's route table cycles through", () => {
    const imports = createImports({
      "/src/main.tsx": ["/src/router/index.tsx"],
      "/src/router/index.tsx": ["/src/layouts/root-layout.tsx"],
      "/src/layouts/root-layout.tsx": ["/src/components/sidebar.tsx"],
      "/src/components/sidebar.tsx": ["/src/router/index.tsx"],
    });
    const cycleImporters = getCycleImporters(imports);
    expect(cycleImporters.get("/src/layouts/root-layout.tsx")).toEqual(["/src/router/index.tsx"]);
    expect(cycleImporters.has("/src/main.tsx")).toBe(false);
  });

  it("leaves files outside a cycle out", () => {
    const imports = createImports({
      "/src/a.tsx": ["/src/b.tsx"],
      "/src/b.tsx": ["/src/c.tsx"],
      "/src/c.tsx": [],
    });
    expect(getCycleImporters(imports).size).toBe(0);
  });

  it("counts a barrel's re-exports as imports, but not its type-only ones", () => {
    const barrel = [
      'export { default, MobileAppHeader } from "./AppSidebar";',
      'export * from "./hooks";',
      'export type { SidebarProps } from "./types";',
      "export const SIDEBAR_WIDTH = 240;",
    ].join("\n");
    expect(parseImports(barrel)).toEqual([
      { specifier: "./AppSidebar", names: ["default", "MobileAppHeader"] },
      { specifier: "./hooks", names: [] },
    ]);
  });
});
