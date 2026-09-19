import { it } from "vite-plus/test";
import {
  checkDifferentialCases,
  checkKnownDifferentialWitnesses,
} from "./helpers/differential-evaluator.js";

interface OrdinaryConsumer {
  name: string;
  source: string;
  isString: boolean;
}

const consumers: OrdinaryConsumer[] = [
  { name: "number", source: "Number(target)", isString: false },
  { name: "addition", source: "target + 0", isString: false },
  { name: "string", source: "String(target)", isString: true },
  { name: "property-key", source: "({ 7: 11 })[target]", isString: true },
];

const cases = consumers.flatMap((consumer) =>
  ["primitive", "object", "missing", "noncallable", "getter-throws", "method-throws"].flatMap(
    (firstMode) =>
      ["primitive", "object", "throws"].map((secondMode) => {
        const trace = ["first-get"];
        if (firstMode === "getter-throws") trace.push("error:lookup");
        else if (firstMode === "primitive") trace.push("first-call:true", "after");
        else if (firstMode === "method-throws") trace.push("first-call:true", "error:first");
        else {
          if (firstMode === "object") trace.push("first-call:true");
          trace.push(
            "second-get",
            "second-call:true",
            secondMode === "object"
              ? "error:TypeError"
              : secondMode === "throws"
                ? "error:second"
                : "after",
          );
        }
        return {
          name: `${consumer.name}/first=${firstMode}/second=${secondMode}`,
          expected: trace.join("|"),
          actual: '"after"',
          body: `
    const trace = []; const target = {};
    const methods = {
      first() { trace.push('first-call:' + (this === target)); ${firstMode === "method-throws" ? "throw 'first';" : firstMode === "object" ? "return {};" : "return 7;"} },
      second() { trace.push('second-call:' + (this === target)); ${secondMode === "throws" ? "throw 'second';" : secondMode === "object" ? "return {};" : "return 7;"} }
    };
    Object.defineProperty(target, '${consumer.isString ? "toString" : "valueOf"}', { get() {
      trace.push('first-get');
      ${firstMode === "getter-throws" ? "throw 'lookup';" : firstMode === "missing" ? "return undefined;" : firstMode === "noncallable" ? "return 7;" : "return methods.first;"}
    } });
    Object.defineProperty(target, '${consumer.isString ? "valueOf" : "toString"}', { get() { trace.push('second-get'); return methods.second; } });
    try { ${consumer.source}; trace.push('after'); }
    catch (error) { trace.push('error:' + (typeof error === 'string' ? error : error.name)); }
    return trace.join('|');
  `,
        };
      }),
  ),
);

it.each(cases)("known divergence: ordinary conversion $name", (testCase) =>
  checkKnownDifferentialWitnesses([testCase]),
);

it.each(["valueOf", "toString"])("preserves explicit getter-backed %s invocation", (method) =>
  checkDifferentialCases([
    {
      name: `explicit/${method}`,
      body: `const trace = []; const target = { marker: 7 }; const operations = { read() { trace.push('call:' + (this === target)); return this.marker; } }; Object.defineProperty(target, '${method}', { get() { trace.push('get'); return operations.read; } }); const result = target['${method}'](); return trace.join('|') + ':' + result;`,
    },
  ]),
);
