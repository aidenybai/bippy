import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
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
  const cases: DifferentialCase[] = [];
  for (const discriminant of [-1, 2, 3]) {
    for (const failingCase of [-1]) {
      cases.push({
        name: `discriminant=${discriminant}/failingCase=${failingCase}`,
        body: `
          let trace = '';
          const test = (value) => { trace += 'T' + value; if (value === ${failingCase}) throw 'case'; return value; };
          try {
            switch (${discriminant}) {
              case test(0): trace += 'A'; break;
              default: trace += 'D';
              case test(1): trace += 'B';
              case test(2): trace += 'C'; break;
            }
          } catch (error) { trace += 'E' + error; }
          return trace;
        `,
      });
    }
  }
  await checkDifferentialCases(cases);
});
