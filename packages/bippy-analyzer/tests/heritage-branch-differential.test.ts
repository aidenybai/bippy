import { it } from "vite-plus/test";
import {
  checkSymbolicCases,
  createSeededRandom,
  differentialSeeds,
  type DifferentialCase,
} from "./helpers/differential-evaluator.js";

it.each(differentialSeeds)(
  "matches fresh derived classes and static data across exhaustive branches, seed %i",
  async (seed) => {
    const getRandom = createSeededRandom(seed);
    const cases: DifferentialCase[] = [];
    for (let index = 0; index < 10; index++) {
      const initial = getRandom(20);
      const increment = 1 + getRandom(10);
      cases.push({
        name: `seed=${seed}/case=${index}`,
        body: `
      class First { read() { return ${initial}; } }
      class Second { read() { return ${initial + 40}; } }
      const run = (Base, amount) => {
        class Child extends Base { static count = ${initial}; extra = amount; read() { return super.read() + this.extra; } }
        Child.count += amount;
        return String(new Child().read() + Child.count);
      };
      if (first) { if (second) return run(First, ${increment}); return run(Second, ${increment}); }
      if (second) return run(First, ${increment + 1}); return run(Second, ${increment + 1});
    `,
      });
    }
    await checkSymbolicCases(cases);
  },
);

it.each([
  {
    name: "a selected base supplies inherited instance methods",
    body: `class First { read() { return 7; } } class Second { read() { return 9; } } const Base = first ? First : Second; class Child extends Base {} return String(new Child().read());`,
  },
  {
    name: "a selected base supplies a super method",
    body: `class First { read() { return 7; } } class Second { read() { return 9; } } class Child extends (first ? First : Second) { read() { return super.read() + 1; } } return String(new Child().read());`,
  },
  {
    name: "a selected base supplies inherited static data",
    body: `class First { static value = 7; } class Second { static value = 9; } class Child extends (first ? First : Second) {} return String(Child.value);`,
  },
  {
    name: "base selection and independent derived static writes retain both decisions",
    body: `class First { read() { return 7; } } class Second { read() { return 9; } } class Child extends (first ? First : Second) { static value = 0; } if (second) Child.value = 1; return String(new Child().read() + Child.value);`,
  },
])("preserves symbolic heritage $name", (testCase) => checkSymbolicCases([testCase]));
