import { expect, test } from "./coverage-test";
import { waitForBippy, waitForTestChild } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForTestChild(page);
  await waitForBippy(page);
});

test.describe("describeFiber built-in frames", () => {
  test("describes suspense, suspense fallback, host, and unknown tags", async ({ page }) => {
    const result = await page.evaluate(() => {
      const describeFiber = window.__BIPPY__.describeFiber;
      const suspenseFiber = { tag: window.__BIPPY__.SuspenseComponentTag, child: { tag: 5 } };
      return {
        suspense: describeFiber(suspenseFiber, null),
        suspenseSameChild: describeFiber(suspenseFiber, suspenseFiber.child),
        suspenseFallback: describeFiber(suspenseFiber, { tag: 5 }),
        host: describeFiber({ tag: window.__BIPPY__.HostComponentTag, type: "section" }, null),
        unknownTag: describeFiber({ tag: 99_999, type: null }, null),
      };
    });
    expect(result.suspense).toBe("\n    in Suspense");
    expect(result.suspenseSameChild).toBe("\n    in Suspense");
    expect(result.suspenseFallback).toBe("\n    in Suspense Fallback");
    expect(result.host).toBe("\n    in section");
    expect(result.unknownTag).toBe("");
  });
});

test.describe("describeFiber native frames from crafted stacks", () => {
  test("extracts the caller frame when sample and control stacks diverge", async ({ page }) => {
    const result = await page.evaluate(() => {
      const FakeDivergingComponent = () => {
        const sampleError = new Error("crafted");
        sampleError.stack =
          "Error\n    at FakeUserFrame (fake-user.js:5:5)\n    at DetermineComponentFrameRoot (fake-root.js:9:9)";
        throw sampleError;
      };
      return window.__BIPPY__.describeFiber(
        { tag: window.__BIPPY__.FunctionComponentTag, type: FakeDivergingComponent },
        null,
      );
    });
    expect(result).toBe("\n    at FakeUserFrame (fake-user.js:5:5)");
  });

  test("walks past a shared message line until the control stack is exhausted", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const FakeExhaustingComponent = () => {
        const sampleError = new Error("crafted");
        sampleError.stack =
          "    at leadingFakeFrame (fake-lead.js:1:1)\nError\n    at DetermineComponentFrameRoot (fake-root.js:9:9)";
        throw sampleError;
      };
      return window.__BIPPY__.describeFiber(
        { tag: window.__BIPPY__.FunctionComponentTag, type: FakeExhaustingComponent },
        null,
      );
    });
    expect(result).toBe("\n    at leadingFakeFrame (fake-lead.js:1:1)");
  });

  test("strips the V8 'new' prefix from constructed frames", async ({ page }) => {
    const result = await page.evaluate(() => {
      const FakeConstructedComponent = () => {
        const sampleError = new Error("crafted");
        sampleError.stack =
          "Error\n    at new FakeConstructed (fake-ctor.js:3:3)\n    at DetermineComponentFrameRoot (fake-root.js:9:9)";
        throw sampleError;
      };
      return window.__BIPPY__.describeFiber(
        { tag: window.__BIPPY__.FunctionComponentTag, type: FakeConstructedComponent },
        null,
      );
    });
    expect(result).toBe("\n    at FakeConstructed (fake-ctor.js:3:3)");
  });

  test("replaces <anonymous> frames with the component displayName", async ({ page }) => {
    const result = await page.evaluate(() => {
      const named = () => {
        const sampleError = new Error("crafted");
        sampleError.stack =
          "Error\n    at <anonymous> (fake-anon.js:2:2)\n    at DetermineComponentFrameRoot (fake-root.js:9:9)";
        throw sampleError;
      };
      (named as { displayName?: string }).displayName = "RenamedComponent";
      return window.__BIPPY__.describeFiber(
        { tag: window.__BIPPY__.FunctionComponentTag, type: named },
        null,
      );
    });
    expect(result).toBe("\n    at RenamedComponent (fake-anon.js:2:2)");
  });

  test("keeps <anonymous> frames when the component has no display name", async ({ page }) => {
    const result = await page.evaluate(() => {
      const anonymousComponent = () => {
        const sampleError = new Error("crafted");
        sampleError.stack =
          "Error\n    at <anonymous> (fake-anon.js:2:2)\n    at DetermineComponentFrameRoot (fake-root.js:9:9)";
        throw sampleError;
      };
      Object.defineProperty(anonymousComponent, "name", { value: "" });
      return window.__BIPPY__.describeFiber(
        { tag: window.__BIPPY__.FunctionComponentTag, type: anonymousComponent },
        null,
      );
    });
    expect(result).toBe("\n    at <anonymous> (fake-anon.js:2:2)");
  });

  test("falls back to a synthetic frame when the root marker is missing", async ({ page }) => {
    const result = await page.evaluate(() => {
      const FakeThrowingComponent = () => {
        const sampleError = new Error("crafted");
        sampleError.stack = "Error\n    at somewhere (fake.js:1:1)";
        throw sampleError;
      };
      return window.__BIPPY__.describeFiber(
        { tag: window.__BIPPY__.FunctionComponentTag, type: FakeThrowingComponent },
        null,
      );
    });
    expect(result).toBe("\n    in FakeThrowingComponent");
  });

  test("returns an empty frame for nameless components with unusable stacks", async ({ page }) => {
    const result = await page.evaluate(() => {
      const namelessComponent = () => {
        const sampleError = new Error("crafted");
        sampleError.stack = "Error";
        throw sampleError;
      };
      Object.defineProperty(namelessComponent, "name", { value: "" });
      return window.__BIPPY__.describeFiber(
        { tag: window.__BIPPY__.FunctionComponentTag, type: namelessComponent },
        null,
      );
    });
    expect(result).toBe("");
  });

  test("skips renderers without a dispatcher ref while describing real frames", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const fakeRenderer = {};
      window.__BIPPY__._renderers.add(fakeRenderer);
      const RealThrowingComponent = () => {
        throw new Error("real-throw");
      };
      const frame = window.__BIPPY__.describeFiber(
        { tag: window.__BIPPY__.FunctionComponentTag, type: RealThrowingComponent },
        null,
      );
      window.__BIPPY__._renderers.delete(fakeRenderer);
      return frame;
    });
    expect(result).toContain("RealThrowingComponent");
  });
});
