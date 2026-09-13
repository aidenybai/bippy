import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/render/static-renderer.js";

const APP = join(import.meta.dirname, "fixtures/webpack-require-context");

describe("webpack require.context", () => {
  it("enumerates the directory at build time and loads each request's module", async () => {
    const renderer = await createStaticRenderer({
      rootDirectory: APP,
      tsconfigPath: join(APP, "tsconfig.json"),
    });
    const result = await renderer.renderEntry(join(APP, "src/main.tsx"));
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(result.stats).toMatchObject({ branchCount: 0, unknownCount: 0, opaqueCount: 0 });
    expect(formatPattern(getRenderPattern(result))).toBe(
      [
        "<HostRoot>",
        "  <App>",
        "    <main>",
        "      <ul>",
        '        <li> key="./alpha.tsx"',
        "          <h2>",
        '            "# "',
        '            "Alpha"',
        "          <Alpha>",
        "            <b>",
        '        <li> key="./beta.tsx"',
        "          <h2>",
        '            "# "',
        '            "Beta"',
        "          <Beta>",
        "            <i>",
        '        <li> key="./extra/index.tsx"',
        "          <h2>",
        '            "# "',
        '            "Extra"',
        "          <Extra>",
        "            <u>",
        "      <code>",
        '        "= "',
        '        "./alpha.tsx ./beta.tsx"',
        "      <code>",
        '        "= "',
        '        "./alpha ./alpha.tsx ./beta ./beta.tsx ./extra ./extra/ ./extra/index ./extra/index.tsx ./notes.txt"',
        "      <code>",
        '        "= "',
        '        "MODULE_NOT_FOUND"',
      ].join("\n"),
    );
  });
});
