import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface KeyEntry {
  key: string;
  value: number;
}

interface ObjectBuilder {
  name: string;
  getSource: (entries: KeyEntry[]) => string;
}

interface KeyProjection {
  name: string;
  statement: string;
  getExpected: (entries: KeyEntry[]) => string;
  keys?: string[];
}

const keys = [
  "0",
  "1",
  "2",
  "10",
  "4294967294",
  "-0",
  "00",
  "01",
  "1.0",
  "1e0",
  "-1",
  "4294967295",
  "9007199254740991",
  "NaN",
  "Infinity",
  "alpha",
];
const getIsArrayIndex = (key: string): boolean => {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index < 4294967295 && String(index) === key;
};
const getOrderedEntries = (entries: KeyEntry[]): KeyEntry[] => [
  ...entries
    .filter((entry) => getIsArrayIndex(entry.key))
    .sort((left, right) => Number(left.key) - Number(right.key)),
  ...entries.filter((entry) => !getIsArrayIndex(entry.key)),
];
const getKeySnapshot = (entries: KeyEntry[]): string => entries.map((entry) => entry.key).join(",");
const builders: ObjectBuilder[] = [
  {
    name: "literal",
    getSource: (entries) =>
      `const target = { ${entries.map((entry) => `[${JSON.stringify(entry.key)}]: ${entry.value}`).join(",")} };`,
  },
  {
    name: "assignment",
    getSource: (entries) =>
      `const target = {}; ${entries.map((entry) => `target[${JSON.stringify(entry.key)}] = ${entry.value};`).join(" ")}`,
  },
  {
    name: "from-entries",
    getSource: (entries) =>
      `const target = Object.fromEntries(${JSON.stringify(entries.map((entry) => [entry.key, entry.value]))});`,
  },
];
const projections: KeyProjection[] = [
  { name: "keys", statement: "return Object.keys(target).join(',');", getExpected: getKeySnapshot },
  {
    name: "values",
    statement: "return Object.values(target).join(',');",
    getExpected: (entries) => entries.map((entry) => entry.value).join(","),
  },
  {
    name: "entries",
    statement: "return Object.entries(target).map((pair) => pair[0] + ':' + pair[1]).join(',');",
    getExpected: (entries) => entries.map((entry) => `${entry.key}:${entry.value}`).join(","),
  },
  {
    name: "names",
    statement: "return Object.getOwnPropertyNames(target).join(',');",
    getExpected: getKeySnapshot,
  },
  {
    name: "own-keys",
    statement: "return Reflect.ownKeys(target).join(',');",
    getExpected: getKeySnapshot,
  },
  {
    name: "for-in",
    statement: "const keys = []; for (const key in target) keys.push(key); return keys.join(',');",
    getExpected: getKeySnapshot,
    keys: ["2"],
  },
  {
    name: "json",
    statement: "return JSON.stringify(target);",
    getExpected: (entries) =>
      "{" + entries.map((entry) => `${JSON.stringify(entry.key)}:${entry.value}`).join(",") + "}",
    keys: ["2"],
  },
];

const getOrderCase = (
  builder: ObjectBuilder,
  projection: KeyProjection,
  names: string[],
  label: string,
) => {
  const entries = names.map((name, index) => ({ key: name, value: index + 1 }));
  const name = `${builder.name}/${projection.name}/${label}`;
  const expected = projection.getExpected(getOrderedEntries(entries));
  const insertionOrder = projection.getExpected(entries);
  const isKnown = projection.name !== "json" && expected !== insertionOrder;
  return {
    name,
    label: `${isKnown ? "known divergence: " : ""}${name}`,
    isKnown,
    actual: JSON.stringify(insertionOrder),
    expected,
    body: `${builder.getSource(entries)} ${projection.statement}`,
  };
};

const cases = builders.flatMap((builder) =>
  projections.flatMap((projection) => [
    ...(projection.keys ?? keys).flatMap((key) =>
      [0, 2].map((position) => {
        const names = ["head", "tail"];
        names.splice(position, 0, key);
        return getOrderCase(builder, projection, names, `key=${key}/position=${position}`);
      }),
    ),
    ...[
      ["0", "2", "10"],
      ["10", "2", "0"],
    ].map((names) => getOrderCase(builder, projection, names, `numeric=${names.join(",")}`)),
  ]),
);

it.each(cases)("$label", async ({ name, body, expected, actual, isKnown }) => {
  expect(runInNewContext(`"use strict"; (() => { ${body} })()`, {}, { timeout: 1000 })).toBe(
    expected,
  );
  if (isKnown) await checkKnownDifferentialWitnesses([{ name, body, expected, actual }]);
  else await checkDifferentialCases([{ name, body }]);
});
