import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/render/static-renderer.js";

const APP = join(import.meta.dirname, "fixtures/styled-components-transform");
const MACRO_APP = join(import.meta.dirname, "fixtures/styled-components-macro");
const MACRO_CONFIG_APP = join(import.meta.dirname, "fixtures/styled-components-macro-config");

describe("styled-components build transform", () => {
  it("names macro-styled components with the babel-plugin-macros `styledComponents` config", async () => {
    const renderer = await createStaticRenderer({
      rootDirectory: MACRO_CONFIG_APP,
      tsconfigPath: join(MACRO_CONFIG_APP, "tsconfig.json"),
      externalPackageAllowList: ["styled-components"],
    });
    const result = await renderer.renderEntry(join(MACRO_CONFIG_APP, "src/main.tsx"));
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity !== "info")).toEqual([]);
    expect(formatPattern(getRenderPattern(result))).toBe(
      [
        "<HostRoot>",
        "  <App>",
        "    <app__Shell>",
        "      <main>",
        "        <Card>",
        "          <Card__Wrapper>",
        "            <section>",
        "              <Card__Heading>",
        "                <h2>",
      ].join("\n"),
    );
  });

  it("models `styled-components/macro` as styled-components with the plugin's default naming", async () => {
    const renderer = await createStaticRenderer({
      rootDirectory: MACRO_APP,
      tsconfigPath: join(MACRO_APP, "tsconfig.json"),
      externalPackageAllowList: ["styled-components"],
    });
    const result = await renderer.renderEntry(join(MACRO_APP, "src/main.tsx"));
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
        "          <h2>",
        "        <app__Named>",
        "          <span>",
        "        <app__Note>",
        "          <p>",
      ].join("\n"),
    );
  });

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
