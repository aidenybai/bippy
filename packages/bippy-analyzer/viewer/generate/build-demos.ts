import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import type { Demos, ViewFile } from "@/model";
import { packageRoot, viewerRoot } from "./paths";
import { getAnalyzerJson, getViewFile } from "./view-model";

export interface DemoEntry {
  file: string;
  summary: string;
}

const stripRoot = (text: string): string =>
  text.replaceAll(`${packageRoot}/`, "").replaceAll(`${packageRoot.toLowerCase()}/`, "");

const toRelativeView = (view: ViewFile, file: string): ViewFile => ({ ...view, file });

export const buildDemos = (entries: DemoEntry[]): Demos => {
  const demos: Demos = { examples: [], views: {}, json: {} };
  for (const entry of entries) {
    const absolute = resolve(packageRoot, entry.file);
    const file = relative(packageRoot, absolute);
    const name = basename(file, ".tsx");
    demos.examples.push({ file, name, summary: entry.summary });
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
