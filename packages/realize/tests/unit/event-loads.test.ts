import { describe, expect, it } from "vite-plus/test";
import { compileFile } from "../../src/core/compile/compile";
import { getFunctionLoads } from "../../src/core/handlers/event-loads";
import { isFunctionCreation } from "../../src/core/interpret/is-function-creation";
import type { HIRFunction } from "../../src/react-compiler/HIR/HIR";

const getHandler = (body: string): HIRFunction => {
  const compiled = compileFile(
    "handler.tsx",
    `export const Button = ({ modal, isOpen }) => <button onClick={(event) => {${body}}} />;`,
  );
  const component = compiled.functions[0]?.hir;
  for (const block of component?.body.blocks.values() ?? [])
    for (const instruction of block.instructions)
      if (isFunctionCreation(instruction.value)) return instruction.value.loweredFunc.func;
  throw new Error("no handler");
};

describe("event loads", () => {
  it("counts a call after a branch as always run", () => {
    expect(
      getFunctionLoads(getHandler("if (isOpen) modal.close(); event.preventDefault();")),
    ).toEqual({
      stops: null,
      prevents: "always",
    });
  });

  it("counts a call after an early return as maybe run", () => {
    expect(getFunctionLoads(getHandler("if (isOpen) return; event.stopPropagation();"))).toEqual({
      stops: "maybe",
      prevents: null,
    });
  });

  it("ignores preventDefault on an object that isn't the event", () => {
    expect(getFunctionLoads(getHandler("modal.preventDefault();"))).toEqual({
      stops: null,
      prevents: null,
    });
  });

  it("follows the event through a local and a nested function", () => {
    expect(
      getFunctionLoads(
        getHandler(
          "const native = event.nativeEvent; queueMicrotask(() => native.preventDefault());",
        ),
      ),
    ).toEqual({ stops: null, prevents: "maybe" });
  });
});
