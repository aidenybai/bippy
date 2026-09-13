import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { createStaticRenderer } from "../src/render/static-renderer.js";
import { enumerateStaticStates } from "../src/harness/compare-render.js";
import { formatPattern, getRenderPattern } from "../src/harness/static-pattern.js";

const rootDirectory = join(import.meta.dirname, "framework-fixtures/vite-globals");

it("initializes native Vite globals, aliases, dotted paths and explicit process objects", async () => {
  const renderer = await createStaticRenderer({ rootDirectory });
  const result = await renderer.renderEntry("src/main.tsx");
  const tree = formatPattern(getRenderPattern(result));
  for (const text of [
    "configured",
    "3",
    "false",
    "null",
    "undefined",
    "nested",
    "object",
    "development",
  ]) {
    expect(tree).toContain(JSON.stringify(text));
  }
  expect(tree).toContain("<strong>");
  expect(tree).not.toContain("?unknown");
  expect(tree).not.toContain("?branch");
});

it("mutates injected bindings and object aliases across an effect", async () => {
  const renderer = await createStaticRenderer({ rootDirectory });
  const result = await renderer.renderEntry("src/mutation.tsx");
  const tree = formatPattern(getRenderPattern(result));
  for (const text of ["4", "true", "changed", "mutated"])
    expect(tree).toContain(JSON.stringify(text));
  expect(tree).toContain("<strong>");
  expect(tree).not.toContain("?unknown");
  expect(tree).not.toContain("?branch");
});

it("retains explicit caller define precedence", async () => {
  const renderer = await createStaticRenderer({
    rootDirectory,
    defines: { __BIPPY_DEFINE_LABEL__: "caller" },
  });
  const tree = formatPattern(getRenderPattern(await renderer.renderEntry("src/main.tsx")));
  expect(tree).toContain('"caller"');
  expect(tree).not.toContain('"configured"');
});

it("preserves lexical shadowing without replacing global-object properties", async () => {
  const renderer = await createStaticRenderer({ rootDirectory });
  const tree = formatPattern(getRenderPattern(await renderer.renderEntry("src/shadow.tsx")));
  for (const text of ["local", "configured", "7", "3"])
    expect(tree).toContain(JSON.stringify(text));
  expect(tree).not.toContain("?unknown");
});

it("distinguishes conditional absence from a present undefined global", async () => {
  const renderer = await createStaticRenderer({ rootDirectory });
  const result = await renderer.renderEntry("src/presence.tsx");
  const states = enumerateStaticStates(result).states.map((state) => formatPattern(state.tree));
  expect(states).toHaveLength(2);
  for (const tree of states) {
    expect(tree.includes("<em>")).toBe(tree.includes("<header>"));
    expect(tree.includes("<b>")).toBe(tree.includes("<header>"));
    expect(tree.includes('"undefined"')).toBe(tree.includes("<header>"));
  }
});

it("journals preexisting global properties without losing branch correlation", async () => {
  const renderer = await createStaticRenderer({
    rootDirectory,
    globals: { __BIPPY_DEFINE_COUNT__: 3 },
  });
  const result = await renderer.renderEntry("src/guarded.tsx");
  const states = enumerateStaticStates(result).states.map((state) => formatPattern(state.tree));
  expect(states).toHaveLength(2);
  for (const tree of states) expect(tree.includes("<strong>")).toBe(tree.includes("<header>"));
});
