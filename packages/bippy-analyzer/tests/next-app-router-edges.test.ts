import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { renderFrameworkTarget } from "../src/frameworks/render-framework.js";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";

const directories: string[] = [];

const writeFile = (directory: string, filename: string, source: string): void => {
  const filePath = join(directory, filename);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);
};

const page = (name: string, text: string): string =>
  `"use client";\nexport default function ${name}() { return <p>${text}</p>; }\n`;

const createApp = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "bippy-next-app-"));
  directories.push(directory);
  writeFile(directory, "package.json", JSON.stringify({ name: "next-app-edges", private: true }));
  writeFile(
    directory,
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
        module: "esnext",
        moduleResolution: "bundler",
        target: "esnext",
        strict: true,
      },
    }),
  );
  return directory;
};

const renderRoute = async (directory: string, route: string, appDirectory?: string) => {
  const result = await renderFrameworkTarget(
    { framework: "next-app", route, appDirectory },
    { rootDirectory: directory, tsconfigPath: join(directory, "tsconfig.json") },
  );
  return {
    tree: formatPattern(getRenderPattern(result)),
    diagnostics: result.diagnostics,
    errors: result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
  };
};

afterEach(() => {
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe("next app router edges", () => {
  it("reports a project that has no app directory", async () => {
    const directory = createApp();
    const rendered = await renderRoute(directory, "/");
    expect(rendered.errors.map((diagnostic) => diagnostic.code)).toEqual(["next-app-missing"]);
    expect(rendered.tree).toContain("next app directory not found");
  });

  it("matches pages nested in route groups and leaves unmatched segments unresolved", async () => {
    const directory = createApp();
    mkdirSync(join(directory, "next.config.js"), { recursive: true });
    writeFile(directory, "custom-app/page.tsx", page("Home", "home"));
    mkdirSync(join(directory, "custom-app/loading.tsx"), { recursive: true });
    writeFile(directory, "custom-app/shop/(home)/page.tsx", page("Sale", "sale"));
    writeFile(directory, "custom-app/void/(blank)/readme.txt", "not a page");
    writeFile(directory, "custom-app/about/gone/page.tsx", page("Gone", "gone"));
    writeFile(directory, "custom-app/only/[id]/page.tsx", page("Item", "item"));
    writeFile(directory, "custom-app/docs/[[...slug]]/page.tsx", page("Docs", "docs"));
    writeFile(directory, "custom-app/files/[...path]/page.tsx", page("Files", "files"));
    mkdirSync(join(directory, "custom-app/bad/page.tsx"), { recursive: true });
    writeFile(directory, "custom-app/team/[id]/extra/page.tsx", page("Member", "member"));
    writeFile(directory, "custom-app/library/[...slug]/missing/page.tsx", page("Shelf", "shelf"));

    const home = await renderRoute(directory, "/", "custom-app");
    expect(home.tree).toContain("<Home>");
    expect(home.errors.map((diagnostic) => diagnostic.code)).toContain("next-app-parse");

    const sale = await renderRoute(directory, "/shop", "custom-app");
    expect(sale.tree).toContain("<Sale>");

    const missingGroup = await renderRoute(directory, "/void", "custom-app");
    expect(missingGroup.errors.map((diagnostic) => diagnostic.code)).toContain("next-app-no-page");

    const gone = await renderRoute(directory, "/about/gone", "custom-app");
    expect(gone.tree).toContain("<Gone>");
    const about = await renderRoute(directory, "/about", "custom-app");
    expect(about.errors.map((diagnostic) => diagnostic.code)).toContain("next-app-no-page");

    const item = await renderRoute(directory, "/only/ada", "custom-app");
    expect(item.tree).toContain("<Item>");
    const bareDynamic = await renderRoute(directory, "/only", "custom-app");
    expect(bareDynamic.errors.map((diagnostic) => diagnostic.code)).toContain("next-app-no-page");

    const docs = await renderRoute(directory, "/docs", "custom-app");
    expect(docs.tree).toContain("<Docs>");
    const nestedDocs = await renderRoute(directory, "/docs/a/b", "custom-app");
    expect(nestedDocs.tree).toContain("<Docs>");

    const files = await renderRoute(directory, "/files/a/b", "custom-app");
    expect(files.tree).toContain("<Files>");
    const bareFiles = await renderRoute(directory, "/files", "custom-app");
    expect(bareFiles.errors.map((diagnostic) => diagnostic.code)).toContain("next-app-no-page");

    const member = await renderRoute(directory, "/team/ada", "custom-app");
    expect(member.errors.map((diagnostic) => diagnostic.code)).toContain("next-app-no-page");
    const shelf = await renderRoute(directory, "/library/a", "custom-app");
    expect(shelf.errors.map((diagnostic) => diagnostic.code)).toContain("next-app-no-page");

    const broken = await renderRoute(directory, "/bad", "custom-app");
    expect(broken.tree).toContain("unparsable page module");
    expect(broken.errors.map((diagnostic) => diagnostic.code)).toContain("next-app-parse");
  });

  it("reports a next-intl request configuration that was not written", async () => {
    const directory = createApp();
    writeFile(directory, "app/page.tsx", page("Home", "home"));
    writeFile(
      directory,
      "next.config.mjs",
      `import createNextIntlPlugin from "next-intl/plugin";
const withNextIntl = createNextIntlPlugin("./i18n/missing");
export default withNextIntl();
`,
    );
    const missing = await renderRoute(directory, "/");
    expect(missing.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toContain(
      "next-intl request configuration ./i18n/missing not found",
    );
    expect(missing.tree).toContain("<Home>");
  });

  it("ignores a next-intl request configuration that cannot be parsed", async () => {
    const directory = createApp();
    writeFile(directory, "app/page.tsx", page("Home", "home"));
    writeFile(
      directory,
      "next.config.mjs",
      `import createNextIntlPlugin from "next-intl/plugin";
const withNextIntl = createNextIntlPlugin("./i18n/request");
export default withNextIntl();
`,
    );
    mkdirSync(join(directory, "i18n/request.tsx"), { recursive: true });
    const broken = await renderRoute(directory, "/");
    expect(broken.errors.map((diagnostic) => diagnostic.code)).toContain("next-app-parse");
    expect(broken.tree).toContain("<Home>");
  });
});
