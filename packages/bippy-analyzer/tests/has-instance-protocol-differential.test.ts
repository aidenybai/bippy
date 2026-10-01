import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface InstanceHandler {
  name: string;
  result: string;
  isCallable: boolean;
}

const handlers: InstanceHandler[] = [
  { name: "true", result: "return true;", isCallable: true },
  { name: "false", result: "return false;", isCallable: true },
  { name: "object", result: "return {};", isCallable: true },
  { name: "empty-string", result: "return '';", isCallable: true },
  { name: "throwing-call", result: "throw 'check';", isCallable: true },
  { name: "number", result: "return 7;", isCallable: false },
  { name: "null", result: "return null;", isCallable: false },
  { name: "undefined", result: "return undefined;", isCallable: false },
  { name: "throwing-getter", result: "throw 'lookup';", isCallable: false },
];

const cases = handlers.flatMap((handler) =>
  ["7", "null", "{}"].flatMap((source) =>
    [false, true].map((isManual) => {
      const name = `${handler.name}/left=${source}/manual=${isManual}`;
      const trace = ["left", "right", "get"];
      if (handler.isCallable) {
        trace.push(`call:true:${source === "7" ? "number" : "object"}`);
        trace.push(handler.name === "throwing-call" ? "error:check" : "after");
      } else {
        trace.push(
          handler.name === "throwing-getter"
            ? "error:lookup"
            : isManual
              ? "after"
              : "error:TypeError",
        );
      }
      return {
        name,
        label: `${isManual ? "" : "known divergence: "}${name}`,
        isManual,
        expected: trace.join("|"),
        body: `const trace = []; const target = { get [Symbol.hasInstance]() { trace.push('get'); ${handler.isCallable ? "return operations.check;" : handler.result} } }; const operations = { check(value) { trace.push('call:' + (this === target) + ':' + typeof value); ${handler.result} } }; const getLeft = () => { trace.push('left'); return (${source}); }; const getRight = () => { trace.push('right'); return target; }; try { ${isManual ? "const left = getLeft(); const right = getRight(); const method = right[Symbol.hasInstance]; if (typeof method === 'function') method.call(right, left);" : "getLeft() instanceof getRight();"} trace.push('after'); } catch (error) { trace.push('error:' + (typeof error === 'string' ? error : error.name)); } return trace.join('|');`,
      };
    }),
  ),
);

it.each(cases)("$label", ({ name, body, expected, isManual }) =>
  isManual
    ? checkDifferentialCases([{ name, body }])
    : checkKnownDifferentialWitnesses([{ name, body, expected, actual: '"left|right|after"' }]),
);

it.each([
  { name: "true", source: "true", expected: true },
  { name: "false", source: "false", expected: false },
  { name: "object", source: "{}", expected: true },
  { name: "empty-string", source: "''", expected: false },
])("known precision gap: hasInstance Boolean result $name", ({ name, source, expected }) =>
  checkKnownDifferentialWitnesses([
    {
      name: `result/${name}`,
      expected,
      actual: "<boolean: instanceof on dynamic values>",
      body: `const target = { [Symbol.hasInstance]() { return (${source}); } }; return 7 instanceof target;`,
    },
  ]),
);
