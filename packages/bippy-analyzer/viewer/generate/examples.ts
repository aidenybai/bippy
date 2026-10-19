import type { DemoEntry } from "./build-demos";

const FIXTURES = "tests/fixtures/symbolic-tree/src";

export const DEMOS: DemoEntry[] = [
  { file: `${FIXTURES}/counter.tsx`, summary: "A counter behind a loading prop" },
  { file: `${FIXTURES}/guards.tsx`, summary: "An action guarded by an empty draft" },
  { file: `${FIXTURES}/reducer.tsx`, summary: "A wizard stepped by a reducer" },
  { file: `${FIXTURES}/dashboard.tsx`, summary: "Props and an effect deciding the screen" },
  { file: `${FIXTURES}/todo.tsx`, summary: "Four variables, a filter and a list" },
];
