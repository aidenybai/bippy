import { basename } from "node:path";
import type { Example } from "@/model";

const DEMOS = [
  { path: "symbolic-tree/src/counter.tsx", summary: "A counter behind a loading prop" },
  { path: "symbolic-tree/src/guards.tsx", summary: "An action guarded by an empty draft" },
  { path: "symbolic-tree/src/reducer.tsx", summary: "A wizard stepped by a reducer" },
  { path: "symbolic-tree/src/dashboard.tsx", summary: "Props and an effect deciding the screen" },
  { path: "symbolic-tree/src/todo.tsx", summary: "Four variables, a filter and a list" },
];

export const listExamples = (): Example[] =>
  DEMOS.map(({ path, summary }) => ({ file: path, name: basename(path, ".tsx"), summary }));
