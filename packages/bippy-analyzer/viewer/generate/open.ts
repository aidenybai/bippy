import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { demosSchema, type Demos } from "@/model";
import { buildDemos, writeDemos, type DemoEntry } from "./build-demos";
import { viewerRoot } from "./paths";

const LOCAL = resolve(viewerRoot, "src/generated/local.json");
const PORT = 3200;

const readLocal = (): Demos => {
  if (!existsSync(LOCAL)) return { examples: [], views: {}, json: {} };
  return demosSchema.parse(JSON.parse(readFileSync(LOCAL, "utf8")));
};

const merge = (current: Demos, added: Demos): Demos => {
  const names = new Set(added.examples.map((example) => example.name));
  const kept = current.examples.filter((example) => !names.has(example.name));
  return {
    examples: [...kept, ...added.examples],
    views: { ...current.views, ...added.views },
    json: { ...current.json, ...added.json },
  };
};

const files = process.argv.slice(2);
if (files.length === 0) {
  process.stderr.write("Usage: pnpm open <file.tsx> [more files]\n");
  process.exit(1);
}
const invokedFrom = process.env.INIT_CWD ?? process.cwd();
const entries: DemoEntry[] = files.map((file) => ({
  file: resolve(invokedFrom, file),
  summary: file,
}));
const added = buildDemos(entries);
writeDemos("local.json", merge(readLocal(), added));
for (const example of added.examples)
  process.stdout.write(`http://localhost:${PORT}/${example.name}\n`);
