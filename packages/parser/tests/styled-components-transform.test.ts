import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/render/static-renderer.js";

const APP = join(import.meta.dirname, "fixtures/styled-components-transform");

describe("styled-components build transform", () => {
  it("names styled components `file__Binding` when the project declares babel-plugin-styled-components", async () => {
    const renderer = await createStaticRenderer({
      rootDirectory: APP,
      tsconfigPath: join(APP, "tsconfig.json"),
      externalPackageAllowList: ["styled-components"],
    });
    const result = await renderer.renderEntry(join(APP, "src/main.tsx"));
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(formatPattern(getRenderPattern(result))).toBe(
      [
        "<HostRoot>",
        "  <App>",
        "    <app__Shell>",
        "      <div>",
        "        <app__Title>",
        "          <h1>",
        "        <app__Quiet>",
        "          <h1>",
        "        <app__Named>",
        "          <span>",
        "        <app__Note>",
        "          <p>",
        "        <Panel>",
        "          <panel__Frame>",
        "            <section>",
      ].join("\n"),
    );
  });
});
