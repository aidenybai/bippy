import { describe, expect, it } from "vite-plus/test";
import { analyzeFixture, getComponent } from "./helpers";

describe("a component the React Compiler already compiled", () => {
  const project = analyzeFixture("conformance-repros", "compiled-slots");

  it("keeps a closure stored in a cache slot from failing the compiler", () => {
    const { analysis } = getComponent(project, "CompiledSlots");
    expect(analysis.bailouts).toEqual([]);
  });
});
