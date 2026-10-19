import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { demosSchema, type Demos } from "@/model";
import demosJson from "@/generated/demos.json";

const LOCAL = resolve(process.cwd(), "src/generated/local.json");

const readLocal = (): Demos | null => {
  if (process.env.NODE_ENV === "production" || !existsSync(LOCAL)) return null;
  return demosSchema.parse(JSON.parse(readFileSync(LOCAL, "utf8")));
};

const merge = (base: Demos, local: Demos | null): Demos => {
  if (!local) return base;
  const names = new Set(local.examples.map((example) => example.name));
  return {
    examples: [...base.examples.filter((example) => !names.has(example.name)), ...local.examples],
    views: { ...base.views, ...local.views },
    json: { ...base.json, ...local.json },
  };
};

export const getDemos = (): Demos => merge(demosSchema.parse(demosJson), readLocal());
