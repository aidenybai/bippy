import { expect, test } from "./coverage-test";
import { waitForBippy, waitForTestChild } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForTestChild(page);
  await waitForBippy(page);
});

const findTestParentFiber = `
  const element = document.querySelector('[data-testid="parent-host"]');
  const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
  let parentFiber = hostFiber?.return ?? null;
  while (parentFiber && window.__BIPPY__.getDisplayName(parentFiber.type) !== "TestParent") {
    parentFiber = parentFiber.return;
  }
`;

test.describe("hook inspection", () => {
  test("getFiberHooks lists TestParent's state and effect hooks", async ({ page }) => {
    const result = await page.evaluate(`(() => {
      ${findTestParentFiber}
      if (!parentFiber) return null;
      const hooksTree = window.__BIPPY__.getFiberHooks(parentFiber);
      // hook entries nest under nodes named after the calling stack frames
      // (how deep depends on the bundler), so the tree is flattened and the
      // primitive entries with numeric ids are picked out for value checks
      const flatHooks = [];
      const collectHooks = (nodes) => {
        for (const hooksNode of nodes) {
          flatHooks.push(hooksNode);
          collectHooks(hooksNode.subHooks ?? []);
        }
      };
      collectHooks(hooksTree);
      return {
        hookNames: flatHooks.map((hooksNode) => hooksNode.name),
        numericIdCount: flatHooks.filter((hooksNode) => typeof hooksNode.id === "number").length,
        hookValues: flatHooks.map((hooksNode) => hooksNode.value),
      };
    })()`);
    expect(result).not.toBeNull();
    const typedResult = result as {
      hookNames: string[];
      numericIdCount: number;
      hookValues: unknown[];
    };
    expect(
      typedResult.hookNames.filter((hookName) => hookName === "State").length,
    ).toBeGreaterThanOrEqual(2);
    expect(typedResult.hookNames).toContain("Effect");
    // two useState hooks + one useEffect hook
    expect(typedResult.numericIdCount).toBeGreaterThanOrEqual(3);
    // count starts at 0, showConditional starts at true
    expect(typedResult.hookValues).toContain(0);
    expect(typedResult.hookValues).toContain(true);
  });

  test("parseHookNames resolves source variable names for the hooks", async ({ page }) => {
    const result = await page.evaluate(`(() => {
      ${findTestParentFiber}
      if (!parentFiber) return Promise.resolve(null);
      const hooksTree = window.__BIPPY__.getFiberHooks(parentFiber);
      return window.__BIPPY__.parseHookNames(hooksTree).then((hookNames) => {
        return Array.from(hookNames.values());
      });
    })()`);
    expect(result).not.toBeNull();
    if (test.info().project.name === "nextjs") {
      // next's dev server registers hook call sites under webpack-internal://
      // URLs whose source maps cannot be fetched, so names cannot resolve
      expect(Array.isArray(result)).toBe(true);
      return;
    }
    expect(result as string[]).toContain("count");
    expect(result as string[]).toContain("showConditional");
  });
});

test.describe("debug metadata", () => {
  test("hasDebugStack is true for dev fibers", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      let childFiber = hostFiber?.return ?? null;
      while (childFiber && window.__BIPPY__.getDisplayName(childFiber.type) !== "TestChild") {
        childFiber = childFiber.return;
      }
      if (!childFiber) return null;
      return { hasStack: window.__BIPPY__.hasDebugStack(childFiber) };
    });
    expect(result).not.toBeNull();
    expect(result!.hasStack).toBe(true);
  });

  test("formatOwnerStack strips the error header from a raw owner stack", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      let childFiber = hostFiber?.return ?? null;
      while (childFiber && !window.__BIPPY__.hasDebugStack(childFiber)) {
        childFiber = childFiber.return;
      }
      if (!childFiber) return null;
      const rawStack = childFiber._debugStack.stack;
      const formattedStack = window.__BIPPY__.formatOwnerStack(rawStack);
      return { rawStack, formattedStack, emptyInput: window.__BIPPY__.formatOwnerStack("") };
    });
    expect(result).not.toBeNull();
    expect(typeof result!.formattedStack).toBe("string");
    expect(result!.formattedStack.startsWith("Error")).toBe(false);
    expect(result!.emptyInput).toBe("");
  });
});

test.describe("stack symbolication", () => {
  test("symbolicateStack maps bundle frames back to the fixture source file", async ({ page }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      let childFiber = hostFiber?.return ?? null;
      while (childFiber && !window.__BIPPY__.hasDebugStack(childFiber)) {
        childFiber = childFiber.return;
      }
      if (!childFiber) return null;

      const stackFrames = window.__BIPPY__.parseStack(childFiber._debugStack.stack ?? "");
      return window.__BIPPY__.symbolicateStack(stackFrames).then((symbolicatedFrames) => ({
        frameCount: symbolicatedFrames.length,
        originalFrameCount: stackFrames.length,
        fileNames: symbolicatedFrames.map((stackFrame) => stackFrame.fileName ?? null),
      }));
    });
    expect(result).not.toBeNull();
    expect(result!.frameCount).toBe(result!.originalFrameCount);
    // the JSX callsite for test-child lives in the fixture harness source
    expect(
      result!.fileNames.some((fileName) => /test-(app|harness)\.tsx/.test(fileName ?? "")),
    ).toBe(true);
  });
});
