import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";
import { transformSync } from "esbuild";
import React from "react";
import { compileFunction, type CompiledFunction } from "../src/compiler/compile-function.js";
import type { ConstantFact } from "../src/compiler/ir.js";
import type { Node } from "oxc-parser";
import { enterSsa } from "../src/compiler/enter-ssa.js";
import { eliminateRedundantPhis } from "../src/compiler/eliminate-phis.js";
import { lowerFunction } from "../src/compiler/lower-function.js";
import { verifySsa } from "../src/compiler/verify-ssa.js";
import { parseSourceText } from "../src/parse/parse-source-file.js";
import { checkGuardedCases } from "./helpers/differential-evaluator.js";
import { executeSsa } from "../src/evaluate/ssa-execution.js";
import { primitiveValue } from "../src/evaluate/values.js";
import { getTypeofValue } from "../src/evaluate/value-typeof.js";
import { loadHostRealm } from "../src/host/host-realm.js";
import { createEvaluationContext } from "./helpers/evaluation-context.js";

interface SsaCase {
  body: string;
  executable: boolean;
}

const createCase = (body: string, executable = true): SsaCase => ({ body, executable });

const parseFunction = (source: string) => {
  const parsed = parseSourceText("/ssa.tsx", source, "tsx");
  expect(parsed.errors).toEqual([]);
  const node = parsed.program.body[0];
  if (node?.type !== "FunctionDeclaration") throw new Error("Expected a function declaration");
  return node;
};

const getReadFacts = (compiled: CompiledFunction): Map<Node, ConstantFact> => {
  const reads = new Map<Node, ConstantFact>();
  const conflicting = new Set<Node>();
  for (const block of compiled.graph.blocks.values()) {
    if (!compiled.constants.executableBlocks.has(block.id)) continue;
    for (const instruction of block.instructions) {
      const reference = instruction.node;
      if (
        instruction.kind !== "read" ||
        reference?.type !== "Identifier" ||
        conflicting.has(reference)
      )
        continue;
      const fact = compiled.constants.values.get(instruction.target);
      if (!fact || fact.kind === "unreached") continue;
      const previous = reads.get(reference);
      if (fact.kind !== "constant" || (previous && !Object.is(previous.value, fact.value))) {
        reads.delete(reference);
        conflicting.add(reference);
      } else reads.set(reference, fact);
    }
  }
  return reads;
};

const cases = [
  createCase("let value = 0; if (first) value = 1; else value = 2; return value;"),
  createCase("let value = 0; if (first) value = 7; else value = 7; return value + 2;"),
  createCase("let value = 3; while (first) { value = 4; break; } return value;"),
  createCase("let value = 0; for (let index = 0; index < 3; index++) value++; return value;"),
  createCase("let value = 0; do { value = 4; } while (false); return value;"),
  createCase(
    "let value = 0; outer: for(let index = 0; index < 3; index++) { if(first) continue outer; value++; } return value;",
  ),
  createCase("let value = 0; outer: { if(first) break outer; value = 3; } return value;"),
  createCase(
    "let value = 0; switch(first) { case true: value = 2; break; default: value = 3; case false: value++; } return value;",
  ),
  createCase(
    "let value = 0; try { if(first) throw 1; value = 2; } catch(error) { value = 3; } return value;",
  ),
  createCase(
    "let value = 0; try { if(first) return value; value = 1; } finally { value = 2; } return value;",
  ),
  createCase("let value = 0; try { throw 1; } finally { value = 4; return value; }"),
  createCase(
    "let value = 0; try { try { if(first) return value; value = 2; } finally { value++; } } finally { value += 2; } return value;",
  ),
  createCase("let value = 1; const read = () => value; value = 2; return read();", false),
  createCase(
    "let value = 1; const change = () => { value = 8; }; if(first) change(); return value;",
    false,
  ),
  createCase("let value = 1; { let value = 5; if(first) return value; } return value;"),
  createCase("let value = 0; first && (value = 1); return value;"),
  createCase("let value = 0; first || (value = 1); return value;"),
  createCase("let value = 0; const input = first ? null : 3; input ?? (value = 1); return value;"),
  createCase("let value = first; value &&= second; return value;"),
  createCase("let value = first ? null : 3; value ??= 4; return value;"),
  createCase("let value = '1'; const previous = value++; return previous + ':' + value;"),
  createCase("let value = 0; const object = null; object?.[value++]; return value;"),
  createCase("let value = 0; const callback = null; callback?.(value++); return value;"),
  createCase("let value = 0; const array = [(value = 1), (value = 2)]; return value;", false),
  createCase("let value = 0; const object = { [(value = 1)]: (value = 2) }; return value;", false),
  createCase("let value = 0; const text = `${value = 1}${value = 2}`; return value;", false),
  createCase("let value = 0; const [item = (value = 3)] = []; return value;", false),
  createCase("let value = 0; const {item = (value = 3)} = {}; return value;", false),
  createCase(
    "let value = 0; for (const item of [1,2]) { value = 3; if(first) break; } return value;",
    false,
  ),
  createCase("let value = 0; for (const key in {a:1}) value = 3; return value;", false),
  createCase(
    "let value = 0; try { missing(); value = 1; } catch { value = 2; } return value;",
    false,
  ),
  createCase(
    "let value = 0; try { later = 1; value = 1; } catch { value = 2; } let later; return value;",
  ),
  createCase(
    "let value = 0; try { const fixed = 1; fixed = 2; value = 1; } catch { value = 2; } return value;",
  ),
  createCase(
    "let value = 0; const object = { get field() { value = 3; return 4; } }; object.field; return value;",
    false,
  ),
  createCase("let value = 0; class Example { static field = (value = 3); } return value;", false),
  createCase("let value = first ? -0 : 0; return 1 / value;"),
  createCase("let value = 0 / 0; if(first) value = 0 / 0; return value === value;"),
  createCase("var value = 7; try { throw 1; } catch (value) { var value = 13; } return value;"),
  createCase("const key = 7; switch(key) { case 7: let key = 9; return key; }"),
  createCase(
    "let value = 0; for(let outer=0;outer<30;outer++) for(let inner=0;inner<10;inner++) value++; return value;",
  ),
  createCase("let value = 1n; for(let index=0;index<3;index++) value++; return value;"),
  createCase("try { const value = 1; value = 2; } catch(error) { return error.name; }"),
  createCase("try { return value; let value = 1; } catch(error) { return error.name; }"),
  createCase("try { value = 1; const value = 2; } catch(error) { return error.name; }"),
  createCase("try { throw 1; } catch(error) { return error.name; }", false),
  createCase(
    "try { try { throw 1; } finally { try { throw 2; } catch {} } } catch(error) { return error; }",
  ),
  createCase(
    "try { try { throw 1; } finally { try { throw 2; } catch {} if(first) throw 3; } } catch(error) { return error; }",
  ),
  createCase(
    "const namespace = { get Child() { throw 1; } }; let value = 0; try { <namespace.Child value={value = 1} />; } catch {} return value;",
    false,
  ),
  createCase(
    "let value = 0; outer: for(let index=0;index<2;index++) { try { for(;;) return value; } finally { if(value===0) { value=1; continue outer; } } } return value;",
  ),
];

it.each(cases)("constructs verified SSA and sound native read facts: $body", ({ body }) => {
  const source = `function probe(first, second) { ${body} }`;
  const node = parseFunction(source);
  const graph = enterSsa(lowerFunction(node));
  verifySsa(graph);
  eliminateRedundantPhis(graph);
  verifySsa(graph);
  const compiled = compileFunction(node);
  expect(compiled.status, compiled.reason ?? "").toBe("compiled");
  if (!compiled.function) throw new Error("Missing compiled function");
  let instrumented = source;
  const facts = [...getReadFacts(compiled.function)].sort(
    ([left], [right]) => right.start - left.start,
  );
  for (const [index, [reference]] of facts.entries()) {
    instrumented =
      instrumented.slice(0, reference.start) +
      `__ssaCheck(${source.slice(reference.start, reference.end)}, ${index})` +
      instrumented.slice(reference.end);
  }
  const code = transformSync(`"use strict"; ${instrumented}; probe(first, second);`, {
    loader: "tsx",
  }).code;
  for (const first of [false, true])
    for (const second of [false, true]) {
      const expected = runInNewContext(
        transformSync(`"use strict"; ${source}; probe(first, second);`, { loader: "tsx" }).code,
        { first, second, React },
        { timeout: 1000 },
      );
      const actual = runInNewContext(
        code,
        {
          first,
          second,
          React,
          __ssaCheck: (value: unknown, index: number) => {
            expect(
              Object.is(value, facts[index][1].value),
              `${body}: ${source.slice(facts[index][0].start, facts[index][0].end)}`,
            ).toBe(true);
            return value;
          },
        },
        { timeout: 1000 },
      );
      expect(Object.is(actual, expected)).toBe(true);
    }
});

it.each(cases)(
  "executes supported SSA directly or declines before observable effects: $body",
  ({ body, executable }) => {
    const source = `function probe(first, second) { ${body} }`;
    const node = parseFunction(source);
    for (const first of [false, true])
      for (const second of [false, true]) {
        const context = createEvaluationContext();
        context.budget.remaining = 100000;
        context.scope.bindings.set("first", primitiveValue(first));
        context.scope.bindings.set("second", primitiveValue(second));
        const result = executeSsa(
          node,
          context,
          {
            resolve: (value) => value,
            getTypeof: (value) => getTypeofValue(value, loadHostRealm("node")),
            consumeStep: () => --context.budget.remaining > 0,
            fork: () => {
              throw new Error("Concrete input unexpectedly forked");
            },
            distribute: () => {
              throw new Error("Concrete input unexpectedly distributed");
            },
          },
          null,
        );
        if (!executable) {
          expect(result).toBeNull();
          expect(context.budget.remaining).toBe(100000);
          continue;
        }
        const expected: unknown = runInNewContext(
          `"use strict"; ${source}; probe(first, second);`,
          { first, second },
          { timeout: 1000 },
        );
        expect(result?.kind).toBe("primitive");
        if (result?.kind !== "primitive") throw new Error("SSA did not produce a concrete result");
        expect(Object.is(result.value, expected), body).toBe(true);
      }
  },
);

it("gives reassigned locals distinct definitions and inserts loop phis", () => {
  const compiled = compileFunction(
    parseFunction(
      "function probe(first) { let value = 0; while(first) { value++; } return value; }",
    ),
  );
  const graph = compiled.function?.graph;
  if (!graph) throw new Error("Missing SSA graph");
  const binding = [...graph.variables.values()].find((variable) => variable.name === "value");
  expect(binding).toBeDefined();
  expect(
    [...graph.definitions.values()].filter((definition) => definition.variable === binding?.id)
      .length,
  ).toBeGreaterThan(2);
  expect(
    [...graph.blocks.values()]
      .flatMap((block) => block.phis)
      .some((phi) => phi.variable === binding?.id),
  ).toBe(true);
});

it("keeps captured writes in cells with an SSA effect chain", () => {
  const compiled = compileFunction(
    parseFunction(
      "function probe() { let value = 1; const change = () => { value = 2; }; change(); return value; }",
    ),
  );
  const graph = compiled.function?.graph;
  if (!graph) throw new Error("Missing SSA graph");
  expect([...graph.variables.values()].find((variable) => variable.name === "value")?.storage).toBe(
    "cell",
  );
  expect(
    [...graph.blocks.values()]
      .flatMap((block) => block.instructions)
      .some((instruction) => instruction.kind === "store-cell"),
  ).toBe(true);
  expect(
    [...getReadFacts(compiled.function!).keys()].some(
      (node) => node.type === "Identifier" && node.name === "value",
    ),
  ).toBe(false);
});

it("does not confuse lexical shadowing with capture", () => {
  const compiled = compileFunction(
    parseFunction(
      "function probe() { let value = 1; const read = () => { let value = 2; return value; }; return value; }",
    ),
  );
  expect(
    [...compiled.function!.graph.variables.values()].find((variable) => variable.name === "value")
      ?.storage,
  ).toBe("local");
});

it.each([
  "function probe(value = 3, other = value) { var value; return other + value; }",
  "async function probe(value) { let result = 1; try { await value; result = 2; } finally { result++; } return result; }",
  "function* probe() { let result = 1; try { yield result; result = 2; } finally { result++; } return result; }",
  "function probe() { let result = 0; outer: for(let index=0;index<2;index++) { try { for(;;) return result; } finally { if(result===0) { result=1; continue outer; } } } return result; }",
])("lowers parameter, suspension and finalizer edges: %s", (source) => {
  const compiled = compileFunction(parseFunction(source));
  expect(compiled.status, compiled.reason ?? "").toBe("compiled");
});

it.each([
  "return (() => { if (first) throw 'stop'; return second ? 'yes' : 'no'; })();",
  "return (() => { try { if (first) throw 'first'; return 'ok'; } finally { if (second) throw 'second'; } })();",
  "const getResult = (value) => { try { return value + 1; } catch(error) { return error.name; } }; return getResult(first ? 1n : 1);",
  "const getZero = () => { if(first) return -0; return 0; }; return 1 / getZero();",
])("preserves guarded completion across SSA calls: %s", (body) =>
  checkGuardedCases([{ name: "SSA completion", body }]),
);

it.each(["this", "super"])(
  "keeps derived %s failures before computed property effects",
  (receiver) => {
    const source = `class Base {} class Child extends Base { constructor() { let value = 0; try { ${receiver}[(value = 1)]; } catch {} return {result: value}; } }`;
    const parsed = parseSourceText("/ssa-class.ts", source, "ts");
    expect(parsed.errors).toEqual([]);
    const declaration = parsed.program.body[1];
    if (declaration.type !== "ClassDeclaration") throw new Error("Missing derived class");
    const constructor = declaration.body.body.find(
      (member) => member.type === "MethodDefinition" && member.kind === "constructor",
    );
    if (constructor?.type !== "MethodDefinition") throw new Error("Missing constructor");
    const compiled = compileFunction(constructor.value).function;
    if (!compiled) throw new Error("Missing constructor graph");
    const expected: unknown = runInNewContext(
      `${source}; new Child().result`,
      {},
      { timeout: 1000 },
    );
    expect(expected).toBe(0);
    for (const [reference, fact] of getReadFacts(compiled)) {
      if (reference.start === source.lastIndexOf("value"))
        expect(Object.is(fact.value, expected)).toBe(true);
    }
  },
);

it("reports dynamic scope instead of using an incomplete graph", () => {
  const node = parseFunction("function probe(code) { let value = 1; eval(code); return value; }");
  const result = compileFunction(node);
  expect(result.status).toBe("unsupported");
  expect(result.function).toBeNull();
  expect(compileFunction(node)).toBe(result);
});

it.each(cases.filter((testCase) => testCase.executable))(
  "uses SSA without losing input associations: $body",
  async ({ body }) => {
    await checkGuardedCases([
      { name: "SSA execution", body: `return String((() => { ${body} })());` },
    ]);
  },
);
