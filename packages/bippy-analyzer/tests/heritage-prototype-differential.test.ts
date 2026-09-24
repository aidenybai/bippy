import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface HeritagePrototype {
  name: string;
  source: string;
  isValid: boolean;
}

const prototypes: HeritagePrototype[] = [
  { name: "object", source: "{}", isValid: true },
  { name: "array", source: "[]", isValid: true },
  { name: "null", source: "null", isValid: true },
  { name: "function", source: "() => {}", isValid: true },
  { name: "number", source: "7", isValid: false },
  { name: "undefined", source: "undefined", isValid: false },
  { name: "symbol", source: "Symbol('prototype')", isValid: false },
  { name: "bigint", source: "3n", isValid: false },
  { name: "boolean", source: "false", isValid: false },
  { name: "throwing", source: "null", isValid: false },
];

const cases = prototypes.flatMap((prototype) =>
  [false, true].map((isHeritage) => {
    const name = `${prototype.name}/heritage=${isHeritage}`;
    return {
      name,
      label: `${isHeritage ? "known divergence: " : ""}${name}`,
      isHeritage,
      expected:
        prototype.name === "throwing"
          ? "get|error:prototype"
          : !isHeritage
            ? "get|after"
            : prototype.isValid
              ? "get|static|after"
              : "get|error:TypeError",
      body: `const trace = []; const Base = new Proxy(function () {}, { get(target, key) { if (key === 'prototype') { trace.push('get'); ${prototype.name === "throwing" ? "throw 'prototype';" : `return (${prototype.source});`} } return target[key]; } }); try { ${isHeritage ? "class Child extends Base { static value = trace.push('static'); }" : "const prototype = Base.prototype;"} trace.push('after'); } catch (error) { trace.push('error:' + (typeof error === 'string' ? error : error.name)); } return trace.join('|');`,
    };
  }),
);

it.each(cases)("$label", ({ name, body, expected, isHeritage }) =>
  isHeritage
    ? checkKnownDifferentialWitnesses([{ name, body, expected, actual: '"static|after"' }])
    : checkDifferentialCases([{ name, body }]),
);

it.each(["7", "undefined"])(
  "known divergence: non-proxy superclass prototype %s is invalid",
  (prototype) =>
    checkKnownDifferentialWitnesses([
      {
        name: `ordinary function prototype/${prototype}`,
        expected: "TypeError",
        actual: '"accepted"',
        body: `const Base = function () {}; Base.prototype = ${prototype}; try { class Child extends Base {} return 'accepted'; } catch (error) { return error.name; }`,
      },
    ]),
);

it("preserves a null superclass prototype during class definition", () =>
  checkDifferentialCases([
    {
      name: "ordinary function null prototype",
      body: `const Base = function () {}; Base.prototype = null; class Child extends Base {} return typeof Child;`,
    },
  ]));
