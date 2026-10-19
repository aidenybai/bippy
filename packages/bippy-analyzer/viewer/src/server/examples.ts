import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { Example } from "@/model";
import { fixturesDirectory } from "./paths";

const isComponentFile = (path: string): boolean =>
  path.endsWith(".tsx") && !path.endsWith(".d.tsx") && !path.includes("node_modules");

const usesHooks = (source: string): boolean => /\buse[A-Z]\w*\(/.test(source);

const toExample = (file: string): Example | null => {
  const source = readFileSync(file, "utf8");
  if (!usesHooks(source)) return null;
  return {
    file,
    name: basename(file, ".tsx"),
    folder: relative(fixturesDirectory, dirname(file)).split("/")[0] ?? "",
    lines: source.split("\n").length,
  };
};

export const listExamples = (): Example[] =>
  readdirSync(fixturesDirectory, { recursive: true, encoding: "utf8" })
    .map((path) => join(fixturesDirectory, path))
    .filter(isComponentFile)
    .flatMap((file) => toExample(file) ?? [])
    .sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
