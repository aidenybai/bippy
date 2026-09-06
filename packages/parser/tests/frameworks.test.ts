import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { renderFrameworkTarget, type FrameworkRenderTarget } from "../src/frameworks/index.js";
import { formatFiber } from "../src/index.js";

// Next.js cannot mount inside happy-dom, so its adapters are checked
// structurally here; reality checks for Next run through the corpus (browser
// capture of a real dev server).

const FIXTURES = join(import.meta.dirname, "framework-fixtures");

const render = (fixture: string, target: Omit<FrameworkRenderTarget, "entry">) => {
  const rootDirectory = join(FIXTURES, fixture);
  const result = renderFrameworkTarget(target, {
    rootDirectory,
    tsconfigPath: join(rootDirectory, "tsconfig.json"),
  });
  return {
    result,
    tree: formatFiber(result.root, { rootDirectory }),
    errors: result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
  };
};

const lines = (tree: string): string[] => tree.split("\n").map((line) => line.trim());

describe("next app router", () => {
  it("composes root layout, elides server components, keeps client boundaries", () => {
    const { tree, errors } = render("next-app", { framework: "next-app", route: "/" });
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

  it("awaits async server components and their data helpers", () => {
    const { tree } = render("next-app", { framework: "next-app", route: "/" });
    expect(tree).not.toContain("async function result");
    expect(tree).toContain('"1"');
  });

  it("models next/link as LinkComponent -> anonymous provider -> <a>", () => {
    const { tree } = render("next-app", { framework: "next-app", route: "/" });
    expect(tree).toMatch(/<LinkComponent>\n\s+<\?>\n\s+<a>\n\s+<LinkComponent>/);
  });

  it("nests segment layouts, loading boundaries and resolves dynamic params", () => {
    const { tree, errors } = render("next-app", { framework: "next-app", route: "/blog/hello" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<main>\n\s+<div>\n\s+<Suspense>\n\s+<Offscreen>\n\s+<article>\n\s+<h1>/);
    expect(tree).not.toContain("route params are only known");
  });

  it("looks through route groups", () => {
    const { tree, errors } = render("next-app", { framework: "next-app", route: "/about" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<main>\n\s+<h1>/);
  });

  it("reports a missing page instead of guessing", () => {
    const { result, errors } = render("next-app", { framework: "next-app", route: "/missing" });
    expect(errors.map((diagnostic) => diagnostic.code)).toEqual(["next-app-no-page"]);
    expect(result.root.child?.kind).toBe("unknown");
  });
});

describe("next pages router", () => {
  it("wraps the page in _app with Component/pageProps", () => {
    const { tree, errors } = render("next-pages", { framework: "next-pages", route: "/" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<App>\n\s+<div>\n\s+<Home>\n\s+<h1>/);
  });

  it("feeds dynamic segments into useRouter().query", () => {
    const { tree } = render("next-pages", { framework: "next-pages", route: "/posts/42" });
    expect(tree).toMatch(/<h1>\n\s+"Post "\n\s+"42"/);
  });

  it("matches catch-all pages", () => {
    const { tree, errors } = render("next-pages", { framework: "next-pages", route: "/docs/a/b" });
    expect(errors).toEqual([]);
    expect(tree).toContain("<Docs>");
  });

  it("never renders api routes", () => {
    const { errors } = render("next-pages", { framework: "next-pages", route: "/api/hello" });
    expect(errors.map((diagnostic) => diagnostic.code)).toEqual(["next-pages-no-page"]);
  });
});

describe("react router framework mode with react-router-auto-routes", () => {
  const target = (route: string) =>
    render("react-router-auto", { framework: "react-router", route, entry: "app/routes.ts" });

  it("composes root Layout/App around the matched file route", () => {
    const { tree, errors } = target("/");
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<Layout>\n\s+<html>/);
    expect(tree).toMatch(/<App>\n\s+<div>\n\s+<Outlet>\n\s+<\?>\n\s+<RenderedRoute>\n\s+<Route>\n\s+<Home>\n\s+<main>/);
  });

  it("drops pathless `_group` folders from the URL", () => {
    expect(target("/about").tree).toContain("<About>");
    expect(target("/login").tree).toContain("<Login>");
  });

  it("nests only under `_layout` files and resolves `$param` segments", () => {
    expect(target("/blog").tree).toMatch(/<BlogLayout>\n\s+<section>\n\s+<Outlet>\n\s+<\?>\n\s+<RenderedRoute>\n\s+<Route>\n\s+<BlogIndex>/);
    const post = target("/blog/hello").tree;
    expect(post).toMatch(/<BlogLayout>[\s\S]*<BlogPost>\n\s+<h1>\n\s+"Post "\n\s+"hello"/);
  });

  it("treats a trailing underscore as a layout opt-out only at that level", () => {
    const { tree } = target("/settings/profile/password/create");
    expect(tree).toMatch(/<ProfileLayout>[\s\S]*<CreatePassword>/);
  });

  it("ignores colocated `+` and css files, and falls back to the splat", () => {
    const { tree, errors } = target("/nope/deep");
    expect(errors).toEqual([]);
    expect(tree).toContain("<NotFound>");
    expect(tree).not.toContain("profile.css");
  });

  it("renders resource routes as empty outlets", () => {
    const { tree, errors } = target("/robots.txt");
    expect(errors).toEqual([]);
    expect(tree).not.toContain("?unknown");
  });
});
