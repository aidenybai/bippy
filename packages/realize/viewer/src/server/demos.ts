import type { Example } from "@/model";

const FIXTURES = "tests/fixtures/state-charts/src";

export const examples: Example[] = ["dashboard", "reducer", "todo"].map((name) => ({
  file: `${FIXTURES}/${name}.tsx`,
  name,
}));

export const demoNames = new Set(examples.map((example) => example.name));
