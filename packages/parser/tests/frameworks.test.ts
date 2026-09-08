import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { renderFrameworkTarget, type FrameworkRenderTarget } from "../src/frameworks/index.js";
import { createNextModel } from "../src/frameworks/next-externals.js";
import { formatPattern, getRenderPattern, getRenderRootChildren } from "../src/harness/index.js";
import { readInstalledVersion } from "../src/libraries/installed-version.js";
import { ForwardRefTag } from "../src/work-tags.js";

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

  it("renders forwardRef/memo wrappers created by server code on the server", async () => {
    const { tree, errors } = await render("next-app", { framework: "next-app", route: "/" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /<nav>(\n\s+<LinkComponent>[\s\S]*?<a>){2}\n\s+<svg>\n\s+<path>\n\s+<span>/,
    );
    expect(tree).not.toContain("<Badge>");
    expect(tree).toMatch(/<Counter>\n\s+<button>\n\s+"1"\n\s+<ArrowIcon>\n\s+<svg>/);
  });

  it('treats every export of a "use client" module as a client reference', async () => {
    const { tree, errors } = await render("next-app", { framework: "next-app", route: "/" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<Counter>[\s\S]*?<Toaster>\n\s+<output>\n\s+<Sonner>\n\s+<aside>/);
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

  it("models next/form as Form -> <form> in the App Router and a forwardRef in the Pages Router", async () => {
    const { tree } = await render("next-app", { framework: "next-app", route: "/" });
    expect(tree).toMatch(/<nav>\n\s+<Form>\n\s+<form>\n\s+<input>\n\s+<LinkComponent>/);
    const pagesForm = createNextModel({
      kind: "next-pages",
      route: "/",
      version: null,
      nextIntlVersion: null,
    }).externalValues("next/form", "default");
    expect(
      pagesForm?.kind === "component-reference" && pagesForm.type.kind === "stub"
        ? pagesForm.type.stub.tag
        : null,
    ).toBe(ForwardRefTag);
  });

  it("resolves useLinkStatus to the idle LinkStatusContext default", async () => {
    const { tree, errors } = await render("next-app", { framework: "next-app", route: "/" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<a>\n\s+"Notes"\n\s+<PendingDot>\n\s+<main>/);
    expect(tree).not.toContain("useLinkStatus");
  });

  it("decides `key in Link` from the stub's statics and work tag", async () => {
    const { tree } = await render("next-app", { framework: "next-app", route: "/" });
    expect(tree).not.toContain("?branch");
    expect(tree).not.toContain("<mark>");
    expect(tree).not.toContain("<s>");
  });

  it("keeps an .mdx page's body as an explicit unknown inside its layouts", async () => {
    const { tree, errors } = await render("next-app", { framework: "next-app", route: "/notes" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /<main>\n\s+\?unknown\(page\.mdx is compiled by the bundler's MDX loader\)/,
    );
    expect(lines(tree)).toContain("<nav>");
  });

  it("models next/link before 15.3 as a forwardRef LinkComponent -> <a>", async () => {
    const { result, tree, errors } = await render("next-app-14", {
      framework: "next-app",
      route: "/",
    });
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<nav>\n\s+<LinkComponent>\n\s+<a>$/);
    expect(tree).not.toContain("<ContextProvider>");
    expect(JSON.stringify(getRenderRootChildren(result))).toContain(
      '"tag":"ForwardRef","name":"LinkComponent"',
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

  it("renders server-side forwardRef and memo components without fibers", async () => {
    const { tree, errors } = await render("next-app", { framework: "next-app", route: "/about" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<main>\n\s+<h1>\n\s+<div>\n\s+<h3>\n\s+<em>/);
    expect(tree).not.toContain("<Card>");
    expect(tree).not.toContain("<CardTitle>");
  });

  it("treats exports re-exported through a `use client` module as client references", async () => {
    const { tree, errors } = await render("next-app", { framework: "next-app", route: "/about" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<h3>\n\s+<em>\n\s+<Badge>\n\s+<em>\n\s+<Dashboard>/);
  });

  it("links `.svg` imports as the @svgr/webpack component module", async () => {
    const { tree, errors } = await render("next-app", { framework: "next-app", route: "/about" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<span>\n\s+<svg>\n\s+<path>\n\s+<circle>/);
    expect(tree).toMatch(
      /<ClientLogo>\n\s+<button>\n\s+<SvgLogo>\n\s+<svg>\n\s+<path>\n\s+<circle>/,
    );
    expect(tree).not.toContain("<title>");
    expect(tree).not.toContain("unsupported module");
  });

  it("models next/dynamic as the loaded LoadableComponent tree", async () => {
    const { tree } = await render("next-app", { framework: "next-app", route: "/about" });
    expect(tree).toMatch(
      /<LoadableComponent>\n\s+<Fragment>\n\s+<Chart>\n\s+<figure>\n\s+<LoadableComponent>\n\s+<Suspense>\n\s+<Offscreen>\n\s+<BailoutToCSR>\n\s+<Chart>\n\s+<figure>/,
    );
    expect(tree).not.toContain("next/dynamic");
  });

  it("models next/image priority as ImagePreload -> null, otherwise no preload, unknown priority as a branch", async () => {
    const { tree, errors } = await render("next-app", { framework: "next-app", route: "/gallery" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /<figure>\n\s+<ForwardRef>\n\s+<ForwardRef>\n\s+<img>\n\s+<ImagePreload>\n\s+<ForwardRef>\n\s+<ForwardRef>\n\s+<img>\n\s+<ForwardRef>\n\s+<ForwardRef>\n\s+<img>\n\s+\?branch\(priority decides whether the image preloads\)\n\s+\|0 \(preferred\)\n\s+\|1\n\s+<ImagePreload>$/,
    );
  });

  it("reports a missing page instead of guessing", async () => {
    const { result, errors } = await render("next-app", {
      framework: "next-app",
      route: "/missing",
    });
    expect(errors.map((diagnostic) => diagnostic.code)).toEqual(["next-app-no-page"]);
    expect(getRenderRootChildren(result)).toEqual([expect.objectContaining({ kind: "wildcard" })]);
  });

  it("models next/link as the pages forwardRef before Next 15.3 introduced LinkStatusContext", () => {
    const linkTag = (version: string | null): number | undefined | null => {
      const link = createNextModel({
        kind: "next-app",
        route: "/",
        version,
        nextIntlVersion: null,
      }).externalValues("next/link", "default");
      return link?.kind === "component-reference" && link.type.kind === "stub"
        ? link.type.stub.tag
        : null;
    };
    expect(linkTag("13.3.2-canary.13")).toBe(ForwardRefTag);
    expect(linkTag("15.1.4")).toBe(ForwardRefTag);
    expect(linkTag("15.3.0")).toBeUndefined();
    expect(linkTag("16.2.0")).toBeUndefined();
    expect(linkTag(null)).toBeUndefined();
  });

  it("reads the installed version of a package from the project root", () => {
    expect(readInstalledVersion(FIXTURES, "react")).toMatch(/^\d+\.\d+\.\d+/);
    expect(readInstalledVersion(FIXTURES, "@bippy/not-installed")).toBeNull();
  });
});

describe("next app router with next-intl", () => {
  const target = (route: string) => render("next-app-intl", { framework: "next-app", route });

  it("loads the request config named by the next.config plugin and resolves the locale", async () => {
    const { tree, errors } = await target("/en");
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /<html>\n\s+<body>\n\s+<NextIntlClientProvider>\n\s+<IntlProvider>\n\s+<ContextProvider>\n\s+<main>/,
    );
    expect(tree).not.toContain("?unknown");
    expect(tree).not.toContain("request configuration");
  });

  it("translates server (getTranslations) and client (useTranslations) messages per locale", async () => {
    const english = (await target("/en")).tree;
    expect(english).toMatch(/<h1>\n\s+"Hello, Ada!"\n\s+<br>/);
    expect(english).toMatch(/"2 visitors"\n\s+<br>\n\s+"No visitors"/);
    const french = (await target("/fr")).tree;
    expect(french).toMatch(/<h1>\n\s+"Bonjour, Ada !"\n\s+<br>/);
    expect(french).toMatch(/"2 visiteurs"\n\s+<br>\n\s+"Aucun visiteur"/);
  });

  it("keeps ICU interpolations of unknown values as text uncertainty, not fabricated text", async () => {
    const { tree } = await target("/en");
    expect(tree).toMatch(/"No visitors"\n\s+<br>\n\s+#text\(\?\)/);
    expect(tree).not.toContain("?branch");
  });

  it("renders rich text chunks with next-intl's key scheme", async () => {
    const { tree } = await target("/en");
    expect(tree).toMatch(/"Read the "\n\s+<a> key="docs0"\n\s+"guide"\n\s+" first"/);
  });

  it("prefixes createNavigation links per localePrefix", async () => {
    const hrefs = (route: string) =>
      target(route).then(({ result }) => {
        const anchors: string[] = [];
        const visit = (fiber: (typeof result.snapshot.roots)[number]) => {
          if (fiber.name === "a" && typeof fiber.props.href === "string")
            anchors.push(fiber.props.href);
          fiber.children.forEach(visit);
        };
        result.snapshot.roots.forEach(visit);
        return anchors;
      });
    expect(await hrefs("/en")).toEqual(["/", "/about", "/docs"]);
    expect(await hrefs("/fr")).toEqual(["/fr", "/fr/about", "/docs"]);
    const { tree } = await target("/en");
    expect(tree).toMatch(/<BaseLink>\n\s+<LinkComponent>\n\s+<ContextProvider>\n\s+<a>/);
  });

  it("uses useTranslations inside server components and elides them", async () => {
    const { tree, errors } = await target("/fr/about");
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<ContextProvider>\n\s+<h1>\n\s+<LocaleSwitcher>/);
    expect(tree).not.toContain("<AboutPage>");
  });

  it("keeps notFound() for an unsupported locale as control-flow uncertainty", async () => {
    const { tree } = await target("/de");
    expect(tree).toContain("notFound() interrupts rendering");
  });

  it("models next-intl 3.x: `locale` param from unstable_setRequestLocale, locale fallback, minified provider", async () => {
    const legacy = (route: string) =>
      render("next-app-intl-legacy", { framework: "next-app", route });
    const english = await legacy("/en");
    expect(english.errors).toEqual([]);
    expect(english.tree).not.toContain("?unknown");
    expect(english.tree).toMatch(/<body>\n\s+<r>\n\s+<IntlProvider>/);
    expect(english.tree).toMatch(/<h1>\n\s+"Welcome"/);
    expect(english.tree).toMatch(/<p>\n\s+"en"/);
    expect(english.tree).toMatch(/<Greeting>\n\s+<p>\n\s+"Hello, Ada!"/);
    const french = await legacy("/fr");
    expect(french.tree).toMatch(/<h1>\n\s+"Bienvenue"/);
    expect(french.tree).toMatch(/<p>\n\s+"fr"/);
    expect(french.tree).toMatch(/"Bonjour, Ada !"/);
    expect((await legacy("/de")).tree).toContain("notFound() interrupts rendering");
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

  it("models next/image priority as ImagePreload -> Head -> SideEffect", async () => {
    const { tree, errors } = await render("next-pages", {
      framework: "next-pages",
      route: "/gallery",
    });
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /<figure>\n\s+<ForwardRef>\n\s+<ForwardRef>\n\s+<img>\n\s+<ImagePreload>\n\s+<Head>\n\s+<SideEffect>\n\s+<ForwardRef>\n\s+<ForwardRef>\n\s+<img>\n\s+<Script>$/,
    );
  });

  it("renders next/script without a host <script>: the pages head manager owns every strategy", async () => {
    const { tree } = await render("next-pages", { framework: "next-pages", route: "/" });
    expect(tree).toContain("<Script>");
    expect(tree).not.toContain("<script>");
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

  it("models next@12.0 Link as a plain function cloning its child and Head's SideEffect as a class", async () => {
    const { tree, errors } = await render("next-pages", {
      framework: "next-pages",
      route: "/about",
    });
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /<section>\n\s+<Head>\n\s+<_class>\n\s+<Link>\n\s+<a>\n\s+<Link>\n\s+<a>\n/,
    );
    expect(tree).not.toContain("LinkComponent");
    expect(tree).not.toContain("?unknown");
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
      /<HostRoot>\n\s+<HydratedRouter>\n\s+<FrameworkContext>\n\s+<RouterProvider>\n\s+<DataRouterState>\n\s+<Location>\n\s+<RenderedRoute>\n\s+<Route>\n\s+<Layout>\n\s+<html>/,
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
    const links = lines(post).filter((line) => line.startsWith('<link> key="{'));
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

  it("renders <Scripts> as the pre-hydration preloads and boot scripts, lazy route discovery by default", async () => {
    const { tree } = await target("/");
    expect(tree).toMatch(
      /<Scripts>\n\s+\?branch\(whether the dev server inlined critical CSS[^\n]*\n\s+\|0 \(preferred\)\n\s+<link>\n\s+<Fragment>\n\s+<link> key="\/app\/root.tsx"\n\s+<link> key="\/app\/routes\/_marketing\/index.tsx"\n\s+<Fragment>\n\s+<script>\n\s+<script>\n\s+\|1\n/,
    );
    expect(tree).not.toContain("subresource integrity");
  });

  it("renders useFetcher()'s Form through <Form> while its state stays a runtime branch", async () => {
    const { tree, errors } = await target("/about");
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /<fetcher\.Form>\n\s+<Form>\n\s+<form>\n\s+<input>\n\s+<button>\n\s+\?branch/,
    );
    expect(tree).toContain("react-router fetcher state is only known at runtime");
    expect(tree).not.toContain("?unknown");
  });
});

describe("react router framework mode config", () => {
  it("preloads the route manifest under initial route discovery and branches on the SRI import map", async () => {
    const { tree, errors } = await render("react-router-initial", {
      framework: "react-router",
      route: "/",
      entry: "app/routes.ts",
    });
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /<ScrollRestoration>\n\s+<script>\n\s+<Scripts>\n\s+\?branch\(whether the dev server inlined critical CSS[^\n]*\n\s+\|0 \(preferred\)\n\s+\?branch\(the subresource integrity/,
    );
    expect(tree).toMatch(
      /\?branch\(the subresource integrity[^\n]*\n\s+\|0 \(preferred\)\n\s+<script>\n\s+\|1\n\s+<link>\n\s+<link>\n\s+<Fragment>\n\s+<link> key="\/app\/root.tsx"\n\s+<link> key="\/app\/routes\/home.tsx"\n\s+<Fragment>\n\s+<script>\n\s+<script>\n/,
    );
  });
});

describe("react router data router with JSX routes", () => {
  const target = (route: string) =>
    render("react-router-computed", { framework: "react-router", route, entry: "src/main.tsx" });

  it("keeps a nested route whose path is computed at runtime as an alternative to the static match", async () => {
    const { tree, errors } = await target("/about");
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /\?branch\(1 route\(s\) could not be read statically and may also match \/about\)\n\s+\|0 \(preferred\)\n\s+<RenderedRoute>/,
    );
    expect(tree).toMatch(/<Outlet>\n\s+<ContextProvider>\n\s+<RenderedRoute>\n\s+<Route>\n\s+<h1>/);
    expect(tree).toMatch(/\|1\n\s+\?unknown\(react-router: route path is unknown\(JSON\.parse\)\)/);
  });
});
