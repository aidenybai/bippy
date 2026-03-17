import { expect, test } from "@playwright/test";
import { waitForBippy, waitForTestChild } from "./helpers";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await waitForTestChild(page);
  await waitForBippy(page);
});

test.describe("getSource", () => {
  test("getSource returns fileName, lineNumber, columnNumber for TestChild", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let fiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (currentFiber) => {
        if (window.__BIPPY__.getDisplayName(currentFiber.type) === "TestChild") {
          fiber = currentFiber;
          return true;
        }
      });
      if (!fiber) return null;

      const source = await window.__BIPPY__.getSource(fiber);
      if (!source) return null;
      return {
        fileName: source.fileName,
        lineNumber: source.lineNumber,
        columnNumber: source.columnNumber,
        functionName: source.functionName,
      };
    });
    expect(result).not.toBeNull();
    expect(typeof result!.fileName).toBe("string");
    expect(result!.fileName.length).toBeGreaterThan(0);
    expect(typeof result!.lineNumber).toBe("number");
    expect(result!.lineNumber).toBeGreaterThan(0);
    expect(typeof result!.columnNumber).toBe("number");
    expect(result!.columnNumber).toBeGreaterThanOrEqual(0);
  });

  test("getSource fileName resolves to the actual source file", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let fiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (currentFiber) => {
        if (window.__BIPPY__.getDisplayName(currentFiber.type) === "TestChild") {
          fiber = currentFiber;
          return true;
        }
      });
      if (!fiber) return null;
      const source = await window.__BIPPY__.getSource(fiber);
      return source?.fileName ?? null;
    });
    expect(result).not.toBeNull();
    const lowerFileName = result!.toLowerCase();
    expect(lowerFileName.includes("test-app") || lowerFileName.includes("test-harness")).toBe(true);
  });

  test("getSource returns different lineNumbers for different components", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let childFiber: any = null;
      let memoFiber: any = null;
      let classFiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        const displayName = window.__BIPPY__.getDisplayName(fiber.type);
        if (displayName === "TestChild") childFiber = fiber;
        if (displayName === "MemoChild") memoFiber = fiber;
        if (displayName === "TestClassComponent") classFiber = fiber;
      });
      if (!childFiber || !memoFiber || !classFiber) return null;

      const [childSource, memoSource, classSource] = await Promise.all([
        window.__BIPPY__.getSource(childFiber),
        window.__BIPPY__.getSource(memoFiber),
        window.__BIPPY__.getSource(classFiber),
      ]);
      return {
        childLine: childSource?.lineNumber ?? null,
        memoLine: memoSource?.lineNumber ?? null,
        classLine: classSource?.lineNumber ?? null,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.childLine).toBeGreaterThan(0);
    expect(result!.memoLine).toBeGreaterThan(0);
    expect(result!.classLine).toBeGreaterThan(0);
    expect(result!.childLine).not.toBe(result!.memoLine);
    expect(result!.childLine).not.toBe(result!.classLine);
  });

  test("getSource for host fiber resolves via owner stack", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      const source = await window.__BIPPY__.getSource(hostFiber);
      if (!source) return null;
      return {
        fileName: source.fileName,
        lineNumber: source.lineNumber,
        functionName: source.functionName,
      };
    });
    expect(result).not.toBeNull();
    expect(typeof result!.fileName).toBe("string");
    expect(result!.fileName.length).toBeGreaterThan(0);
    expect(result!.lineNumber).toBeGreaterThan(0);
  });

  test("getSource caching returns same result on second call", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let fiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (currentFiber) => {
        if (window.__BIPPY__.getDisplayName(currentFiber.type) === "TestChild") {
          fiber = currentFiber;
          return true;
        }
      });
      if (!fiber) return null;

      const source1 = await window.__BIPPY__.getSource(fiber);
      const source2 = await window.__BIPPY__.getSource(fiber);
      if (!source1 || !source2) return null;
      return {
        sameFileName: source1.fileName === source2.fileName,
        sameLine: source1.lineNumber === source2.lineNumber,
        sameColumn: source1.columnNumber === source2.columnNumber,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.sameFileName).toBe(true);
    expect(result!.sameLine).toBe(true);
    expect(result!.sameColumn).toBe(true);
  });
});

test.describe("getOwnerStack", () => {
  test("getOwnerStack for TestChild: child frame before parent frame", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let fiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (currentFiber) => {
        if (window.__BIPPY__.getDisplayName(currentFiber.type) === "TestChild") {
          fiber = currentFiber;
          return true;
        }
      });
      if (!fiber) return null;

      const ownerStack = await window.__BIPPY__.getOwnerStack(fiber);
      return ownerStack.map((frame) => ({
        functionName: frame.functionName,
        fileName: frame.fileName,
        lineNumber: frame.lineNumber,
      }));
    });
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThanOrEqual(2);

    const functionNames = result!.map((frame) => frame.functionName).filter(Boolean);
    expect(functionNames).toContain("TestChild");
    expect(functionNames).toContain("TestParent");

    const testChildIndex = functionNames.indexOf("TestChild");
    const testParentIndex = functionNames.indexOf("TestParent");
    expect(testChildIndex).toBeLessThan(testParentIndex);
  });

  test("getOwnerStack frames have file names with valid line numbers", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let fiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (currentFiber) => {
        if (window.__BIPPY__.getDisplayName(currentFiber.type) === "TestChild") {
          fiber = currentFiber;
          return true;
        }
      });
      if (!fiber) return null;

      const ownerStack = await window.__BIPPY__.getOwnerStack(fiber);
      return ownerStack
        .filter((frame) => frame.fileName)
        .map((frame) => ({
          fileName: frame.fileName,
          normalizedFileName: window.__BIPPY__.normalizeFileName(frame.fileName!),
          lineNumber: frame.lineNumber,
          functionName: frame.functionName,
        }));
    });
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(0);
    for (const frame of result!) {
      expect(frame.lineNumber).toBeGreaterThan(0);
      expect(frame.normalizedFileName.length).toBeGreaterThan(0);
      expect(frame.normalizedFileName).not.toContain("http://");
      expect(frame.normalizedFileName).not.toContain("https://");
    }
  });

  test("getOwnerStack for TestParent is strictly shorter than for TestChild", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let childFiber: any = null;
      let parentFiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        const displayName = window.__BIPPY__.getDisplayName(fiber.type);
        if (displayName === "TestChild") childFiber = fiber;
        if (displayName === "TestParent") parentFiber = fiber;
      });
      if (!childFiber || !parentFiber) return null;

      const childStack = await window.__BIPPY__.getOwnerStack(childFiber);
      const parentStack = await window.__BIPPY__.getOwnerStack(parentFiber);
      return {
        childStackLength: childStack.length,
        parentStackLength: parentStack.length,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.childStackLength).toBeGreaterThan(result!.parentStackLength);
  });

  test("getOwnerStack for TestContextConsumer includes its ancestor", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let fiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (currentFiber) => {
        if (window.__BIPPY__.getDisplayName(currentFiber.type) === "TestContextConsumer") {
          fiber = currentFiber;
          return true;
        }
      });
      if (!fiber) return null;

      const ownerStack = await window.__BIPPY__.getOwnerStack(fiber);
      const functionNames = ownerStack.map((frame) => frame.functionName).filter(Boolean);
      return functionNames;
    });
    expect(result).not.toBeNull();
    expect(result).toContain("TestContextConsumer");
    expect(result).toContain("TestParent");
  });
});

test.describe("normalizeFileName", () => {
  test("normalizeFileName strips Vite query params", async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.normalizeFileName(
        "http://localhost:5180/src/test-app.tsx?t=1234567890",
      );
    });
    expect(result).toBe("/src/test-app.tsx");
  });

  test("normalizeFileName strips webpack-internal:// with app-pages-browser", async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.normalizeFileName(
        "webpack-internal:///app-pages-browser/./src/components/test.tsx",
      );
    });
    expect(result).toBe("./src/components/test.tsx");
  });

  test("normalizeFileName strips webpack-internal:// with (app-pages-browser)", async ({
    page,
  }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.normalizeFileName(
        "webpack-internal:///(app-pages-browser)/./src/app/Button.tsx",
      );
    });
    expect(result).toBe("./src/app/Button.tsx");
  });

  test("normalizeFileName strips webpack:// prefix", async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.normalizeFileName("webpack://./src/app.tsx");
    });
    expect(result).toBe("./src/app.tsx");
  });

  test("normalizeFileName strips turbopack:// prefix", async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.normalizeFileName("turbopack:///src/components/button.tsx");
    });
    expect(result).toBe("/src/components/button.tsx");
  });

  test("normalizeFileName strips rsc:// prefix", async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.normalizeFileName("rsc:///src/app/page.tsx");
    });
    expect(result).toBe("/src/app/page.tsx");
  });

  test("normalizeFileName strips http/https hosts", async ({ page }) => {
    const result = await page.evaluate(() => {
      return {
        http: window.__BIPPY__.normalizeFileName("http://localhost:5180/src/main.tsx"),
        https: window.__BIPPY__.normalizeFileName(
          "https://example.com:3000/src/components/app.tsx",
        ),
      };
    });
    expect(result.http).toBe("/src/main.tsx");
    expect(result.https).toBe("/src/components/app.tsx");
  });

  test("normalizeFileName returns empty for anonymous/eval/empty", async ({ page }) => {
    const result = await page.evaluate(() => {
      return {
        anonymous: window.__BIPPY__.normalizeFileName("<anonymous>"),
        eval_: window.__BIPPY__.normalizeFileName("eval"),
        empty: window.__BIPPY__.normalizeFileName(""),
      };
    });
    expect(result.anonymous).toBe("");
    expect(result.eval_).toBe("");
    expect(result.empty).toBe("");
  });

  test("normalizeFileName on real stack URL strips host", async ({ page }) => {
    const result = await page.evaluate(() => {
      const error = new Error("test");
      const stack = error.stack ?? "";
      const urlMatch = stack.match(/(https?:\/\/[^\s):]+)/);
      if (!urlMatch) return { skipped: true };

      const rawUrl = urlMatch[1];
      const normalized = window.__BIPPY__.normalizeFileName(rawUrl);
      return { skipped: false, rawUrl, normalized };
    });
    if ("skipped" in result && result.skipped) return;
    expect(result.normalized).not.toContain("http://");
    expect(result.normalized).not.toContain("https://");
    expect(result.normalized.length).toBeGreaterThan(0);
  });
});

test.describe("isSourceFile", () => {
  test("isSourceFile returns true for source extensions", async ({ page }) => {
    const result = await page.evaluate(() => ({
      tsx: window.__BIPPY__.isSourceFile("/src/test-app.tsx"),
      ts: window.__BIPPY__.isSourceFile("/src/main.ts"),
      jsx: window.__BIPPY__.isSourceFile("/components/App.jsx"),
      js: window.__BIPPY__.isSourceFile("/utils/helper.js"),
    }));
    expect(result.tsx).toBe(true);
    expect(result.ts).toBe(true);
    expect(result.jsx).toBe(true);
    expect(result.js).toBe(true);
  });

  test("isSourceFile returns false for bundled/framework patterns", async ({ page }) => {
    const result = await page.evaluate(() => ({
      bundle: window.__BIPPY__.isSourceFile("/assets/main.bundle.js"),
      vendor: window.__BIPPY__.isSourceFile("/dist/vendor.js"),
      chunk: window.__BIPPY__.isSourceFile("/static/chunk-abc123.js"),
      nodeModules: window.__BIPPY__.isSourceFile("/node_modules/react/index.js"),
      dotNext: window.__BIPPY__.isSourceFile("/.next/static/chunks/main.js"),
      dotVite: window.__BIPPY__.isSourceFile("/app.vite.chunk.js"),
      minified: window.__BIPPY__.isSourceFile("/dist/app.min.js"),
      empty: window.__BIPPY__.isSourceFile(""),
      anonymous: window.__BIPPY__.isSourceFile("<anonymous>"),
    }));
    expect(result.bundle).toBe(false);
    expect(result.vendor).toBe(false);
    expect(result.chunk).toBe(false);
    expect(result.nodeModules).toBe(false);
    expect(result.dotNext).toBe(false);
    expect(result.dotVite).toBe(false);
    expect(result.minified).toBe(false);
    expect(result.empty).toBe(false);
    expect(result.anonymous).toBe(false);
  });
});

test.describe("parseStack", () => {
  test("parseStack parses real Error.stack into valid StackFrames", async ({ page }) => {
    const result = await page.evaluate(() => {
      const error = new Error("test-error");
      const parsedFrames = window.__BIPPY__.parseStack(error.stack ?? "");
      return parsedFrames.map((frame) => ({
        functionName: frame.functionName,
        fileName: frame.fileName,
        lineNumber: frame.lineNumber,
        columnNumber: frame.columnNumber,
        source: frame.source,
      }));
    });
    expect(result.length).toBeGreaterThan(0);
    const framesWithFile = result.filter((frame) => frame.fileName);
    expect(framesWithFile.length).toBeGreaterThan(0);
    for (const frame of framesWithFile) {
      expect(typeof frame.lineNumber).toBe("number");
      expect(frame.lineNumber!).toBeGreaterThan(0);
      expect(typeof frame.fileName).toBe("string");
      expect(frame.fileName!.length).toBeGreaterThan(0);
      expect(typeof frame.source).toBe("string");
    }
  });

  test("parseStack returns empty array for empty string", async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.parseStack("");
    });
    expect(result).toEqual([]);
  });
});

test.describe("getDisplayNameFromSource", () => {
  test('getDisplayNameFromSource resolves exact name "TestChild"', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let fiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (currentFiber) => {
        if (window.__BIPPY__.getDisplayName(currentFiber.type) === "TestChild") {
          fiber = currentFiber;
          return true;
        }
      });
      if (!fiber) return null;
      return window.__BIPPY__.getDisplayNameFromSource(fiber);
    });
    expect(result).toBe("TestChild");
  });

  test('getDisplayNameFromSource resolves exact name "MemoChild"', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let fiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (currentFiber) => {
        if (window.__BIPPY__.getDisplayName(currentFiber.type) === "MemoChild") {
          fiber = currentFiber;
          return true;
        }
      });
      if (!fiber) return null;
      return window.__BIPPY__.getDisplayNameFromSource(fiber);
    });
    expect(result).toBe("MemoChild");
  });

  test('getDisplayNameFromSource resolves exact name "TestClassComponent"', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let fiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (currentFiber) => {
        if (window.__BIPPY__.getDisplayName(currentFiber.type) === "TestClassComponent") {
          fiber = currentFiber;
          return true;
        }
      });
      if (!fiber) return null;
      return window.__BIPPY__.getDisplayNameFromSource(fiber);
    });
    expect(result).toBe("TestClassComponent");
  });
});

test.describe("source map resolution", () => {
  test("owner stack frames are symbolicated with line and column numbers", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let fiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (currentFiber) => {
        if (window.__BIPPY__.getDisplayName(currentFiber.type) === "TestChild") {
          fiber = currentFiber;
          return true;
        }
      });
      if (!fiber) return null;

      const ownerStack = await window.__BIPPY__.getOwnerStack(fiber);
      const framesWithFile = ownerStack.filter((frame) => frame.fileName);
      return {
        frameCount: framesWithFile.length,
        allHaveLineNumbers: framesWithFile.every(
          (frame) => typeof frame.lineNumber === "number" && frame.lineNumber > 0,
        ),
        allHaveColumnNumbers: framesWithFile.every(
          (frame) => typeof frame.columnNumber === "number" && frame.columnNumber >= 0,
        ),
      };
    });
    expect(result).not.toBeNull();
    expect(result!.frameCount).toBeGreaterThan(0);
    expect(result!.allHaveLineNumbers).toBe(true);
    expect(result!.allHaveColumnNumbers).toBe(true);
  });

  test("symbolicateStack maps TestChild frame to its source file", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let fiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (currentFiber) => {
        if (window.__BIPPY__.getDisplayName(currentFiber.type) === "TestChild") {
          fiber = currentFiber;
          return true;
        }
      });
      if (!fiber) return null;

      const ownerStack = await window.__BIPPY__.getOwnerStack(fiber);
      const testChildFrame = ownerStack.find((frame) => frame.functionName === "TestChild");
      if (!testChildFrame) return null;

      const normalizedFileName = testChildFrame.fileName
        ? window.__BIPPY__.normalizeFileName(testChildFrame.fileName)
        : null;
      const isSource = normalizedFileName
        ? window.__BIPPY__.isSourceFile(normalizedFileName)
        : false;

      return {
        functionName: testChildFrame.functionName,
        fileName: testChildFrame.fileName,
        normalizedFileName,
        lineNumber: testChildFrame.lineNumber,
        isSource,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.functionName).toBe("TestChild");
    expect(result!.lineNumber).toBeGreaterThan(0);
    expect(result!.isSource).toBe(true);
    const lowerFileName = (result!.fileName ?? "").toLowerCase();
    expect(lowerFileName.includes("test-app") || lowerFileName.includes("test-harness")).toBe(true);
  });

  test("getSource and getOwnerStack agree on the same file for TestChild", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;
      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let fiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (currentFiber) => {
        if (window.__BIPPY__.getDisplayName(currentFiber.type) === "TestChild") {
          fiber = currentFiber;
          return true;
        }
      });
      if (!fiber) return null;

      const source = await window.__BIPPY__.getSource(fiber);
      const ownerStack = await window.__BIPPY__.getOwnerStack(fiber);
      const testChildFrame = ownerStack.find((frame) => frame.functionName === "TestChild");

      if (!source || !testChildFrame) return null;
      return {
        sourceFileName: source.fileName,
        ownerStackFileName: testChildFrame.fileName,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.sourceFileName).toBe(result!.ownerStackFileName);
  });
});
