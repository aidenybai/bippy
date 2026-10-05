import { afterAll } from "vite-plus/test";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { RuntimeFiberSnapshot } from "../../src/harness/snapshot.js";
import { StaticRenderer } from "../../src/render/static-renderer.js";
import type { StaticRendererOptions } from "../../src/render/types.js";

export const createEngineProject = () => {
  const directory = mkdtempSync(resolve(tmpdir(), "bippy-engine-renderer-"));
  symlinkSync(resolve(import.meta.dirname, "../../../../node_modules"), resolve(directory, "node_modules"), "dir");
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  let nextSource = 0;
  const createSource = (source: string): string => {
    const filePath = resolve(directory, `case-${nextSource++}.tsx`);
    writeFileSync(filePath, source);
    return filePath;
  };
  const createRenderer = (options: Partial<StaticRendererOptions> = {}) =>
    new StaticRenderer({ rootDirectory: directory, ...options, execution: "engine" });
  return { directory, createSource, createRenderer };
};

export const getFibers = (roots: RuntimeFiberSnapshot[]): RuntimeFiberSnapshot[] =>
  roots.flatMap((fiber) => [fiber, ...getFibers(fiber.children)]);

export const getHostText = (roots: RuntimeFiberSnapshot[]): string => roots.map((fiber) => {
  if (fiber.tag === "HostText") return fiber.text ?? "";
  const children = getHostText(fiber.children);
  if (children) return children;
  const value = fiber.props.children;
  return fiber.tag === "HostComponent" && (typeof value === "string" || typeof value === "number") ? String(value) : "";
}).join("");
