import { expect, it } from "vite-plus/test";
import { bindFunction } from "../src/compiler/bindings.js";
import { checkGuardedCases } from "./helpers/differential-evaluator.js";
import { parseSsaFunction, checkSsaAgainstNative } from "./helpers/ssa-evaluator.js";

const assignments = [
  "value = (trace++, 7)",
  "value += (trace++, 7)",
  "value -= (trace++, 7)",
  "value *= (trace++, 7)",
  "value ||= (trace++, 7)",
  "value &&= (trace++, 7)",
  "value ??= (trace++, 7)",
  "value++",
  "++value",
  "value--",
  "--value",
];

it.each(
  ["let", "const"].flatMap((kind) => assignments.map((assignment) => ({ kind, assignment }))),
)("throws TDZ before or after RHS as required: $kind/$assignment", ({ kind, assignment }) => {
  checkSsaAgainstNative(
    `let trace=0; try { ${assignment}; ${kind} value=1; } catch(error) { return trace+':'+error.name; }`,
  );
});

it.each(
  [false, true, 0, 1, null, undefined, "", "ready"].flatMap((value) =>
    assignments.map((assignment) => ({ value, assignment })),
  ),
)("preserves immutable values and RHS effects: $value/$assignment", ({ value, assignment }) => {
  checkSsaAgainstNative(
    `let trace=0; const value=first; try { ${assignment}; } catch(error) { return trace+':'+error.name+':'+value; } return trace+':'+value;`,
    { first: value },
  );
});

it.each([
  "var first; return first;",
  "var first = second; return first;",
  "{ var first; } return first;",
  "try { throw second; } catch(first) { var first=7; } return first;",
  "var value=first; try { throw second; } catch(value) { var value=7; } return value;",
  "var value=first; try { throw second; } catch(value) { var value=7; return value; }",
  "let value=first; { let value=second; value++; } return value;",
  "let value=first; { let value; if(second) value=3; return value; }",
  "let result=''; for(let index=0;index<3;index++) { let value; result += ':'+value; value=index; } return result;",
  "let result=''; for(let index=0;index<3;index++) { var value; result += ':'+value; value=index; } return result;",
  "const value=1; try { switch(first) { case (value): let value=2; return value; default: return 7; } } catch(error) {return error.name;}",
  "let value=first; switch(value) { default: let value=second; return value; }",
  "let value=first; try { { return typeof value; const value=second; } } catch(error) { return error.name; }",
  "try { let value=value; return value; } catch(error) { return error.name; }",
  "let value=first; try { throw second; } catch(value) { let other=value; return other; }",
  "let value=first; try { throw second; } catch { let value=7; } return value;",
  "let value=first; if(second) { let value=7; return value; } return value;",
  "var value; if(first) value=7; else value=9; var value; return value;",
  "const undefined=7; return undefined;",
  "const NaN=7; return NaN;",
  "const Infinity=7; return Infinity;",
])("resolves declarations and shadowing: %s", (body) => {
  for (const first of [0, 1])
    for (const second of [0, 1]) checkSsaAgainstNative(body, { first, second });
});

it.each([
  "try { throw second; } catch(first) { var first=7; } return first ? 'yes' : 'no';",
  "try { throw second; } catch(first) { for(var first=0; first<3; first++) {} } return first ? 'yes' : 'no';",
])("preserves parameter identity across catch-var initializers: %s", (body) =>
  checkGuardedCases([
    {
      name: "catch-var parameter",
      body: `const probe=(first,second)=>{${body}};return probe(first,second);`,
    },
  ]),
);

interface CaptureCase {
  name: string;
  source: string;
  expected: "local" | "cell";
}

const captures: CaptureCase[] = [
  { name: "arrow read", source: "const read=()=>value;", expected: "cell" },
  { name: "arrow write", source: "const write=()=>{value=2;};", expected: "cell" },
  { name: "nested read", source: "const factory=()=>()=>value;", expected: "cell" },
  { name: "getter", source: "const object={get item(){return value;}};", expected: "cell" },
  { name: "setter", source: "const object={set item(next){value=next;}};", expected: "cell" },
  { name: "class method", source: "class Example { read(){return value;} }", expected: "cell" },
  { name: "class static block", source: "class Example { static { value=2; } }", expected: "cell" },
  { name: "class field", source: "class Example { field=value; }", expected: "cell" },
  { name: "shadowed parameter", source: "const read=(value)=>value;", expected: "local" },
  {
    name: "shadowed lexical",
    source: "const read=()=>{let value=2; return value;};",
    expected: "local",
  },
  { name: "shadowed var", source: "const read=()=>{return value;var value;};", expected: "local" },
  { name: "noncomputed property", source: "const read=(object)=>object.value;", expected: "local" },
  { name: "computed property", source: "const read=(object)=>object[value];", expected: "cell" },
  { name: "object key", source: "const read=()=>({value:2});", expected: "local" },
  { name: "shorthand value", source: "const read=()=>({value});", expected: "cell" },
];

it.each(captures)("classifies capture: $name", ({ source, expected }) => {
  const bindings = bindFunction(
    parseSsaFunction(`function probe(){let value=1;${source}return value;}`),
  );
  expect(bindings.owned.find((binding) => binding.name === "value")?.storage).toBe(expected);
});

it.each([
  { source: "return arguments[0];", expected: "cell" },
  { source: "const read=()=>arguments[0];return value;", expected: "cell" },
  { source: "const read=function(){return arguments[0];};return value;", expected: "local" },
  { source: "const read=(object)=>object.arguments;return value;", expected: "local" },
])("tracks the owner of arguments: $source", ({ source, expected }) => {
  const bindings = bindFunction(parseSsaFunction(`function probe(value){${source}}`));
  expect(bindings.owned.find((binding) => binding.name === "value")?.storage).toBe(expected);
});
