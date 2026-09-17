import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

const operations = [
  {
    name: "mixed bigint addition",
    errorName: "TypeError",
    initial: "1n",
    operator: "+=",
    right: "1",
  },
  {
    name: "mixed bigint multiplication",
    errorName: "TypeError",
    initial: "1n",
    operator: "*=",
    right: "2",
  },
  {
    name: "bigint division by zero",
    errorName: "RangeError",
    initial: "1n",
    operator: "/=",
    right: "0n",
  },
  {
    name: "bigint remainder by zero",
    errorName: "RangeError",
    initial: "1n",
    operator: "%=",
    right: "0n",
  },
  {
    name: "negative bigint exponent",
    errorName: "RangeError",
    initial: "1n",
    operator: "**=",
    right: "-1n",
  },
  {
    name: "unsigned bigint shift",
    errorName: "TypeError",
    initial: "1n",
    operator: ">>>=",
    right: "1n",
  },
];

it.each(
  operations.flatMap((operation) =>
    [false, true].map((setterThrows) => ({
      ...operation,
      setterThrows,
      label: `${operation.name}/setterThrows=${setterThrows}`,
    })),
  ),
)(
  "known divergence: conversion and write completion: $label",
  ({ name, initial, operator, right, setterThrows, errorName }) =>
    checkKnownDifferentialWitnesses([
      {
        name: `${name}/${setterThrows}`,
        expected: `get|caught:${errorName}#0`,
        actual: JSON.stringify(setterThrows ? "get|set|caught:setter#1" : "get|set|after#1"),
        body: `
    const trace = [];
    let writes = 0;
    const holder = { get value() { trace.push('get'); return ${initial}; }, set value(value) { writes++; trace.push('set'); ${setterThrows ? "throw 'setter';" : ""} } };
    try { holder.value ${operator} ${right}; trace.push('after'); }
    catch (error) { trace.push('caught:' + (typeof error === 'string' ? error : error.name)); }
    return trace.join('|') + '#' + writes;
  `,
      },
    ]),
);

it.each([
  {
    name: "unary plus of bigint throws",
    expected: "TypeError",
    actual: JSON.stringify("accepted"),
    body: `try { +1n; return 'accepted'; } catch (error) { return error.name; }`,
  },
  {
    name: "unary minus preserves bigint type",
    expected: "bigint",
    actual: JSON.stringify("number"),
    body: `return typeof -1n;`,
  },
  {
    name: "bitwise not preserves bigint type",
    expected: "bigint",
    actual: JSON.stringify("number"),
    body: `return typeof ~1n;`,
  },
  {
    name: "bigint subtraction preserves bigint type",
    expected: "bigint",
    actual: JSON.stringify("number"),
    body: `return typeof (2n - 1n);`,
  },
])("known divergence: $name", (testCase) => checkKnownDifferentialWitnesses([testCase]));

it("preserves number division by zero writing Infinity", () =>
  checkDifferentialCases([
    {
      name: "number division by zero still writes Infinity",
      body: `let stored = 1; const trace = []; const holder = { get value() { trace.push('get'); return stored; }, set value(value) { trace.push('set'); stored = value; } }; holder.value /= 0; return trace.join('|') + ':' + stored;`,
    },
  ]));
