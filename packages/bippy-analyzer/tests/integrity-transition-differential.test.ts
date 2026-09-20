import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface IntegrityTarget {
  name: string;
  source: string;
}

interface IntegrityMutation {
  name: string;
  source: string;
}

const targets: IntegrityTarget[] = [
  { name: "object", source: "{}" },
  { name: "array", source: "[]" },
  { name: "function", source: "() => {}" },
  { name: "class", source: "class {}" },
  { name: "boxed-number", source: "Object(1)" },
];

const mutations: IntegrityMutation[] = [
  { name: "write-existing", source: "target.value = 7;" },
  { name: "write-new", source: "target.extra = 7;" },
  { name: "delete-existing", source: "delete target.value;" },
];

const cases = targets.flatMap((target) =>
  ["freeze", "seal", "preventExtensions"].flatMap((integrity) =>
    mutations.map((mutation) => {
      const name = `${target.name}/${integrity}/${mutation.name}`;
      const isAllowed =
        integrity !== "freeze" &&
        (mutation.name === "write-existing" ||
          (integrity === "preventExtensions" && mutation.name === "delete-existing"));
      const isKnown = !isAllowed;
      const isIgnored =
        integrity === "freeze" && (target.name === "object" || target.name === "array");
      const actualOutcome = isIgnored
        ? "after:1:undefined"
        : mutation.name === "write-existing"
          ? "after:7:undefined"
          : mutation.name === "write-new"
            ? "after:1:7"
            : "after:undefined:undefined";
      return {
        name,
        label: `${isKnown ? "known divergence: " : ""}${name}`,
        isKnown,
        expected: isAllowed
          ? mutation.name === "write-existing"
            ? "after:7:undefined"
            : "after:undefined:undefined"
          : "TypeError:1:undefined",
        actual: JSON.stringify(actualOutcome),
        body: `const target = ${target.source}; target.value = 1; let outcome = 'after'; try { Object.${integrity}(target); ${mutation.source} } catch (error) { outcome = error.name; } return outcome + ':' + String(target.value) + ':' + String(target.extra);`,
      };
    }),
  ),
);

it.each(cases)("$label", ({ name, body, expected, actual, isKnown }) =>
  isKnown
    ? checkKnownDifferentialWitnesses([{ name, body, expected, actual }])
    : checkDifferentialCases([{ name, body }]),
);

it("ordinary array property deletion is independent of integrity operations", () =>
  checkDifferentialCases([
    {
      name: "ordinary array property deletion",
      body: `const target = []; target.value = 1; delete target.value; return target.value;`,
    },
  ]));

it.each(["freeze", "seal", "preventExtensions"])(
  "preserves accessor setters after %s",
  (integrity) =>
    checkDifferentialCases([
      {
        name: `accessor/${integrity}`,
        body: `let stored = 1; const target = { get value() { return stored; }, set value(value) { stored = value; } }; Object.${integrity}(target); target.value = 7; return target.value + ':' + stored;`,
      },
    ]),
);

it("preserves deletion of an ordinary object property", () =>
  checkDifferentialCases([
    {
      name: "ordinary object property deletion",
      body: `const target = {}; target.value = 1; delete target.value; return target.value;`,
    },
  ]));
