import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { analyzeProject } from "../../../src/core/project/analyze-project";
import type { AnalyzedComponent } from "../../../src/core/types";
import { admitsOutput, admitsSequentialOutput } from "./match-output";
import { PROJECT_DIRECTORY, writeFixtureProject } from "./fixtures";
import type { Fixture } from "./fixtures";

type Outcome =
  | { kind: "admitted" }
  | { kind: "mismatch"; output: string }
  | { kind: "skipped"; reason: string };

interface SkippedFixture {
  fixture: string;
  reason: string;
}

const SKIPPED: SkippedFixture[] = JSON.parse(
  readFileSync(join(import.meta.dirname, "skipped.json"), "utf8"),
);

const RESULTS_FILE = join(import.meta.dirname, "../results/compiler-fixtures.json");

const checkFixture = (fixture: Fixture, components: AnalyzedComponent[]): Outcome => {
  if (fixture.error) return { kind: "skipped", reason: `doesn't parse: ${fixture.error}` };
  if (fixture.output === null) return { kind: "skipped", reason: "has no successful eval output" };
  if (!fixture.entry) return { kind: "skipped", reason: "has no FIXTURE_ENTRYPOINT fn" };
  const component = components.find(
    (candidate) =>
      candidate.analysis.file === fixture.file && candidate.analysis.name === fixture.entry,
  );
  if (!component) return { kind: "skipped", reason: "entry isn't analyzed as a component" };
  if (component.analysis.render.kind === "Unknown")
    return { kind: "skipped", reason: `render is unknown (${component.analysis.render.reason})` };
  if (fixture.output.includes("(exception in render)"))
    return { kind: "skipped", reason: "throws in one of its renders" };
  const { output } = fixture;
  const renders = [component.analysis.render];
  const isAdmitted = fixture.isSequential
    ? admitsSequentialOutput(renders, output)
    : admitsOutput(renders, output);
  return isAdmitted ? { kind: "admitted" } : { kind: "mismatch", output };
};

const fixtures = writeFixtureProject();
const project = analyzeProject(join(PROJECT_DIRECTORY, "tsconfig.json"));
const outcomes = fixtures.map((fixture) => ({
  fixture: fixture.name,
  ...checkFixture(fixture, project.components),
}));
mkdirSync(dirname(RESULTS_FILE), { recursive: true });
writeFileSync(RESULTS_FILE, JSON.stringify(outcomes, null, 2));

const skippedNames = new Map(SKIPPED.map((skipped) => [skipped.fixture, skipped.reason]));
const mismatches = outcomes.filter(
  (outcome) => outcome.kind === "mismatch" && !skippedNames.has(outcome.fixture),
);
const staleSkips = SKIPPED.filter((skipped) =>
  outcomes.some((outcome) => outcome.fixture === skipped.fixture && outcome.kind === "admitted"),
);
const counts = new Map<string, number>();
for (const outcome of outcomes) {
  const isKnownMismatch = outcome.kind === "mismatch" && skippedNames.has(outcome.fixture);
  const key = isKnownMismatch
    ? "known mismatch, in skipped.json"
    : outcome.kind === "skipped"
      ? `skipped: ${outcome.reason.split(":")[0]}`
      : outcome.kind;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
for (const [key, count] of [...counts].sort((left, right) => right[1] - left[1]))
  console.log(`${count}\t${key}`);
for (const mismatch of mismatches)
  console.log(
    `mismatch: ${mismatch.fixture}${mismatch.kind === "mismatch" ? ` renders ${mismatch.output}` : ""}`,
  );
for (const stale of staleSkips)
  console.log(`now admitted, remove from skipped.json: ${stale.fixture}`);
process.exitCode = mismatches.length > 0 || staleSkips.length > 0 ? 1 : 0;
