import { basename, relative, resolve } from "node:path";
import type { Demos } from "@/model";
import { analyzeFile } from "./view-model";

const packageRoot = resolve(import.meta.dirname, "../..");

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
