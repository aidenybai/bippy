import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { createFrameworkRenderer } from "../src/frameworks/render-framework.js";
import { enumerateStaticStates } from "../src/harness/compare-render.js";
import { formatPattern, getRenderPattern } from "../src/harness/static-pattern.js";

const rootDirectory = join(import.meta.dirname, "framework-fixtures/react-router-basename");
const render = async (route: string, entry = "src/main.tsx") => {
  const renderer = await createFrameworkRenderer(
    { framework: "react-router", route, entry },
    { rootDirectory, tsconfigPath: join(rootDirectory, "tsconfig.json") },
  );
  const result = await renderer.render();
  return { result, tree: formatPattern(getRenderPattern(result)) };
};

it.each(["/app/", "/app/items/book?q=1#tag", "/APP/items/book", "/app/items/a%20b"])(
  "matches the data router beneath its basename at %s",
  async (route) => {
    const { tree } = await render(route);
    expect(tree).toContain("<Page>");
    expect(tree).not.toContain("?unknown");
    expect(tree).toContain('"/app/"');
    if (route.includes("?q=1")) expect(tree).toContain('"?q=1"');
    if (route.includes("#tag")) expect(tree).toContain('"#tag"');
  },
);

it.each(["/app", "/apple/"])("does not render routes outside basename at %s", async (route) => {
  const { tree } = await render(route);
  expect(tree).not.toContain("<Page>");
  expect(tree).not.toContain("?unknown");
});

it("keeps finite basename choices correlated with their surrounding UI", async () => {
  const { result } = await render("/app/", "src/branched.tsx");
  const states = enumerateStaticStates(result).states.map((state) => formatPattern(state.tree));
  expect(states).toHaveLength(2);
  for (const state of states) expect(state.includes("<Page>")).toBe(state.includes("<header>"));
});

it.each(["unknown", "null-basename"])(
  "does not default an %s basename to a known root",
  async (entry) => {
    const { tree } = await render("/app/", `src/${entry}.tsx`);
    expect(tree).toContain("react-router: basename is not static");
  },
);

it("does not invent hrefs for unsupported target objects", async () => {
  const { tree } = await render("/app/", "src/href-unknown.tsx");
  expect(tree).toContain("react-router: useHref requires a static absolute path");
});

it("does not share location object identity between sibling routers", async () => {
  const { tree } = await render("/app/items/book", "src/identity.tsx");
  expect(tree).not.toContain("<strong>");
  expect(tree.match(/<em>/g)).toHaveLength(2);
});

it("preserves location identity when normalized basenames stay equal", async () => {
  const { tree } = await render("/app/items/book", "src/normalized.tsx");
  expect(tree).toContain("<strong>");
  expect(tree).not.toContain("<em>");
});

it("replaces location identity when a basename changes back", async () => {
  const { tree } = await render("/app/items/book", "src/cycle.tsx");
  expect(tree).toContain('"/items/book"');
  expect(tree).toContain("<em>");
  expect(tree).not.toContain("<strong>");
});

it("keeps sibling basenames and memoized location consumers separate", async () => {
  const { tree } = await render("/app/items/book?q=1#tag", "src/browser.tsx");
  expect(tree).not.toContain("?unknown");
  expect(tree).toContain('"/items/book"');
  expect(tree).toContain('"/book"');
  expect(tree).toContain('"/app/"');
  expect(tree).toContain('"/app/items/"');
  expect(tree.match(/"1"/g)).toHaveLength(2);
});

it("applies an imperative navigation scheduled by an effect", async () => {
  const { tree } = await render("/", "src/imperative-navigation.tsx");
  expect(tree).toContain("<Login>");
  expect(tree).toContain("<aside>");
  expect(tree).not.toContain("<Home>");
  expect(tree).not.toContain("<main>");
});

it("applies a Navigate redirect after its effect commits", async () => {
  const { tree } = await render("/redirect", "src/imperative-navigation.tsx");
  expect(tree).toContain("<Login>");
  expect(tree).toContain("<aside>");
  expect(tree).not.toContain("<Navigate>");
});
