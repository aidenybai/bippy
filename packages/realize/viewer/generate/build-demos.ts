import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import type { Demos } from "@/model";
import { analyzeFile } from "./view-model";

const viewerRoot = resolve(import.meta.dirname, "..");
const packageRoot = resolve(viewerRoot, "..");

const stripRoot = (text: string): string =>
  text.replaceAll(`${packageRoot}/`, "").replaceAll(`${packageRoot.toLowerCase()}/`, "");

export const buildDemos = async (files: string[]): Promise<Demos> => {
  const demos: Demos = { examples: [], views: {}, json: {} };
  for (const entry of files) {
    const absolute = resolve(packageRoot, entry);
    const file = relative(packageRoot, absolute);
    const name = basename(file, ".tsx");
    const analyzed = await analyzeFile(absolute);
    demos.examples.push({ file, name });
    demos.views[name] = { ...analyzed.view, file };
    demos.json[name] = stripRoot(analyzed.json);
  }
  return demos;
};

export const writeDemos = (fileName: string, demos: Demos): string => {
  const output = resolve(viewerRoot, "src/generated", fileName);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(demos)}\n`);
  return output;
};
