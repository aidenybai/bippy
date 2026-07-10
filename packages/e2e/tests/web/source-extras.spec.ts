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

  test("getHookSourceLocationKey and extractHookVariableName are consistent helpers", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const sourceCode = [
        "const useThing = () => {",
        "  const [count, setCount] = useState(0);",
        "  const plain = useMemo(() => count * 2, [count]);",
        "  return plain;",
        "};",
      ].join("\n");
      return {
        locationKey: window.__BIPPY__.getHookSourceLocationKey({
          fileName: "app.tsx",
          lineNumber: 12,
          columnNumber: 34,
        }),
        missingFieldsKey: window.__BIPPY__.getHookSourceLocationKey({}),
        destructuredName: window.__BIPPY__.extractHookVariableName(
          sourceCode,
          2,
          sourceCode.split("\n")[1].indexOf("useState") + 1,
        ),
        plainName: window.__BIPPY__.extractHookVariableName(
          sourceCode,
          3,
          sourceCode.split("\n")[2].indexOf("useMemo") + 1,
        ),
        outOfRange: window.__BIPPY__.extractHookVariableName(sourceCode, 99, 1),
      };
    });
    expect(result.locationKey).toBe("app.tsx:12:34");
    expect(result.missingFieldsKey).toBe(":0:0");
    expect(result.destructuredName).toBe("count");
    expect(result.plainName).toBe("plain");
    expect(result.outOfRange).toBeNull();
  });
});

test.describe("debug metadata", () => {
  test("hasDebugStack is true for dev fibers, hasDebugSource reflects React 19's removal", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      let childFiber = hostFiber?.return ?? null;
      while (childFiber && window.__BIPPY__.getDisplayName(childFiber.type) !== "TestChild") {
        childFiber = childFiber.return;
      }
      if (!childFiber) return null;
      return {
        hasStack: window.__BIPPY__.hasDebugStack(childFiber),
        hasSource: window.__BIPPY__.hasDebugSource(childFiber),
      };
    });
    expect(result).not.toBeNull();
    expect(result!.hasStack).toBe(true);
    // React 19 dropped _debugSource in favor of owner stacks
    expect(result!.hasSource).toBe(false);
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

  test("getFallbackOwnerStack walks the fiber tree into a component stack string", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      return window.__BIPPY__.getFallbackOwnerStack(hostFiber);
    });
    expect(result).not.toBeNull();
    expect(result).toContain("TestChild");
    expect(result).toContain("TestParent");
  });

  test("describeDebugInfoFrame renders a frame line with an optional environment", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      return {
        withEnvironment: window.__BIPPY__.describeDebugInfoFrame("ServerThing", "Server"),
        withoutEnvironment: window.__BIPPY__.describeDebugInfoFrame("ServerThing"),
      };
    });
    expect(result.withEnvironment).toContain("ServerThing");
    expect(result.withEnvironment).toContain("(at Server)");
    expect(result.withoutEnvironment).toContain("ServerThing");
    expect(result.withoutEnvironment).not.toContain("(at");
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

test.describe("browser-specific stack parsers", () => {
  test("parseV8OrIE handles chrome-style stacks including eval and anonymous frames", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      const chromeStack = [
        "Error: boom",
        "    at renderWidget (http://localhost:3000/assets/app.js:10:5)",
        "    at eval (eval at run (http://localhost:3000/assets/app.js:20:9), <anonymous>:1:1)",
        "    at http://localhost:3000/assets/vendor.js:30:7",
      ].join("\n");
      return {
        fromError: window.__BIPPY__.parseV8OrIE({ stack: chromeStack } as never),
        fromString: window.__BIPPY__.parseV8OrIeString(chromeStack),
        sliced: window.__BIPPY__.parseV8OrIeString(chromeStack, { slice: 1 }),
      };
    });
    expect(result.fromError).toEqual(result.fromString);
    expect(result.fromString).toHaveLength(3);
    expect(result.fromString[0]).toMatchObject({
      functionName: "renderWidget",
      fileName: "http://localhost:3000/assets/app.js",
      lineNumber: 10,
      columnNumber: 5,
    });
    expect(result.fromString[2].fileName).toBe("http://localhost:3000/assets/vendor.js");
    expect(result.sliced).toHaveLength(1);
  });

  test("parseFFOrSafari handles firefox-style stacks and native frames", async ({ page }) => {
    const result = await page.evaluate(() => {
      const firefoxStack = [
        "renderWidget@http://localhost:3000/assets/app.js:10:5",
        "@http://localhost:3000/assets/vendor.js:30:7",
        "[native code]",
      ].join("\n");
      return {
        fromError: window.__BIPPY__.parseFFOrSafari({ stack: firefoxStack } as never),
        fromString: window.__BIPPY__.parseFFOrSafariString(firefoxStack),
      };
    });
    expect(result.fromError).toEqual(result.fromString);
    expect(result.fromString).toHaveLength(2);
    expect(result.fromString[0]).toMatchObject({
      functionName: "renderWidget",
      fileName: "http://localhost:3000/assets/app.js",
      lineNumber: 10,
      columnNumber: 5,
    });
  });

  test("parseOpera dispatches across opera 9/10/11 stack formats", async ({ page }) => {
    const result = await page.evaluate(() => {
      const opera9Error = {
        message: [
          "Statement on line 42: oops",
          "Backtrace:",
          "  Line 42 of linked script http://localhost:3000/app.js",
          "",
          "  Line 7 of inline#1 script in http://localhost:3000/index.html",
        ].join("\n"),
        stacktrace: "",
      };
      const opera10Error = {
        message: "oops",
        stacktrace: [
          "  Line 42 of linked script http://localhost:3000/app.js: In function renderWidget",
          "",
          "  Line 7 of inline#1 script in http://localhost:3000/index.html",
        ].join("\n"),
      };
      const opera11Error = {
        message: "oops",
        stacktrace: "ignored",
        stack: [
          "renderWidget([arguments not available])@http://localhost:3000/app.js:42",
          "Error created at run@http://localhost:3000/app.js:50",
        ].join("\n"),
      };
      return {
        opera9: window.__BIPPY__.parseOpera(opera9Error as never),
        opera9Direct: window.__BIPPY__.parseOpera9(opera9Error as never),
        opera10: window.__BIPPY__.parseOpera10(opera10Error as never),
        opera11: window.__BIPPY__.parseOpera11(opera11Error as never),
      };
    });
    expect(result.opera9).toEqual(result.opera9Direct);
    expect(result.opera9[0]).toMatchObject({
      fileName: "http://localhost:3000/app.js",
      lineNumber: 42,
    });
    expect(result.opera10[0]).toMatchObject({
      functionName: "renderWidget",
      fileName: "http://localhost:3000/app.js",
      lineNumber: 42,
    });
    expect(result.opera11[0]).toMatchObject({
      functionName: "renderWidget",
      fileName: "http://localhost:3000/app.js",
      lineNumber: 42,
    });
  });

  test("extractLocation splits url, line, and column and tolerates paren-wrapped input", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      return {
        plain: window.__BIPPY__.extractLocation("http://localhost:3000/app.js:10:5"),
        wrapped: window.__BIPPY__.extractLocation("(http://localhost:3000/app.js:10:5)"),
        routeGroupParens: window.__BIPPY__.extractLocation(
          "http://localhost:3000/(docs)/page.js:3:9",
        ),
        noLocation: window.__BIPPY__.extractLocation("native"),
      };
    });
    expect(result.plain).toEqual(["http://localhost:3000/app.js", "10", "5"]);
    expect(result.wrapped).toEqual(["http://localhost:3000/app.js", "10", "5"]);
    expect(result.routeGroupParens).toEqual(["http://localhost:3000/(docs)/page.js", "3", "9"]);
    expect(result.noLocation).toEqual(["native", undefined, undefined]);
  });
});
