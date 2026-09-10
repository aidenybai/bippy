import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  flattenTransparentFibers,
  getFrameworkProfile,
  renderFrameworkTarget,
  type FrameworkRenderTarget,
} from "../src/frameworks/index.js";
import { createNextModel } from "../src/frameworks/next-externals.js";
import {
  formatPattern,
  getRenderPattern,
  getRenderRootChildren,
  type PatternNode,
} from "../src/harness/index.js";
import type { RuntimeFiberSnapshot, SnapshotWorkTag } from "../src/harness/snapshot.js";
import { enumerateStateSpace } from "../src/harness/state-space.js";
import { readInstalledVersion } from "../src/libraries/installed-version.js";
import type { RuntimeObservations } from "../src/types.js";
import { ForwardRefTag } from "../src/work-tags.js";

// Next.js cannot mount inside happy-dom, so its adapters are checked
// structurally here; reality checks for Next run through the corpus (browser
// capture of a real dev server).

const FIXTURES = join(import.meta.dirname, "framework-fixtures");

const render = async (
  fixture: string,
  target: FrameworkRenderTarget,
  externalPackageAllowList: string[] = [],
  observations?: RuntimeObservations,
) => {
  const rootDirectory = join(FIXTURES, fixture);
  const result = await renderFrameworkTarget(target, {
    rootDirectory,
    tsconfigPath: join(rootDirectory, "tsconfig.json"),
    externalPackageAllowList,
    observations,
  });
  return {
    result,
    tree: formatPattern(getRenderPattern(result)),
    errors: result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
  };
};

const lines = (tree: string): string[] => tree.split("\n").map((line) => line.trim());

/** A copy of `fixture` whose `node_modules/<packageName>/package.json` reports `version`. */
const withInstalledPackage = async (
  fixture: string,
  packageName: string,
  version: string,
): Promise<string> => {
  const rootDirectory = await mkdtemp(join(tmpdir(), `bippy-${fixture}-`));
  await cp(join(FIXTURES, fixture), rootDirectory, { recursive: true });
  const packageDirectory = join(rootDirectory, "node_modules", packageName);
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(
    join(packageDirectory, "package.json"),
    JSON.stringify({ name: packageName, version }),
  );
  return rootDirectory;
};

const renderPagesWithNext = async (version: string, route: string) => {
  const rootDirectory = await withInstalledPackage("next-pages", "next", version);
  const result = await renderFrameworkTarget(
    { framework: "next-pages", route },
    { rootDirectory, tsconfigPath: join(rootDirectory, "tsconfig.json") },
  );
  const pattern = getRenderPattern(result);
  return {
    pattern,
    tree: formatPattern(pattern),
    errors: result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
  };
};

const harnessRequire = createRequire(import.meta.url);

/** A CommonJS module re-exporting the harness's `specifier` as a React build of another `version`, without `Activity`. */
const reactBuildStub = (specifier: string, version: string): string =>
  `const { Activity, unstable_Activity, ...build } = require(${JSON.stringify(harnessRequire.resolve(specifier))});
module.exports = { ...build, version: ${JSON.stringify(version)} };`;

/**
 * A copy of the `next-app` fixture with `next.config.js`, an `/activity` page and
 * the React build Next bundles for `app/` at `next/dist/compiled/react<channel>`,
 * reporting `version` and lacking `Activity`.
 */
const withNextVendoredReact = async (
  nextConfig: string,
  channel: "" | "-experimental",
  version: string,
): Promise<string> => {
  const rootDirectory = await withInstalledPackage("next-app", "next", "15.5.9");
  await writeFile(join(rootDirectory, "next.config.js"), nextConfig);
  const pageDirectory = join(rootDirectory, "app", "activity");
  await mkdir(pageDirectory);
  await writeFile(
    join(pageDirectory, "page.tsx"),
    `"use client";
import { Activity } from "react";
export default function ActivityPage() {
  return <Activity mode="visible"><p>shown</p></Activity>;
}
`,
  );
  const compiledDirectory = join(rootDirectory, "node_modules", "next", "dist", "compiled");
  const writeBuild = async (name: string, files: Record<string, string>): Promise<void> => {
    const buildDirectory = join(compiledDirectory, name);
    await mkdir(buildDirectory, { recursive: true });
    await writeFile(
      join(buildDirectory, "package.json"),
      JSON.stringify({ name, main: "index.cjs", type: "commonjs" }),
    );
    for (const [fileName, source] of Object.entries(files)) {
      await writeFile(join(buildDirectory, fileName), source);
    }
  };
  await writeBuild(`react${channel}`, { "index.cjs": reactBuildStub("react", version) });
  await writeBuild(`react-dom${channel}`, {
    "index.cjs": reactBuildStub("react-dom", version),
    "client.js": reactBuildStub("react-dom/client", version),
  });
  return rootDirectory;
};

const renderActivityPage = async (
  nextConfig: string,
  channel: "" | "-experimental",
  version: string,
) => {
  const rootDirectory = await withNextVendoredReact(nextConfig, channel, version);
  const result = await renderFrameworkTarget(
    { framework: "next-app", route: "/activity" },
    { rootDirectory, tsconfigPath: join(rootDirectory, "tsconfig.json") },
  );
  return formatPattern(getRenderPattern(result));
};

const findFiberTags = (nodes: PatternNode[], name: string): SnapshotWorkTag[] =>
  nodes.flatMap((node) =>
    node.kind === "fiber"
      ? [...(node.name === name ? [node.tag] : []), ...findFiberTags(node.children, name)]
      : [],
  );

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
      /<nav>\n\s+<Form>\n\s+<form>\n\s+<input>(\n\s+<LinkComponent>[\s\S]*?<a>){2}\n\s+<NavLink>[\s\S]*?<PendingDot>\n\s+<svg>\n\s+<path>\n\s+<span>/,
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

  it("calls forwardRef and memo wrappers as plain functions on the server", async () => {
    const { tree, errors } = await render("next-app", { framework: "next-app", route: "/" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /<Counter>\n\s+<button>\n(\s+(<[^>]+>|"[^"]*")\n)*\s+<div>\n\s+<span>\n\s+<Toaster>/,
    );
    expect(tree).not.toContain("<Card>");
    expect(tree).not.toContain("<Badge>");
  });

  it('treats exports of a "use client" module as client references even when defined elsewhere', async () => {
    const { tree, errors } = await render("next-app", { framework: "next-app", route: "/" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<TogglePrimitive>\n\s+<button>\n\s+<LabelPrimitive>\n\s+<label>\n/);
  });

  it("unwraps key-less server fragments the way Flight serializes them", async () => {
    const { tree, errors } = await render("next-app", { framework: "next-app", route: "/" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<label>\n\s+<h2>\n\s+<h3>\n\s+"Static tagline"$/);
  });

  it("renders module-scope elements on the server only when a server component passes them as props", async () => {
    const { tree, errors } = await render("next-app", { framework: "next-app", route: "/social" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /<section>\n\s+<SocialLinks>\n\s+<ul>\n\s+<li> key="Website"\n\s+<svg>\n\s+<ClientSocial>/,
    );
    expect(tree).toMatch(
      /<ClientSocial>\n\s+<SocialLinks>\n\s+<ul>\n\s+<li> key="Website"\n\s+<GlobeIcon>\n\s+<svg>/,
    );
  });

  it("instantiates a shared module separately for the server graph, where client-only React APIs are undefined", async () => {
    const { tree, errors } = await render("next-app", { framework: "next-app", route: "/social" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /<ClientSocial>[\s\S]*?<GlobeIcon>\n\s+<svg>\n\s+<ContextIcon>\n\s+<ContextConsumer>\n\s+<svg>\n\s+<path>\n\s+<svg>\n\s+<path>$/,
    );
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
    expect(tree).toMatch(/<Slottable> key="\.0"\n\s+"slotted"\n\s+<header>\n\s+<ForwardRef>/);
    expect(tree).not.toContain("<Hero>");
    expect(tree).not.toContain("Memo");
  });

  it("models next/image as ForwardRef -> ForwardRef -> <img>, preloading only priority images", async () => {
    const { tree } = await render("next-app", { framework: "next-app", route: "/" });
    expect(tree).toMatch(
      /<header>\n\s+<ForwardRef>\n\s+<ForwardRef>\n\s+<img>\n\s+<ImagePreload>\n\s+<ForwardRef>\n\s+<ForwardRef>\n\s+<img>\n\s+<main>/,
    );
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
    expect(tree).toMatch(/<a>\n\s+"Notes"\n\s+<PendingDot>\n\s+<svg>/);
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

  it("resolves the default of a `require`d next subpath through CommonJS interop", async () => {
    const { tree, errors } = await render(
      "next-app",
      { framework: "next-app", route: "/analytics" },
      ["analytics-kit"],
    );
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<section>\n\s+<Script>\n\s+<script>$/);
    expect(tree).not.toContain("<default>");
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

  it("materializes with the canary React build Next bundles for app/ instead of the app's own react", async () => {
    const tree = await renderActivityPage("module.exports = {};", "", "19.2.0-canary-stub");
    expect(tree).toContain("?unknown(activity is not available in React 19.2.0-canary-stub)");
    expect(tree).not.toContain("<Activity>");
  });

  it("switches to Next's experimental React build when next.config enables viewTransition", async () => {
    const tree = await renderActivityPage(
      "module.exports = { experimental: { viewTransition: true } };",
      "-experimental",
      "19.2.0-experimental-stub",
    );
    expect(tree).toContain("?unknown(activity is not available in React 19.2.0-experimental-stub)");
  });

  it("keeps the app's own react when Next's bundled build is absent", async () => {
    const rootDirectory = await withInstalledPackage("next-app", "next", "15.5.9");
    await writeFile(
      join(rootDirectory, "next.config.js"),
      "module.exports = { experimental: { viewTransition: true } };",
    );
    const activityRoot = await withNextVendoredReact("module.exports = {};", "", "unused");
    await cp(join(activityRoot, "app", "activity"), join(rootDirectory, "app", "activity"), {
      recursive: true,
    });
    const result = await renderFrameworkTarget(
      { framework: "next-app", route: "/activity" },
      { rootDirectory, tsconfigPath: join(rootDirectory, "tsconfig.json") },
    );
    expect(lines(formatPattern(getRenderPattern(result)))).toContain("<Activity>");
  });

  it("models Next 13.4 next/image preloads as next/head and next/dynamic client-only as NoSSR", async () => {
    const rootDirectory = await withInstalledPackage("next-app", "next", "13.4.4");
    const renderRoute = async (route: string) => {
      const result = await renderFrameworkTarget(
        { framework: "next-app", route },
        { rootDirectory, tsconfigPath: join(rootDirectory, "tsconfig.json") },
      );
      return formatPattern(getRenderPattern(result));
    };
    expect(await renderRoute("/gallery")).toMatch(
      /<figure>\n\s+<ForwardRef>\n\s+<ForwardRef>\n\s+<img>\n\s+<Head>\n\s+<SideEffect>\n\s+<ForwardRef>\n\s+<ForwardRef>\n\s+<img>/,
    );
    expect(await renderRoute("/about")).toMatch(
      /<LoadableComponent>\n\s+<Suspense>\n\s+<Offscreen>\n\s+<NoSSR>\n\s+<Chart>\n\s+<figure>/,
    );
  });

  it("lets a client Children.map lose the keys of server elements Flight deferred past its row size", async () => {
    const { tree, errors } = await render("next-app", { framework: "next-app", route: "/ticker" });
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /<Ticker>\n\s+<ul>\n\s+\?branch\(Flight deferred the elements past its row size limit\)[^\n]*\n\s+\|0 \(preferred\)\n\s+<li> key="\.0:\$aapl"\n\s+<span> key="aapl"\n\s+<li> key="\.0:\$msft"\n\s+<span> key="msft"\n\s+<li> key="\.0:\$nvda"\n\s+<span> key="nvda"\n\s+<li> key="\.1"\n\s+<em>\n\s+\|1\n\s+<li> key="\.0:0"\n\s+<span> key="aapl"\n\s+<li> key="\.0:1"\n\s+<span> key="msft"\n\s+<li> key="\.0:2"\n\s+<span> key="nvda"\n\s+<li> key="\.1"\n\s+<em>\n\s+\|2\n\s+<li> key="\.0:\$aapl"\n\s+<span> key="aapl"\n\s+<li> key="\.0:1"\n\s+<span> key="msft"\n\s+<li> key="\.0:2"\n\s+<span> key="nvda"\n\s+<li> key="\.1"\n\s+<em>\n\s+\|3\n\s+<li> key="\.0:\$aapl"\n\s+<span> key="aapl"\n\s+<li> key="\.0:\$msft"\n\s+<span> key="msft"\n\s+<li> key="\.0:2"\n\s+<span> key="nvda"\n\s+<li> key="\.1"\n\s+<em>$/,
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
    const { tree, errors } = await renderPagesWithNext("15.5.0", "/gallery");
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

  it("preloads next/image through next/head instead of ReactDOM.preload", async () => {
    const { tree } = await renderPagesWithNext("15.5.0", "/");
    expect(tree).toMatch(
      /<ForwardRef>\n\s+<ForwardRef>\n\s+<img>\n\s+<ImagePreload>\n\s+<Head>\n\s+<SideEffect>/,
    );
  });

  it("gives the forwardRef Link no own displayName or name: styled(Link) is Styled(Component)", async () => {
    const { tree, errors } = await renderPagesWithNext("13.4.9", "/link-name");
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /<nav>\n\s+<Styled\(Component\)>\n\s+<Insertion>\n\s+<LinkComponent>\n\s+<a>\n\s+<em>\n\s+"undefined"\n\s+" "\n\s+"false"\n\s+" "\n\s+"undefined"$/m,
    );
  });

  it("feeds dynamic segments into useRouter().query", async () => {
    const { tree } = await render("next-pages", { framework: "next-pages", route: "/posts/42" });
    expect(tree).toMatch(/<h1>\n\s+"Post "\n\s+"42"/);
  });

  it("reports the matched page file's route as useRouter().pathname", async () => {
    const post = await render("next-pages", { framework: "next-pages", route: "/posts/42" });
    expect(post.tree).toMatch(/<h1>\n\s+"Post "\n\s+"42"\n\s+<em>/);
    expect(post.tree).not.toContain("?branch");
    const home = await render("next-pages", { framework: "next-pages", route: "/" });
    expect(home.tree).toContain("<code>");
    expect(home.tree).not.toContain("<s>");
  });

  it("matches catch-all pages", async () => {
    const { tree, errors } = await render("next-pages", {
      framework: "next-pages",
      route: "/docs/a/b",
    });
    expect(errors).toEqual([]);
    expect(tree).toContain("<Docs>");
  });

  it("applies next.config's compiler.styledComponents naming to the app's styled components", async () => {
    const { tree, errors } = await render(
      "next-pages",
      { framework: "next-pages", route: "/styled" },
      ["styled-components"],
    );
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<Styled>\n\s+<styled__Page>\n\s+<main>/);
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

  it("leaves pageProps of a data-fetching page unknown without a capture", async () => {
    const { tree, errors } = await render("next-pages", {
      framework: "next-pages",
      route: "/greeting",
    });
    expect(errors).toEqual([]);
    expect(tree).toContain("pageProps come from data fetching at request time");
    expect(tree).toMatch(/<h1>\n\s+"Hello, "\n\s+\?unknown/);
    expect(tree).toMatch(/\?branch\(conditional on unknown\([\s\S]*?<p>\n\s+\|1\n\s+<aside>/);
  });

  it("renders the App with the captured __NEXT_DATA__.props like next/client does", async () => {
    const { tree, errors } = await render(
      "next-pages",
      { framework: "next-pages", route: "/greeting" },
      [],
      {
        globals: {
          __NEXT_DATA__: {
            props: { pageProps: { name: "Ada", isReturning: true }, __N_SSP: true },
            page: "/greeting",
            query: {},
            buildId: "development",
          },
        },
        queries: [],
      },
    );
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<h1>\n\s+"Hello, "\n\s+"Ada"\n\s+<p>\n\s+<Script>/);
    expect(tree).not.toContain("<aside>");
    expect(tree).not.toContain("?");
  });

  it("never renders api routes", async () => {
    const { errors } = await render("next-pages", { framework: "next-pages", route: "/api/hello" });
    expect(errors.map((diagnostic) => diagnostic.code)).toEqual(["next-pages-no-page"]);
  });

  it("splices out the Next 16 dev client around _app, keeping the app's own next/head", () => {
    const fiber = (
      name: string | null,
      tag: SnapshotWorkTag,
      children: RuntimeFiberSnapshot[] = [],
      props: RuntimeFiberSnapshot["props"] = {},
    ): RuntimeFiberSnapshot => ({ tag, name, key: null, text: null, props, children });
    const app = fiber("App", "FunctionComponent", [
      fiber("Head", "FunctionComponent", [fiber("SideEffect", "FunctionComponent")]),
      fiber("Portal", "FunctionComponent", [
        fiber("Portal", "HostPortal", [fiber("div", "HostComponent")]),
      ]),
    ]);
    const runtimeRoot = fiber("HostRoot", "HostRoot", [
      fiber("Root", "FunctionComponent", [
        fiber("Head", "FunctionComponent", [], { callback: "[function]" }),
        fiber("AppContainer", "FunctionComponent", [
          fiber("Container", "ClassComponent", [
            fiber("PagesDevOverlayBridge", "FunctionComponent", [
              fiber("PagesDevOverlayErrorBoundary", "ClassComponent", [
                fiber("RouterContext", "ContextProvider", [
                  app,
                  fiber(
                    "Portal",
                    "FunctionComponent",
                    [
                      fiber("Portal", "HostPortal", [
                        fiber("RouteAnnouncer", "FunctionComponent", [fiber("p", "HostComponent")]),
                      ]),
                    ],
                    { type: "next-route-announcer" },
                  ),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const flattened = flattenTransparentFibers(
      {
        reactVersion: null,
        rendererName: null,
        buildType: null,
        roots: [runtimeRoot],
        capturedAt: "",
      },
      getFrameworkProfile("next-pages"),
    );
    expect(flattened.roots[0].children).toEqual([app]);
  });

  it("mounts without StrictMode when next.config does not enable it", async () => {
    const { tree } = await render("next-pages", { framework: "next-pages", route: "/" });
    expect(tree).not.toContain("<StrictMode>");
    expect(lines(tree).slice(0, 2)).toEqual(["<HostRoot>", "<App>"]);
  });

  it("wraps the tree in StrictMode when a next.config function sets reactStrictMode", async () => {
    const { tree, errors } = await render("next-pages-strict", {
      framework: "next-pages",
      route: "/",
    });
    expect(errors).toEqual([]);
    expect(lines(tree)).toEqual(["<HostRoot>", "<StrictMode>", "<Home>", "<h1>"]);
  });

  it("compiles the css prop through the tsconfig's inherited jsxImportSource unless a file names its own", async () => {
    const { tree, errors } = await render("next-pages-emotion-jsx", {
      framework: "next-pages",
      route: "/",
    });
    expect(errors).toEqual([]);
    expect(lines(tree)).toEqual([
      "<HostRoot>",
      "<Home>",
      "<EmotionCssPropInternal>",
      "<Insertion>",
      "<main>",
      "<Badge>",
      "<span>",
      "<p>",
    ]);
  });

  it("keeps StrictMode a branch when a config plugin hides reactStrictMode", async () => {
    const { tree } = await render("next-pages-plugin-config", {
      framework: "next-pages",
      route: "/",
    });
    expect(tree).toMatch(/^<HostRoot>\n\s+\?branch\(next\.config reactStrictMode is /);
    expect(tree).toContain("<StrictMode>");
  });

  it("compares the build phase against next/constants read off a namespace require", async () => {
    const { tree, errors } = await render("next-pages-phase-config", {
      framework: "next-pages",
      route: "/",
    });
    expect(errors).toEqual([]);
    expect(lines(tree)).toEqual(["<HostRoot>", "<StrictMode>", "<Home>", "<h1>"]);
  });

  it("reads reactStrictMode through @sentry/nextjs withSentryConfig", async () => {
    const { tree, errors } = await render("next-pages-sentry-config", {
      framework: "next-pages",
      route: "/",
    });
    expect(errors).toEqual([]);
    expect(lines(tree)).toEqual(["<HostRoot>", "<StrictMode>", "<Home>", "<h1>"]);
  });

  it("calls the next.config function withSentryConfig wraps with the build phase", async () => {
    const { tree, errors } = await render("next-pages-sentry-config-function", {
      framework: "next-pages",
      route: "/",
    });
    expect(errors).toEqual([]);
    expect(lines(tree)).toEqual(["<HostRoot>", "<StrictMode>", "<Home>", "<h1>"]);
  });

  it("models next/head, next/image and next/legacy/image after the current next", async () => {
    const { tree, errors } = await renderPagesWithNext("15.5.0", "/media");
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<Head>\n\s+<SideEffect>\n\s+<ForwardRef>\n\s+<ForwardRef>\n\s+<img>/);
    expect(tree).toMatch(
      /<Image>\n\s+<span>\n\s+<span>\n\s+<img>\n\s+<ImageElement>\n\s+<img>\n\s+<noscript>/,
    );
    expect(tree).toMatch(
      /<Image>\n\s+<span>\n\s+<ImageElement>\n\s+<img>\n\s+<Head>\n\s+<SideEffect>/,
    );
  });

  it("follows the installed next version: 12.1 renders head through a class and images inline", async () => {
    const { pattern, tree } = await renderPagesWithNext("12.1.0", "/media");
    expect(tree).toMatch(
      /<Head>\n\s+<_class>\n\s+<Image>\n\s+<span>\n\s+<span>\n\s+<img>\n\s+<img>\n\s+<noscript>/,
    );
    expect(tree).toMatch(/<Image>\n\s+<span>\n\s+<img>\n\s+<Head>\n\s+<_class>/);
    expect(tree).not.toContain("<ImageElement>");
    expect(findFiberTags(pattern, "_class")).toEqual(["ClassComponent", "ClassComponent"]);
  });

  it("follows the installed next version: 12.1.1 introduced ImageElement while head stays a class", async () => {
    const { tree } = await renderPagesWithNext("12.1.5", "/media");
    expect(tree).toMatch(
      /<Head>\n\s+<_class>\n\s+<Image>\n\s+<span>\n\s+<span>\n\s+<img>\n\s+<ImageElement>\n\s+<img>\n\s+<noscript>/,
    );
    expect(tree).toMatch(/<Image>\n\s+<span>\n\s+<ImageElement>\n\s+<img>\n\s+<Head>\n\s+<_class>/);
  });

  it("splices out the client bootstrap around _app: StrictMode, the head commit hook and the route announcer portal", () => {
    const fiber = (
      name: string,
      tag: SnapshotWorkTag,
      children: RuntimeFiberSnapshot[] = [],
      props: RuntimeFiberSnapshot["props"] = {},
    ): RuntimeFiberSnapshot => ({ tag, name, key: null, text: null, props, children });
    const appHead = fiber("Head", "FunctionComponent", [fiber("SideEffect", "FunctionComponent")]);
    const page = fiber("Home", "FunctionComponent", [fiber("div", "HostComponent")]);
    const runtime = {
      reactVersion: null,
      rendererName: null,
      buildType: null,
      capturedAt: "",
      roots: [
        fiber("HostRoot", "HostRoot", [
          fiber("Root", "FunctionComponent", [
            fiber("StrictMode", "Mode", [
              fiber("Head", "FunctionComponent", [], { callback: "[function]" }),
              fiber("AppContainer", "FunctionComponent", [
                fiber("Container", "ClassComponent", [
                  fiber("RouterContext", "ContextProvider", [
                    fiber("MyApp", "FunctionComponent", [appHead, page]),
                    fiber(
                      "Portal",
                      "FunctionComponent",
                      [
                        fiber("Portal", "HostPortal", [
                          fiber("RouteAnnouncer", "FunctionComponent", [
                            fiber("p", "HostComponent"),
                          ]),
                        ]),
                      ],
                      { type: "next-route-announcer" },
                    ),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ],
    };
    const flattened = flattenTransparentFibers(runtime, getFrameworkProfile("next-pages"));
    expect(flattened.roots[0].children).toEqual([
      fiber("MyApp", "FunctionComponent", [appHead, page]),
    ]);
  });

  it("splices react-router 6.4-6.10's RouterProvider stack, which mounts routes through <Routes />", () => {
    const fiber = (
      name: string,
      tag: SnapshotWorkTag,
      children: RuntimeFiberSnapshot[] = [],
    ): RuntimeFiberSnapshot => ({ tag, name, key: null, text: null, props: {}, children });
    const matched = fiber("RenderedRoute", "FunctionComponent", [
      fiber("Route", "ContextProvider", [
        fiber("LoginPage", "FunctionComponent", [fiber("form", "HostComponent")]),
      ]),
    ]);
    const runtime = {
      reactVersion: "18.2.0",
      rendererName: null,
      buildType: null,
      capturedAt: "",
      roots: [
        fiber("HostRoot", "HostRoot", [
          fiber("RouterProvider", "FunctionComponent", [
            fiber("DataRouter", "ContextProvider", [
              fiber("DataRouterState", "ContextProvider", [
                fiber("Router", "FunctionComponent", [
                  fiber("Navigation", "ContextProvider", [
                    fiber("Location", "ContextProvider", [
                      fiber("Routes", "FunctionComponent", [
                        fiber("RenderErrorBoundary", "ClassComponent", [matched]),
                      ]),
                    ]),
                  ]),
                ]),
              ]),
            ]),
          ]),
        ]),
      ],
    };
    const flattened = flattenTransparentFibers(runtime, getFrameworkProfile("react-router"));
    expect(flattened.roots[0].children).toEqual([
      fiber("RouterProvider", "FunctionComponent", [matched]),
    ]);
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

describe("react router framework mode with branchy route descriptors", () => {
  it("enumerates a branch inside links()/meta() as concrete head elements correlated with the page", async () => {
    const { result, tree, errors } = await render("react-router-branchy-links", {
      framework: "react-router",
      route: "/",
      entry: "app/routes.ts",
    });
    expect(errors).toEqual([]);
    expect(tree.slice(0, tree.indexOf("<body>"))).not.toContain("?unknown");
    expect(tree).toMatch(
      /<Links>\n\s+\?branch\(conditional on[^\n]*\n\s+\|0\n\s+<Fragment>\n\s+<link> key="\{\\"href\\":\\"\/app.css\\",\\"rel\\":\\"stylesheet\\"\}"\n\s+<link> key="\{\\"href\\":\\"\/icon.png\\",\\"rel\\":\\"icon\\"\}"\n\s+\|1 \(preferred\)\n\s+<Fragment>\n\s+<link> key="\{\\"href\\":\\"\/app.css\\",\\"rel\\":\\"stylesheet\\"\}"\n\s+<link> key="\{\\"href\\":\\"\/icon@2x.png\\",\\"rel\\":\\"icon\\"\}"/,
    );
    expect(tree).toMatch(
      /<Meta>\n\s+\?branch\(conditional on[^\n]*\n\s+\|0\n\s+<title> key="title"\n\s+<meta> key="\{\\"name\\":\\"description\\",\\"content\\":\\"Home\\"\}"\n\s+\|1 \(preferred\)\n\s+<title> key="title"\n\s+<meta> key="\{\\"name\\":\\"description\\",\\"content\\":\\"Sharp home\\"\}"/,
    );
    const space = enumerateStateSpace([getRenderPattern(result)]);
    expect(space.omitted).toBeNull();
    expect(space.states).toHaveLength(2);
  });

  it("reads a match's handle from the route module for useMatches()", async () => {
    const rootDirectory = join(FIXTURES, "react-router-branchy-links");
    const result = await renderFrameworkTarget(
      { framework: "react-router", route: "/", entry: "app/routes.ts" },
      {
        rootDirectory,
        tsconfigPath: join(rootDirectory, "tsconfig.json"),
        observations: {
          globals: {},
          queries: [],
          router: {
            location: { pathname: "/", search: "", hash: "" },
            matches: [
              { id: "root", pathname: "/", params: {} },
              { id: "routes/home", pathname: "/", params: {} },
            ],
            loaderData: {},
            navigationState: "idle",
            revalidationState: "idle",
          },
        },
      },
    );
    const tree = formatPattern(getRenderPattern(result));
    expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    expect(tree).toMatch(
      /<Breadcrumbs>\n\s+<nav>\n\s+\?branch\(conditional on[^\n]*\n\s+\|0\n\s+<span> key="Home"\n\s+\|1 \(preferred\)\n\s+<span> key="Retina home"/,
    );
    expect(tree).not.toContain("?unknown");
  });

  it("derives useMatches() from the statically matched chain without a capture", async () => {
    const { tree, errors } = await render("react-router-branchy-links", {
      framework: "react-router",
      route: "/",
      entry: "app/routes.ts",
    });
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /<Breadcrumbs>\n\s+<nav>\n\s+\?branch\(conditional on[^\n]*\n\s+\|0\n\s+<span> key="Home"\n\s+\|1 \(preferred\)\n\s+<span> key="Retina home"/,
    );
    expect(tree).not.toContain("?unknown");
    expect(tree).not.toContain("*repeat");
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

  it("calls <NavLink> render-prop children and className with the resolved active state", async () => {
    const { tree, errors } = await target("/about");
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /<nav>\n\s+<NavLink>\n\s+<Link>\n\s+<a>\n\s+<span>\n\s+<NavLink>\n\s+<Link>\n\s+<a>\n\s+<i>\n\s+<Outlet>/,
    );
    expect(tree).not.toContain("?unknown(NavLink");
  });
});

describe("remix classic compiler (remix.config.js, no client entry)", () => {
  const target = (route: string) => render("remix-classic", { framework: "react-router", route });

  it("hydrates <StrictMode><RemixBrowser /></StrictMode> like @remix-run/dev's default entry", async () => {
    const { tree, errors } = await target("/");
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /<HostRoot>\n\s+<StrictMode>\n\s+<RemixBrowser>\n\s+<Remix>\n\s+<RouterProvider>\n\s+<DataRouterState>\n\s+<Location>\n\s+<RenderedRoute>\n\s+<Route>\n\s+<default>\n\s+<html>/,
    );
    expect(tree).toMatch(/<LiveReload>\n\s+<script>\n\s+<Fragment>$/);
  });

  it("reads the `app/routes` file convention and never inlines critical CSS", async () => {
    const { tree, errors } = await target("/posts/hello");
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<Links>\n\s+<Fragment>\n\s+<link>/);
    expect(tree).toMatch(
      /<Outlet>\n\s+<ContextProvider>\n\s+<RenderedRoute>\n\s+<Route>\n\s+<default>\n\s+<article>\n\s+<h1>/,
    );
    expect(tree).toContain("useActionData() is only known at runtime");
  });

  it("leaves MDX route modules to the framework's compiler as an explicit unknown", async () => {
    const { tree, errors } = await target("/docs");
    expect(errors).toEqual([]);
    expect(tree).toMatch(
      /<Route>\n\s+\?unknown\(mdx route module routes\/docs.mdx is compiled by the framework\)/,
    );
    expect(tree).toMatch(
      /<Meta>\n\s+\?unknown\(meta and links of routes\/docs.mdx come from the framework's compiler\)\n\s+<Links>\n\s+\?unknown\(meta and links/,
    );
  });

  it("keeps <Scripts>'s preloads when nothing re-renders the router after hydration", async () => {
    const { tree } = await target("/");
    expect(tree).toMatch(
      /<Scripts>\n\s+<link>\n\s+<link>\n\s+<Fragment>\n\s+\?unknown\(remix: entry imports come from the build manifest\)\n\s+<link>\n\s+<link>\n\s+<Fragment>\n\s+<script>\n\s+<script>\n\s+<Fragment>\n\s+<LiveReload>/,
    );
  });
});

describe("remix vite plugin", () => {
  const target = (route: string) => render("remix-vite", { framework: "react-router", route });

  it("inlines critical CSS in <Links>, renders <LiveReload> as null and models useFetcher().Form", async () => {
    const { tree, errors } = await target("/");
    expect(errors).toEqual([]);
    expect(tree).toMatch(/<Links>\n\s+<style>\n\s+<Fragment>\n\s+<link>/);
    expect(tree).toMatch(/<LiveReload>$/);
    expect(tree).toMatch(/<Index>\n\s+<fetcher.Form>\n\s+<Form>\n\s+<form>\n\s+<button>/);
  });

  it("skips the manifest preload under future.v3_lazyRouteDiscovery and preloads the matched modules", async () => {
    const { tree } = await target("/about");
    expect(tree).toMatch(
      /<Scripts>\n\s+<link>\n\s+<Fragment>\n\s+<link> key="\/app\/root.tsx"\n\s+<link> key="\/app\/routes\/about.tsx"\n\s+<Fragment>\n\s+<script>\n\s+<script>\n\s+<Fragment>\n\s+<LiveReload>$/,
    );
  });

  it("re-renders <Scripts> to null once route discovery patches in a linked route", async () => {
    const { tree } = await target("/");
    expect(tree).toMatch(/<Link>\n\s+<Link>\n\s+<a>\n\s+<Scripts>\n\s+<LiveReload>$/);
  });
});
