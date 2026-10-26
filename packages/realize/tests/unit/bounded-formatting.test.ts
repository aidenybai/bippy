import { describe, expect, it } from "vite-plus/test";
import { GeneratedSource, makeInstructionId } from "../../src/react-compiler/HIR/HIR";
import { formatSymbolicValue } from "../../src/core/format";
import type { SymbolicValue } from "../../src/core/types";

const createSharedChoice = (depth: number): SymbolicValue => {
  let value: SymbolicValue = { kind: "Primitive", value: 0 };
  for (let level = 0; level < depth; level++)
    value = {
      kind: "Conditional",
      test: { kind: "Unknown", reason: `level ${level}`, loc: GeneratedSource },
      testKind: "truthy",
      consequent: value,
      alternate: value,
      branch: {
        terminalId: makeInstructionId(level),
        probe: "none",
        loc: GeneratedSource,
        file: "shared.tsx",
      },
      guardKeys: [],
    };
  return value;
};

describe("formatting a value whose parts are shared", () => {
  it("stays short when the tree it stands for is huge", () => {
    expect(formatSymbolicValue(createSharedChoice(40)).length).toBeLessThan(10_000);
  });

  it("writes a small value in full", () => {
    expect(formatSymbolicValue(createSharedChoice(1))).toBe("Unknown(level 0) ? 0 : 0");
  });
});
