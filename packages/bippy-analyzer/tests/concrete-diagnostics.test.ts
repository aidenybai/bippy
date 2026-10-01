import { expect, it } from "vitest";
import { createConcreteRuntime, ConcreteGuestError } from "../src/index.js";

it.each([
  "new TypeError('fixture message')",
  "'primitive failure'",
  "globalThis",
  `{
    get message() {
      observations++;
      throw "getter invoked";
    },
    toJSON() {
      observations++;
      throw "toJSON invoked";
    },
    [Symbol.toPrimitive]() {
      observations++;
      throw "coercion invoked";
    },
  }`,
])("serializes diagnostics without traversing the guest heap: %s", async (expression) => {
  const runtime = await createConcreteRuntime();
  try {
    runtime.evaluate(`
      globalThis.observations = 0;
      globalThis.thrown = (${expression})
    `);
    try {
      runtime.evaluate("throw thrown");
      throw new Error("Expected a guest exception");
    } catch (error) {
      expect(error).toBeInstanceOf(ConcreteGuestError);
      if (!(error instanceof ConcreteGuestError)) throw error;
      const diagnostic = error.toJSON();
      expect(JSON.stringify(diagnostic).length).toBeLessThan(8_192);
      expect(JSON.parse(JSON.stringify(error))).toMatchObject({
        name: "ConcreteGuestError",
        message: error.message,
        valueType: error.value.type,
      });
      expect(structuredClone(diagnostic)).toEqual(diagnostic);
      expect(diagnostic).not.toHaveProperty("value");
      expect(error).not.toHaveProperty("cause");
      expect(Object.keys(error)).not.toContain("value");
      expect(error.value === runtime.evaluate("thrown")).toBe(true);
      expect(runtime.readString("String(observations)")).toBe("0");
      if (expression.startsWith("new TypeError")) {
        expect(diagnostic.message).toBe("TypeError: fixture message");
        expect(diagnostic.guestStack).toContain("<anonymous>");
      }
    }
  } finally {
    runtime.dispose();
  }
});
