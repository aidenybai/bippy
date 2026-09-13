import { describe, expect, it } from "vite-plus/test";
import { WorkStack, type Work } from "../src/harness/work-stack.js";

class ScopedWork {
  static *fail(depth: number, released: number[], failure: unknown): Work<never> {
    try {
      if (depth === 0) throw failure;
      return yield* WorkStack.wait(ScopedWork.fail(depth - 1, released, failure));
    } finally {
      released.push(depth);
    }
  }
}

describe("WorkStack", () => {
  it.each([undefined, null, 0, false])("retains a direct or deferred result (%s)", (result) => {
    expect(WorkStack.run(WorkStack.wait(result))).toBe(result);
    expect(WorkStack.run(WorkStack.map(WorkStack.wait(result), (value) => ({ value })))).toEqual({
      value: result,
    });
  });

  it.each([undefined, null, new Error("scoped failure")])(
    "unwinds deep scopes without replacing a thrown value (%s)",
    (failure) => {
      const released: number[] = [];
      let hasThrown = false;
      let caught: unknown;
      try {
        WorkStack.run(ScopedWork.fail(5_000, released, failure));
      } catch (error) {
        hasThrown = true;
        caught = error;
      }
      expect(hasThrown).toBe(true);
      expect(caught).toBe(failure);
      expect(released).toEqual(Array.from({ length: 5_001 }, (_value, index) => index));
    },
  );
});
