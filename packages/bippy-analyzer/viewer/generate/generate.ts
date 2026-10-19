import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Demos, ViewFile } from "@/model";
import { listExamples } from "./examples";
import { fixturesDirectory, packageRoot, viewerRoot } from "./paths";
import { getAnalyzerJson, getViewFile } from "./view-model";

const OUTPUT = join(viewerRoot, "src/generated/demos.json");

const stripRoot = (text: string): string =>
  text.replaceAll(`${packageRoot}/`, "").replaceAll(`${packageRoot.toLowerCase()}/`, "");

const toRelativeView = (view: ViewFile, file: string): ViewFile => ({ ...view, file });

const generate = (): Demos => {
  const examples = listExamples();
  const views: Record<string, ViewFile> = {};
  const json: Record<string, string> = {};
  for (const example of examples) {
    const absolute = join(fixturesDirectory, example.file);
    views[example.name] = toRelativeView(getViewFile(absolute), example.file);
    json[example.name] = stripRoot(getAnalyzerJson(absolute));
  }
  return { examples, views, json };
};

const demos = generate();
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(demos)}\n`);
process.stdout.write(`Wrote ${demos.examples.length} demos to ${OUTPUT}\n`);
