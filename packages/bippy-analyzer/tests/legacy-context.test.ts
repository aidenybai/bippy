import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/render/static-renderer.js";

const APP = join(import.meta.dirname, "fixtures/legacy-context");

describe("legacy context under React 16", () => {
  it("threads childContextTypes/getChildContext through the tree and masks by contextTypes", async () => {
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
        "    <ThemeProvider>",
        "      <PassThrough>",
        "        <div>",
        "          <ThemedLabel>",
        "            <b>",
        '              "theme:"',
        '              "dark"',
        "          <Unmasked>",
        "            <em>",
        '              "context:"',
        '              "empty"',
        "          <MissingKey>",
        "            <u>",
        '              "missing:"',
        '              "absent"',
        "          <FunctionLabel>",
        "            <span>",
        '              "fn"',
        '              ":"',
        '              "dark"',
        "          <ContextProvider>",
        "            <Sized>",
        "              <small>",
        '                "size:"',
        '                "large"',
        "          <LocaleProvider>",
        "            <section>",
        "              <LocalizedLabel>",
        "                <i>",
        '                  "en"',
        '                  "/"',
        '                  "dark"',
        "              <ThemeProvider>",
        "                <LocalizedLabel>",
        "                  <i>",
        '                    "en"',
        '                    "/"',
        '                    "light"',
      ].join("\n"),
    );
  });
});
