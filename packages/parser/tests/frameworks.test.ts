import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { renderFrameworkTarget, type FrameworkRenderTarget } from "../src/frameworks/index.js";
import { formatPattern, getRenderPattern, getRenderRootChildren } from "../src/harness/index.js";

// Next.js cannot mount inside happy-dom, so its adapters are checked
// structurally here; reality checks for Next run through the corpus (browser
// capture of a real dev server).

const FIXTURES = join(import.meta.dirname, "framework-fixtures");

const render = async (fixture: string, target: FrameworkRenderTarget) => {
  const rootDirectory = join(FIXTURES, fixture);
  const result = await renderFrameworkTarget(target, {
    rootDirectory,
    tsconfigPath: join(rootDirectory, "tsconfig.json"),
  });
  return {
    result,
    tree: formatPattern(getRenderPattern(result)),
    errors: result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
  };
};

const lines = (tree: string): string[] => tree.split("\n").map((line) => line.trim());

describe("next app router", () => {
  it("composes root layout, elides server components, keeps client boundaries", async () => {
    const { tree, errors } = await render("next-app", { framework: "next-app", route: "/" });
    expect(errors).toEqual([]);
    const names = lines(tree);
    expect(names).toContain("<html>");
    expect(names).toContain("<ThemeProvider>");
    expect(names).toContain("<ThemeContext>");
    expect(names).toContain("<Counter>");
    expect(names).not.toContain("<RootLayout>");
    expect(names).not.toContain("<HomePage>");
    expect(names).not.toContain("<Nav>");
    expect(tree).toMatch(/<section>\n\s+<h1>\n\s+<Counter>/);
  });

  it("awaits async server components and their data helpers", async () => {
    const { tree } = await render("next-app", { framework: "next-app", route: "/" });
    expect(tree).not.toContain("async function result");
    expect(tree).toMatch(/<h1>\n\s+<Counter>\n\s+<button>/);
  });

  it("models next/link as LinkComponent -> anonymous provider -> <a>", async () => {
    const { tree } = await render("next-app", { framework: "next-app", route: "/" });
    expect(tree).toMatch(/<LinkComponent>\n\s+<ContextProvider>\n\s+<a>\n\s+<LinkComponent>/);
  });

  it("answers `in` checks against a modeled component's statics", async () => {
    const { tree } = await render("next-app", { framework: "next-app", route: "/" });
    expect(tree).toMatch(/<Slot>\n\s+<i>\n\s+<LinkComponent>/);
    expect(tree).toMatch(/<Slot>\n\s+<b>\n\s+<Slottable>/);
    expect(tree).not.toContain("__radixId");
  });

  it("elides server components wrapped in memo, like Flight does", async () => {
    const { tree } = await render("next-app", { framework: "next-app", route: "/" });
    expect(tree).toMatch(/<Slottable>\n\s+"slotted"\n\s+<header>\n\s+<ForwardRef>/);
    expect(tree).not.toContain("<Hero>");
    expect(tree).not.toContain("Memo");
  });

  it("models next/image as ForwardRef -> ForwardRef -> <img>, preloading only priority images", async () => {
    const { tree } = await render("next-app", { framework: "next-app", route: "/" });
    expect(tree).toMatch(
      /<header>\n\s+<ForwardRef>\n\s+<ForwardRef>\n\s+<img>\n\s+<ImagePreload>\n\s+<ForwardRef>\n\s+<ForwardRef>\n\s+<img>\n\s+<main>/,
    );
  });

  it("nests segment layouts, loading boundaries and resolves dynamic params", async () => {
    const { tree, errors } = await render("next-app", {
      framework: "next-app",
      route: "/blog/hello",
    });
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<main>\n\s+<div>\n\s+<Suspense>\n\s+<Offscreen>\n\s+<article>\n\s+<h1>/);
    expect(tree).not.toContain("route params are only known");
  });

  it("looks through route groups", async () => {
    const { tree, errors } = await render("next-app", { framework: "next-app", route: "/about" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<main>\n\s+<h1>/);
  });

  it("models next/dynamic as the loaded LoadableComponent tree", async () => {
    const { tree } = await render("next-app", { framework: "next-app", route: "/about" });
    expect(tree).toMatch(
      /<LoadableComponent>\n\s+<Fragment>\n\s+<Chart>\n\s+<figure>\n\s+<LoadableComponent>\n\s+<Suspense>\n\s+<Offscreen>\n\s+<BailoutToCSR>\n\s+<Chart>\n\s+<figure>/,
    );
    expect(tree).not.toContain("next/dynamic");
  });

  it("reports a missing page instead of guessing", async () => {
    const { result, errors } = await render("next-app", {
      framework: "next-app",
      route: "/missing",
    });
    expect(errors.map((diagnostic) => diagnostic.code)).toEqual(["next-app-no-page"]);
    expect(getRenderRootChildren(result)).toEqual([expect.objectContaining({ kind: "wildcard" })]);
  });
});

describe("next pages router", () => {
  it("wraps the page in _app with Component/pageProps", async () => {
    const { tree, errors } = await render("next-pages", { framework: "next-pages", route: "/" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<App>\n\s+<div>\n\s+<Home>\n\s+<h1>/);
  });

  it("models next/dynamic as a forwardRef LoadableComponent rendering the loaded module", async () => {
    const { tree } = await render("next-pages", { framework: "next-pages", route: "/" });
    expect(tree).toMatch(/<h1>\n\s+<LoadableComponent>\n\s+<Widget>\n\s+<aside>/);
  });

  it("preloads next/image through next/head instead of ReactDOM.preload", async () => {
    const { tree } = await render("next-pages", { framework: "next-pages", route: "/" });
    expect(tree).toMatch(
      /<ForwardRef>\n\s+<ForwardRef>\n\s+<img>\n\s+<ImagePreload>\n\s+<Head>\n\s+<SideEffect>/,
    );
  });

  it("feeds dynamic segments into useRouter().query", async () => {
    const { tree } = await render("next-pages", { framework: "next-pages", route: "/posts/42" });
    expect(tree).toMatch(/<h1>\n\s+"Post "\n\s+"42"/);
  });

  it("matches catch-all pages", async () => {
    const { tree, errors } = await render("next-pages", {
      framework: "next-pages",
      route: "/docs/a/b",
    });
    expect(errors).toEqual([]);
    expect(tree).toContain("<Docs>");
  });

  it("never renders api routes", async () => {
    const { errors } = await render("next-pages", { framework: "next-pages", route: "/api/hello" });
    expect(errors.map((diagnostic) => diagnostic.code)).toEqual(["next-pages-no-page"]);
  });
});

describe("react router framework mode with react-router-auto-routes", () => {
  const target = (route: string) =>
    render("react-router-auto", { framework: "react-router", route, entry: "app/routes.ts" });

  it("mounts the client entry's <HydratedRouter> and composes root Layout/App around the match", async () => {
    const { tree, errors } = await target("/");
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /<HostRoot>\n\s+<HydratedRouter>\n\s+<RouterProvider>\n\s+<Location>\n\s+<RenderedRoute>\n\s+<Route>\n\s+<Layout>\n\s+<html>/,
    );
    expect(tree).toMatch(/<ScrollRestoration>\n\s+<script>\n\s+<Scripts>/);
    expect(tree).toMatch(
      /<App>\n\s+<div>\n\s+<Outlet>\n\s+<ContextProvider>\n\s+<RenderedRoute>\n\s+<Route>\n\s+<Home>\n\s+<main>/,
    );
  });

  it("drops pathless `_group` folders from the URL", async () => {
    expect((await target("/about")).tree).toContain("<About>");
    expect((await target("/login")).tree).toContain("<Login>");
  });

  it("nests only under `_layout` files and resolves `$param` segments", async () => {
    expect((await target("/blog")).tree).toMatch(
      /<BlogLayout>\n\s+<section>\n\s+<Outlet>\n\s+<ContextProvider>\n\s+<RenderedRoute>\n\s+<Route>\n\s+<BlogIndex>/,
    );
    const post = (await target("/blog/hello")).tree;
    expect(post).toMatch(/<BlogLayout>[\s\S]*<BlogPost>\n\s+<h1>\n\s+"Post "\n\s+"hello"/);
  });

  it("treats a trailing underscore as a layout opt-out only at that level", async () => {
    const { tree } = await target("/settings/profile/password/create");
    expect(tree).toMatch(/<ProfileLayout>[\s\S]*<CreatePassword>/);
  });

  it("ignores colocated `+` and css files, and falls back to the splat", async () => {
    const { tree, errors } = await target("/nope/deep");
    expect(errors).toEqual([]);
    expect(tree).toContain("<NotFound>");
    expect(tree).not.toContain("profile.css");
  });

  it("renders <Meta> from the leaf route's meta() and <Links> from every match, deduped", async () => {
    const home = await (await target("/")).tree;
    expect(home).toMatch(/<Meta>\n\s+<title> key="title"\n\s+<meta> key="charSet"\n\s+<Links>/);
    const post = (await target("/blog/hello")).tree;
    expect(post).toMatch(
      /<Meta>\n\s+<title> key="title"\n\s+<meta> key="\{\\"name\\":\\"description\\",\\"content\\":\\"A post\\"\}"\n\s+<link> key="\{\\"rel\\":\\"alternate\\",\\"href\\":\\"\/feed.xml\\"\}"/,
    );
    const links = lines(post).filter((line) => line.startsWith("<link>"));
    expect(links).toEqual([
      '<link> key="{\\"rel\\":\\"alternate\\",\\"href\\":\\"/feed.xml\\"}"',
      '<link> key="{\\"href\\":\\"https://fonts.example\\",\\"rel\\":\\"preconnect\\"}"',
      '<link> key="{\\"href\\":\\"/app.css\\",\\"rel\\":\\"stylesheet\\"}"',
      '<link> key="{\\"href\\":\\"/blog\\",\\"rel\\":\\"canonical\\"}"',
    ]);
  });

  it("renders resource routes as empty outlets", async () => {
    const { tree, errors } = await target("/robots.txt");
    expect(errors).toEqual([]);
    expect(tree).not.toContain("?unknown");
  });
});
