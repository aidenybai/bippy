import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

const completions = [
  "trace += 'N';",
  "return undefined;",
  "return null;",
  "return 0;",
  "return 'returned';",
  "throw undefined;",
  "throw null;",
  "throw 'thrown';",
  "break;",
  "continue;",
];
const finalizers = [
  "trace += 'n';",
  "return undefined;",
  "return 'final';",
  "throw 'final';",
  "break;",
  "continue;",
];
const handlers = ["trace += 'handled';", "throw error;", "return 'caught';"];

it.each(differentialSeeds)(
  "matches native abrupt completion precedence and finalizer side effects, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 100; index++) {
      const completion = completions[getRandom(completions.length)];
      const finalizer = finalizers[getRandom(finalizers.length)];
      const handler = handlers[getRandom(handlers.length)];
      const trigger = getRandom(3);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
        let trace = '';
        const execute = () => {
          for (let index = 0; index < 3; index++) {
            trace += 'I' + index;
            try {
              try { if (index === ${trigger}) { ${completion} } }
              catch (error) { trace += 'C' + String(error); ${handler} }
            } finally { trace += 'F'; ${finalizer} }
            trace += 'A';
          }
          return 'end';
        };
        let result;
        try { result = execute(); } catch (error) { result = 'escaped:' + String(error); }
        return String(result) + '|' + trace;
      `,
      });
    }
    await checkDifferentialCases(cases);
  },
);

it("preserves switch fallthrough with default in the middle and late or absent matches", async () => {
  await checkDifferentialCases(
    [-1, 2, 3].map((discriminant) => ({
      name: `discriminant=${discriminant}`,
      body: `
      let trace = '';
      const test = (value) => { trace += 'T' + value; return value; };
      switch (${discriminant}) {
        case test(0): trace += 'A'; break;
        default: trace += 'D';
        case test(1): trace += 'B';
        case test(2): trace += 'C'; break;
      }
      return trace;
    `,
    })),
  );
});

it.each([
  {
    name: "switch stops evaluating cases after an earlier match",
    body: `let calls = 0; const later = () => { calls++; return 2; }; switch (1) { case 1: break; case later(): break; } return calls;`,
  },
  {
    name: "a throwing switch case stops dispatch and reaches catch",
    body: `let trace = ''; const test = () => { trace += 'T'; throw 'stop'; }; try { switch (0) { case test(): trace += 'B'; break; default: trace += 'D'; } } catch (error) { trace += 'C'; } return trace;`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialCases([testCase]));
