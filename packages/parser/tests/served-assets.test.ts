import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createServedAssets } from "../src/graph/served-assets.js";
import type { ViteAppType } from "../src/graph/vite-config.js";

const INDEX_HTML = "<!doctype html><html><body><div id='root'></div></body></html>";
const ABOUT_HTML = "<!doctype html><html><body>about</body></html>";
const LOCALE_JSON = '{"Home":"Home"}';

interface ServedProject {
  read: ReturnType<typeof createServedAssets>["read"];
}

const roots: string[] = [];

const createProject = (
  options: { appType?: ViteAppType; proxyContexts?: string[] | null } = {},
): ServedProject => {
  const rootDirectory = mkdtempSync(path.join(tmpdir(), "served-assets-"));
  roots.push(rootDirectory);
  const write = (fileName: string, source: string): void => {
    const filePath = path.join(rootDirectory, fileName);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, source);
  };
  write("index.html", INDEX_HTML);
  write("about.html", ABOUT_HTML);
  write("docs/index.html", ABOUT_HTML);
  write("public/locales/en/translation.json", LOCALE_JSON);
  const assets = createServedAssets({
    rootDirectory,
    servedDirectory: rootDirectory,
    publicDirectory: path.join(rootDirectory, "public"),
    base: "/",
    origin: null,
    viteVersion: "5.3.3",
    shouldInlineAsset: () => null,
    appType: options.appType ?? "spa",
    proxyContexts: options.proxyContexts === undefined ? [] : options.proxyContexts,
  });
  return { read: assets.read };
};

afterEach(() => {
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("served files", () => {
  it("serves the public directory and the root at the URL root", () => {
    const { read } = createProject();
    expect(read("/locales/en/translation.json")).toBe(LOCALE_JSON);
    expect(read("/about.html")).toBe(ABOUT_HTML);
    expect(read("/")).toBeNull();
    expect(read("/locales/de/translation.json")).toBeNull();
  });
});

describe("HTML fallback", () => {
  it("answers an unmatched HTML-accepting GET with the root index.html in a SPA", () => {
    const { read } = createProject();
    const request = { accept: undefined };
    expect(read("/locales/de/translation.json", request)).toBe(INDEX_HTML);
    expect(read("/settings", { accept: "*/*" })).toBe(INDEX_HTML);
    expect(read("/settings", { accept: "text/html,application/xhtml+xml" })).toBe(INDEX_HTML);
    expect(read("/", request)).toBe(INDEX_HTML);
  });

  it("prefers the page named by the path before the SPA fallback", () => {
    const { read } = createProject({ appType: "mpa" });
    const request = { accept: undefined };
    expect(read("/about", request)).toBe(ABOUT_HTML);
    expect(read("/docs/", request)).toBe(ABOUT_HTML);
    expect(read("/settings", request)).toBeNull();
  });

  it("serves nothing for a request that does not accept HTML, or for the favicon", () => {
    const { read } = createProject();
    expect(read("/settings", { accept: "application/json" })).toBeNull();
    expect(read("/favicon.ico", { accept: undefined })).toBeNull();
  });

  it("leaves proxied URLs, and URLs an undecided proxy might claim, to the upstream", () => {
    const proxied = createProject({ proxyContexts: ["/api", "^/locales/.*"] });
    expect(proxied.read("/api/session", { accept: undefined })).toBeNull();
    expect(proxied.read("/locales/en/translation.json")).toBeNull();
    expect(proxied.read("/settings", { accept: undefined })).toBe(INDEX_HTML);
    const undecided = createProject({ proxyContexts: null });
    expect(undecided.read("/locales/en/translation.json")).toBe(LOCALE_JSON);
    expect(undecided.read("/settings", { accept: undefined })).toBeNull();
  });

  it("never falls back outside a SPA or without a request", () => {
    expect(createProject({ appType: "custom" }).read("/settings", { accept: undefined })).toBeNull();
    expect(createProject().read("/settings")).toBeNull();
  });
});
