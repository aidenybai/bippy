import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transformSync } from "esbuild";
import {
  parseSync,
  type Class,
  type Function as FunctionNode,
  type Node,
  type Program,
} from "oxc-parser";
import { describe, expect, it } from "vite-plus/test";
import { getEsbuildDeclarationName } from "../src/graph/esbuild-symbol-names.js";
import { formatPattern, getRenderPattern } from "../src/harness/index.js";
import { createStaticRenderer } from "../src/index.js";
import { forEachChildNode } from "../src/parse/ast-walk.js";

const COMPONENTS_DIRECTORY = join(import.meta.dirname, "components");
const FIXTURE = "esbuild-renamed-declarations.tsx";

const collectDeclarationNames = (
  sourceText: string,
  getName: (program: Program, declaration: FunctionNode | Class) => string,
): string[] => {
  const { program } = parseSync("module.tsx", sourceText, { sourceType: "module" });
  const names: string[] = [];
  const visit = (node: Node): void => {
    if (
      (node.type === "FunctionDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ClassDeclaration" ||
        node.type === "ClassExpression") &&
      node.id
    ) {
      names.push(getName(program, node));
    }
    forEachChildNode(node, visit);
  };
  visit(program);
  return names;
};

const predictDeclarationNames = (sourceText: string): string[] =>
  collectDeclarationNames(
    sourceText,
    (program, declaration) =>
      getEsbuildDeclarationName(program, declaration) ?? declaration.id?.name ?? "",
  );

/** The names esbuild itself prints, in source order, when it transforms the module the way `vite:esbuild` does. */
const printedDeclarationNames = (sourceText: string): string[] => {
  const { code } = transformSync(sourceText, { loader: "tsx", jsx: "automatic" });
  return collectDeclarationNames(code, (_program, declaration) => declaration.id?.name ?? "");
};

const CASES: Record<string, string> = {
  "function expression shadowing its binding": `
    import { memo } from "react";
    export const Foo = memo(function Foo() { return null; });
    const Bar = memo(function Bar() { return null; });`,
  "class expression shadowing its binding": `
    export const Foo = wrap(class Foo {});
    const Bar = wrap(class Bar {});`,
  "imported name reused by a local function": `
    import { Foo } from "./foo";
    const Wrapped = wrap(function Foo() { return Foo; });`,
  "siblings and nesting renumber in order": `
    export const A = wrap(function Row() {
      const Row = wrap(function Row() { return null; });
      return Row;
    });
    export const B = wrap(function Row() { return null; });
    const Row = 1;`,
  "block, loop and catch bindings": `
    export const Foo = 1;
    wrap(function Bar() {});
    { const Foo = 2; wrap(function Bar() { return Foo; }); }
    for (const Foo of []) { wrap(function Foo() { return Foo; }); }
    try {} catch (Foo) { wrap(function Foo() { return Foo; }); }
    { const Bar = wrap(function Bar() {}); }`,
  "top-level order decides who keeps the name": `
    export {};
    wrap(function Foo() {});
    const Foo = 1;
    export const Bar = 1;
    wrap(function Bar() {});
    wrap(class Baz {});
    const Baz = wrap(class Baz {});`,
  "scripts keep every top-level binding": `
    const Foo = wrap(function Foo() {});
    wrap(function Bar() {});
    var Bar = 1;`,
  "imports renumber after earlier expression names": `
    export {};
    wrap(function Foo() {});
    import Foo from "./foo";
    import * as Bar from "./bar";
    wrap(function Bar() {});`,
  "declarations without exports keep top-level names": `
    const Foo = wrap(function Foo() { return null; });
    function Bar() { const Bar = 1; return Bar; }`,
  "exported declarations keep their names": `
    export function Foo() { function Foo() {} return Foo; }
    export class Bar { static Bar = wrap(function Bar() {}); method() { class Bar {} } }`,
  "nested class expressions are left alone unless top-level": `
    export {};
    const Foo = wrap(class Foo {});
    const Bar = 1;
    const make = () => wrap(class Bar {}, class Foo {}, function Foo() {});
    class Baz { static Bar = class Bar {}; method() { return class Baz {}; } }`,
  "parameters and defaults": `
    export const Foo = 1;
    export const make = (Foo = function Foo() {}, { Bar } = {}) => function Bar() { return [Foo, Bar]; };`,
  "type-only imports do not bind": `
    import type { Foo } from "./foo";
    import { type Bar, baz } from "./bar";
    const Foo = wrap(function Foo() {});
    const Bar = wrap(function Bar() {});
    const Wrapped = wrap(function baz() {});`,
  "enums and namespaces bind": `
    export enum Foo { A }
    namespace Bar { export const x = 1; }
    const Wrapped = wrap(function Foo() {}, function Bar() {});`,
};

describe("esbuild symbol renumbering", () => {
  for (const [name, sourceText] of Object.entries(CASES)) {
    it(name, () => {
      expect(predictDeclarationNames(sourceText)).toEqual(printedDeclarationNames(sourceText));
    });
  }

  it("matches esbuild on the component fixture", () => {
    const sourceText = readFileSync(join(COMPONENTS_DIRECTORY, FIXTURE), "utf8");
    const printed = printedDeclarationNames(sourceText);
    expect(printed).toContain("Panel2");
    expect(printed).toContain("Row4");
    expect(predictDeclarationNames(sourceText)).toEqual(printed);
  });
});

describe("static render under an esbuild transpiler", () => {
  const render = async (transpiler: "esbuild" | "name-preserving"): Promise<string> => {
    const renderer = createStaticRenderer({
      rootDirectory: COMPONENTS_DIRECTORY,
      tsconfigPath: join(COMPONENTS_DIRECTORY, "tsconfig.json"),
      transpiler,
    });
    const result = await renderer.renderComponent(join(COMPONENTS_DIRECTORY, FIXTURE));
    return formatPattern(getRenderPattern(result));
  };

  it("names components as the served module does", async () => {
    const tree = await render("esbuild");
    expect(tree).toMatch(/<Panel2>\n\s+<section>/);
    expect(tree).toMatch(/<Badge2>\n\s+<b>/);
    expect(tree).toMatch(/<Field2>\n\s+<input>/);
    expect(tree).toMatch(/<Card2>\n\s+<article>/);
    expect(tree).toMatch(/<Row2>\n\s+<li>\n\s+<Row4>\n\s+<i>/);
    expect(tree).toMatch(/<Cell2>\n\s+<table>/);
    expect(tree).toMatch(/<tr>\n\s+<Cell>\n\s+<td>/);
    expect(tree).toMatch(/<Kind2>\n\s+<em>/);
  });

  it("keeps source names for name-preserving transpilers", async () => {
    const tree = await render("name-preserving");
    expect(tree).toMatch(/<Panel>\n\s+<section>/);
    expect(tree).toMatch(/<Row>\n\s+<li>\n\s+<Row>\n\s+<i>/);
    expect(tree).not.toContain("2>");
  });
});
