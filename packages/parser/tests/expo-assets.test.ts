import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { createServedAssets } from "../src/graph/served-assets.js";

const createProject = (): string => {
  const rootDirectory = mkdtempSync(path.join(tmpdir(), "bippy-expo-assets-"));
  mkdirSync(path.join(rootDirectory, "assets", "images"), { recursive: true });
  mkdirSync(path.join(rootDirectory, "public"));
  for (const fileName of ["logo.png", "logo@2x.png", "hero@3x.jpg", "notes.json"]) {
    writeFileSync(path.join(rootDirectory, "assets", "images", fileName), "");
  }
  writeFileSync(path.join(rootDirectory, "public", "favicon.ico"), "");
  return rootDirectory;
};

const createExpoServedAssets = (rootDirectory: string) =>
  createServedAssets({
    rootDirectory,
    servedDirectory: rootDirectory,
    publicDirectory: path.join(rootDirectory, "public"),
    base: "/",
    origin: "http://localhost:8081",
    bundler: "expo",
    environment: null,
    viteVersion: null,
    readPackageVersion: () => null,
    shouldInlineAsset: () => null,
  });

describe("Expo dev server assets", () => {
  it("serves `/assets/?unstable_path=` requests from the project root like Metro", () => {
    const rootDirectory = createProject();
    const assets = createExpoServedAssets(rootDirectory);
    expect(assets.findServedFile("/assets/?unstable_path=.%2Fassets%2Fimages/logo.png")).toBe(
      path.join(rootDirectory, "assets", "images", "logo.png"),
    );
    expect(assets.findServedFile("http://localhost:8081/assets/assets/images/logo.png")).toBe(
      path.join(rootDirectory, "assets", "images", "logo.png"),
    );
  });

  it("picks the smallest scale variant at or above the requested one, else the largest", () => {
    const rootDirectory = createProject();
    const assets = createExpoServedAssets(rootDirectory);
    expect(assets.findServedFile("/assets/?unstable_path=.%2Fassets%2Fimages/logo@1.5x.png")).toBe(
      path.join(rootDirectory, "assets", "images", "logo@2x.png"),
    );
    expect(assets.findServedFile("/assets/?unstable_path=.%2Fassets%2Fimages/hero.jpg")).toBe(
      path.join(rootDirectory, "assets", "images", "hero@3x.jpg"),
    );
  });

  it("does not serve missing assets, unregistered extensions, paths outside the root, or other origins", () => {
    const rootDirectory = createProject();
    const assets = createExpoServedAssets(rootDirectory);
    expect(assets.findServedFile("/assets/?unstable_path=.%2Fassets%2Fimages/missing.png")).toBe(
      null,
    );
    expect(assets.findServedFile("/assets/?unstable_path=.%2Fassets%2Fimages/notes.json")).toBe(
      null,
    );
    expect(assets.findServedFile("/assets/?unstable_path=..%2Foutside.png")).toBe(null);
    expect(assets.findServedFile("http://cdn.example/assets/assets/images/logo.png")).toBe(null);
  });

  it("serves the public directory for non-asset requests", () => {
    const rootDirectory = createProject();
    const assets = createExpoServedAssets(rootDirectory);
    expect(assets.findServedFile("/favicon.ico")).toBe(
      path.join(rootDirectory, "public", "favicon.ico"),
    );
    expect(assets.findServedFile("/missing.ico")).toBe(null);
  });
});
