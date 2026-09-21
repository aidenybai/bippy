import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { primitiveValue, UNDEFINED_VALUE } from "../src/evaluate/values.js";
import { createStaticRenderer } from "../src/render/static-renderer.js";
import type { StaticValue } from "../src/types.js";
import { checkGuardedCases } from "./helpers/differential-evaluator.js";

interface TaskBudgetCase {
  name: string;
  body: string;
  isAsync?: boolean;
  maxSteps: number;
  maxCallDepth: number;
  expectedCount?: number;
  expectedDiagnostic?: string;
}

const budgetCases: TaskBudgetCase[] = [
  {
    name: "bounds synchronous calls together after await",
    body: `const burn = () => { ${"count++;".repeat(30)} };
      await Promise.resolve(); burn(); burn(); burn();`,
    isAsync: true,
    maxSteps: 100,
    maxCallDepth: 4,
    expectedDiagnostic: "budget-exhausted",
  },
  {
    name: "shares the resumed budget with finally handlers",
    body: `const burn = () => { ${"count++;".repeat(30)} };
      try { await Promise.resolve(); burn(); } finally { burn(); burn(); }`,
    isAsync: true,
    maxSteps: 100,
    maxCallDepth: 4,
    expectedDiagnostic: "budget-exhausted",
  },
  {
    name: "allows a synchronous call below the resumed budget",
    body: `const burn = () => { ${"count++;".repeat(20)} };
      await Promise.resolve(); burn();`,
    isAsync: true,
    maxSteps: 100,
    maxCallDepth: 4,
    expectedCount: 20,
  },
  {
    name: "refreshes the budget for successive await resumptions",
    body: `await Promise.resolve(); ${"count++;".repeat(20)}`.repeat(3),
    isAsync: true,
    maxSteps: 100,
    maxCallDepth: 4,
    expectedCount: 60,
  },
  {
    name: "refreshes the step budget for each callback entry",
    body: "count++; if (count < 150) queueMicrotask(tick);",
    maxSteps: 100,
    maxCallDepth: 4,
    expectedCount: 150,
  },
  {
    name: "retains synchronous call depth within a callback",
    body: "count++; if (count < 150) tick();",
    maxSteps: 100,
    maxCallDepth: 4,
    expectedCount: 4,
    expectedDiagnostic: "max-call-depth",
  },
  {
    name: "retains the step bound within a callback",
    body: "for (let index = 0; index < 150; index++) count++;",
    maxSteps: 60,
    maxCallDepth: 4,
    expectedDiagnostic: "budget-exhausted",
  },
];

it.each(budgetCases)(
  "$name",
  async ({ body, isAsync = false, maxSteps, maxCallDepth, expectedCount, expectedDiagnostic }) => {
    const directory = mkdtempSync(join(tmpdir(), "bippy-task-budget-"));
    try {
      const filePath = join(directory, "program.ts");
      writeFileSync(
        filePath,
        `export const start = () => {
      let count = 0;
      const tick = ${isAsync ? "async" : ""} () => { ${body} };
      ${isAsync ? "tick()" : "queueMicrotask(tick)"};
      return () => count;
    };`,
      );
      const renderer = await createStaticRenderer({
        rootDirectory: directory,
        maxSteps,
        maxCallDepth,
      });
      let count: StaticValue = UNDEFINED_VALUE;
      const result = await renderer.renderWith((interpreter) => {
        const module = renderer.loadModule(filePath);
        if (!module) throw new Error("Missing task-budget program");
        const context = interpreter.createModuleContext(module);
        const start = interpreter.evaluateModuleExport(module, "start");
        const snapshot = interpreter.callValue(start, [], context, null);
        interpreter.timers.drainMicrotasks();
        count = interpreter.callValue(snapshot, [], context, null);
        return UNDEFINED_VALUE;
      });
      if (expectedCount !== undefined) expect(count).toEqual(primitiveValue(expectedCount));
      expect([...new Set(result.diagnostics.map((diagnostic) => diagnostic.code))]).toEqual(
        expectedDiagnostic ? [expectedDiagnostic] : [],
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it.each([
  "queueMicrotask(tick)",
  "Promise.resolve().then(tick)",
  "(async () => { await Promise.resolve(); tick(); })()",
])(
  "starts a fresh callback stack for %s while preserving captured state and inputs",
  async (schedule) => {
    await checkGuardedCases(
      [
        {
          name: schedule,
          body: `
          let count = 0;
          const target = first ? 150 : 151;
          const tick = () => {
            count++;
            if (count < target) ${schedule};
          };
          ${schedule};
          return () => String(count) + ':' + (second ? 'yes' : 'no');
        `,
        },
      ],
      true,
    );
  },
);
