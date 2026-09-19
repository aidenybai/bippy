import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface SuperAssignment {
  name: string;
  source: string;
}

const assignments: SuperAssignment[] = [
  { name: "assign", source: "super.value = (trace.push('right'), 5)" },
  { name: "add", source: "super.value += (trace.push('right'), 5)" },
  { name: "prefix", source: "++super.value" },
  { name: "postfix", source: "super.value++" },
  { name: "and", source: "super.value &&= (trace.push('right'), 5)" },
  { name: "or", source: "super.value ||= (trace.push('right'), 5)" },
  { name: "nullish", source: "super.value ??= (trace.push('right'), 5)" },
];

const cases = assignments.flatMap((assignment) =>
  [0, 4, null].map((initial) => {
    const name = `${assignment.name}/initial=${initial}`;
    const isWrite =
      assignment.name === "and"
        ? Boolean(initial)
        : assignment.name === "or"
          ? !initial
          : assignment.name === "nullish"
            ? initial === null
            : true;
    const isUpdate = assignment.name === "prefix" || assignment.name === "postfix";
    const trace = assignment.name === "assign" ? [] : [`get:${initial}`];
    if (isWrite && !isUpdate) trace.push("right");
    const stored = isWrite
      ? isUpdate
        ? Number(initial) + 1
        : assignment.name === "add"
          ? Number(initial) + 5
          : 5
      : initial;
    const result = assignment.name === "postfix" ? Number(initial) : stored;
    const expectedTrace = isWrite ? [...trace, `set:${stored}`] : trace;
    return {
      name,
      label: `${isWrite ? "known divergence: " : ""}${name}`,
      isWrite,
      expected: `${expectedTrace.join("|")}#${result}:${stored}`,
      actual: JSON.stringify(`${trace.join("|")}#TypeError:${initial}`),
      body: `
    const trace = [];
    class Base {
      get value() { trace.push('get:' + this.stored); return this.stored; }
      set value(value) { trace.push('set:' + value); this.stored = value; }
    }
    class Child extends Base { run() { return ${assignment.source}; } }
    const instance = new Child(); instance.stored = ${initial};
    let result;
    try { result = instance.run(); } catch (error) { result = error.name; }
    return trace.join('|') + '#' + result + ':' + instance.stored;
  `,
    };
  }),
);

it.each(cases)("$label", ({ name, body, expected, actual, isWrite }) =>
  isWrite
    ? checkKnownDifferentialWitnesses([{ name, body, expected, actual }])
    : checkDifferentialCases([{ name, body }]),
);
