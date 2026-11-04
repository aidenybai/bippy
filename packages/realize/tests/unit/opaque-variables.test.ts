import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource } from "../../src/react-compiler/HIR/HIR";
import { createVariableTable } from "../../src/core/model/variables";
import { createEmptyAnalysis } from "../../src/core/project/analyze-component";
import type { SymbolicValue } from "../../src/core/types";

const NOTHING: SymbolicValue = { kind: "Primitive", value: null };

const callHook = (argument: number): SymbolicValue => ({
  kind: "HookResult",
  hookKind: "Custom",
  name: "useFlag",
  module: null,
  argumentValues: [{ kind: "Primitive", value: argument }],
  loc: GeneratedSource,
});

const createTable = () =>
  createVariableTable(
    createEmptyAnalysis(
      { name: "Flags", exportName: "Flags", file: "flags.tsx", declaration: "flags.tsx:Flags" },
      GeneratedSource,
      NOTHING,
    ),
    [],
  );

describe("opaque variables", () => {
  it("gives two tests that print the same their own variables", () => {
    const table = createTable();
    table.compile(callHook(1));
    table.compile(callHook(2));
    expect(table.variables.map((variable) => [variable.name, variable.label])).toEqual([
      ["opaque_useFlag", "useFlag()"],
      ["opaque_useFlag_2", "useFlag()"],
    ]);
  });

  it("shares one variable between equal tests", () => {
    const table = createTable();
    table.compile(callHook(1));
    table.compile(callHook(1));
    expect(table.variables).toHaveLength(1);
  });

  it("forgets the variables an existing-only compile rolls back", () => {
    const table = createTable();
    expect(table.compileExisting(callHook(1))).toBeNull();
    table.compile(callHook(1));
    expect(table.variables.map((variable) => variable.name)).toEqual(["opaque_useFlag"]);
  });
});
