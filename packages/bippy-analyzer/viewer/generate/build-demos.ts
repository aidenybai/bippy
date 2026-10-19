import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import type { Demos, ViewFile } from "@/model";
import { packageRoot, viewerRoot } from "./paths";
import { getAnalyzerJson, getViewFile } from "./view-model";

const stripRoot = (text: string): string =>
  text.replaceAll(`${packageRoot}/`, "").replaceAll(`${packageRoot.toLowerCase()}/`, "");

const toRelativeView = (view: ViewFile, file: string): ViewFile => ({ ...view, file });

export const buildDemos = (files: string[]): Demos => {
  const demos: Demos = { examples: [], views: {}, json: {} };
  for (const entry of files) {
    const absolute = resolve(packageRoot, entry);
    const file = relative(packageRoot, absolute);
    const name = basename(file, ".tsx");
    demos.examples.push({ file, name });
    demos.views[name] = toRelativeView(getViewFile(absolute), file);
    demos.json[name] = stripRoot(getAnalyzerJson(absolute));
  }
  return demos;
};

export const writeDemos = (fileName: string, demos: Demos): string => {
  const output = resolve(viewerRoot, "src/generated", fileName);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(demos)}\n`);
  return output;
};
