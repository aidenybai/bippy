import { basename, join } from "node:path";
import type { Example } from "@/model";
import { fixturesDirectory } from "./paths";

const DEMOS = [
  { path: "symbolic-tree/src/counter.tsx", summary: "A counter behind a loading prop" },
  { path: "symbolic-tree/src/guards.tsx", summary: "An action guarded by an empty draft" },
  { path: "symbolic-tree/src/reducer.tsx", summary: "A wizard stepped by a reducer" },
  { path: "symbolic-tree/src/dashboard.tsx", summary: "Props and an effect deciding the screen" },
  { path: "symbolic-tree/src/todo.tsx", summary: "Four variables, a filter and a list" },
];

const toExample = ({ path, summary }: (typeof DEMOS)[number]): Example => {
  const file = join(fixturesDirectory, path);
  return { file, name: basename(file, ".tsx"), summary };
};

export const listExamples = (): Example[] => DEMOS.map(toExample);
