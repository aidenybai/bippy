// Minimal in-page assertion helper so ported scenario bodies keep their
// original `expect(...)` shape while running inside the browser.

const formatValue = (value: unknown): string => {
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (value instanceof HTMLElement) return `<${value.tagName.toLowerCase()}>`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

class AssertionFailure extends Error {}

interface ExpectApi {
  toBe(expected: unknown): void;
  not: {
    toBe(expected: unknown): void;
  };
  toEqual(expected: unknown): void;
  toHaveLength(expected: number): void;
  toContain(expected: unknown): void;
  toThrow(expectedMessage?: string): void;
}

export const expect = (actual: unknown): ExpectApi => ({
  toBe(expected) {
    if (!Object.is(actual, expected)) {
      throw new AssertionFailure(
        `expected ${formatValue(actual)} to be ${formatValue(expected)}`,
      );
    }
  },
  not: {
    toBe(expected) {
      if (Object.is(actual, expected)) {
        throw new AssertionFailure(`expected ${formatValue(actual)} to not be ${formatValue(expected)}`);
      }
    },
  },
  toEqual(expected) {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    if (actualJson !== expectedJson) {
      throw new AssertionFailure(`expected ${actualJson} to equal ${expectedJson}`);
    }
  },
  toHaveLength(expected) {
    const length =
      typeof actual === "object" && actual !== null && "length" in actual
        ? (actual as { length: unknown }).length
        : undefined;
    if (length !== expected) {
      throw new AssertionFailure(`expected length ${String(length)} to be ${expected}`);
    }
  },
  toContain(expected) {
    const isContained =
      typeof actual === "string"
        ? actual.includes(String(expected))
        : Array.isArray(actual)
          ? actual.includes(expected)
          : false;
    if (!isContained) {
      throw new AssertionFailure(
        `expected ${formatValue(actual)} to contain ${formatValue(expected)}`,
      );
    }
  },
  toThrow(expectedMessage) {
    if (typeof actual !== "function") {
      throw new AssertionFailure("expected a function to assert throws");
    }
    let didThrow = false;
    let message = "";
    try {
      actual();
    } catch (error) {
      didThrow = true;
      message = error instanceof Error ? error.message : String(error);
    }
    if (!didThrow) {
      throw new AssertionFailure("expected function to throw");
    }
    if (expectedMessage !== undefined && !message.includes(expectedMessage)) {
      throw new AssertionFailure(
        `expected error message ${formatValue(message)} to contain ${formatValue(expectedMessage)}`,
      );
    }
  },
});
