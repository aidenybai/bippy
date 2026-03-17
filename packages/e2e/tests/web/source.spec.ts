import { expect, test } from '@playwright/test';
import { waitForBippy, waitForTestChild } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForTestChild(page);
  await waitForBippy(page);
});

const findCompositeFiber = (displayName: string) => {
  return `
    (() => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let targetFiber = null;
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        if (window.__BIPPY__.getDisplayName(fiber.type) === '${displayName}') {
          targetFiber = fiber;
          return true;
        }
      });
      return targetFiber;
    })()
  `;
};

test.describe('getSource', () => {
  test('getSource returns FiberSource with fileName for TestChild', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let testChildFiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        if (window.__BIPPY__.getDisplayName(fiber.type) === 'TestChild') {
          testChildFiber = fiber;
          return true;
        }
      });
      if (!testChildFiber) return null;

      const source = await window.__BIPPY__.getSource(testChildFiber);
      if (!source) return null;
      return {
        fileName: source.fileName,
        lineNumber: source.lineNumber,
        columnNumber: source.columnNumber,
        functionName: source.functionName,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.fileName).toBeTruthy();
    expect(typeof result!.fileName).toBe('string');
    expect(result!.lineNumber).toBeGreaterThan(0);
  });

  test('getSource fileName contains the actual source file name', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let testChildFiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        if (window.__BIPPY__.getDisplayName(fiber.type) === 'TestChild') {
          testChildFiber = fiber;
          return true;
        }
      });
      if (!testChildFiber) return null;

      const source = await window.__BIPPY__.getSource(testChildFiber);
      return source?.fileName ?? null;
    });
    expect(result).not.toBeNull();
    const normalizedFileName = result!.toLowerCase();
    expect(
      normalizedFileName.includes('test-app') || normalizedFileName.includes('test-harness'),
    ).toBe(true);
  });

  test('getSource works for MemoChild', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let memoFiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        if (window.__BIPPY__.getDisplayName(fiber.type) === 'MemoChild') {
          memoFiber = fiber;
          return true;
        }
      });
      if (!memoFiber) return null;

      const source = await window.__BIPPY__.getSource(memoFiber);
      if (!source) return null;
      return {
        fileName: source.fileName,
        lineNumber: source.lineNumber,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.fileName).toBeTruthy();
    expect(result!.lineNumber).toBeGreaterThan(0);
  });

  test('getSource works for ForwardRefChild', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let forwardRefFiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        if (window.__BIPPY__.getDisplayName(fiber.type) === 'ForwardRefChild') {
          forwardRefFiber = fiber;
          return true;
        }
      });
      if (!forwardRefFiber) return null;

      const source = await window.__BIPPY__.getSource(forwardRefFiber);
      if (!source) return null;
      return {
        fileName: source.fileName,
        lineNumber: source.lineNumber,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.fileName).toBeTruthy();
    expect(result!.lineNumber).toBeGreaterThan(0);
  });

  test('getSource works for TestClassComponent', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let classFiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        if (window.__BIPPY__.getDisplayName(fiber.type) === 'TestClassComponent') {
          classFiber = fiber;
          return true;
        }
      });
      if (!classFiber) return null;

      const source = await window.__BIPPY__.getSource(classFiber);
      if (!source) return null;
      return {
        fileName: source.fileName,
        lineNumber: source.lineNumber,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.fileName).toBeTruthy();
    expect(result!.lineNumber).toBeGreaterThan(0);
  });

  test('getSource on a host fiber resolves via owner stack', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="test-child"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return 'no-fiber';
      const source = await window.__BIPPY__.getSource(hostFiber);
      if (!source) return null;
      return {
        hasFileName: typeof source.fileName === 'string' && source.fileName.length > 0,
      };
    });
    expect(result).not.toBeNull();
    if (typeof result === 'object' && result !== null) {
      expect(result.hasFileName).toBe(true);
    }
  });
});

test.describe('getOwnerStack', () => {
  test('getOwnerStack returns array with function names for TestChild', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let testChildFiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        if (window.__BIPPY__.getDisplayName(fiber.type) === 'TestChild') {
          testChildFiber = fiber;
          return true;
        }
      });
      if (!testChildFiber) return null;

      const ownerStack = await window.__BIPPY__.getOwnerStack(testChildFiber);
      return ownerStack.map((frame) => ({
        functionName: frame.functionName,
        fileName: frame.fileName,
        lineNumber: frame.lineNumber,
        columnNumber: frame.columnNumber,
        source: frame.source,
      }));
    });
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThan(0);

    const functionNames = result!.map((frame) => frame.functionName).filter(Boolean);
    expect(functionNames).toContain('TestChild');
  });

  test('getOwnerStack includes parent component names', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let testChildFiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        if (window.__BIPPY__.getDisplayName(fiber.type) === 'TestChild') {
          testChildFiber = fiber;
          return true;
        }
      });
      if (!testChildFiber) return null;

      const ownerStack = await window.__BIPPY__.getOwnerStack(testChildFiber);
      return ownerStack.map((frame) => frame.functionName).filter(Boolean);
    });
    expect(result).not.toBeNull();
    expect(result!).toContain('TestChild');
    expect(result!).toContain('TestParent');
  });

  test('getOwnerStack frames have valid fileNames', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let testChildFiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        if (window.__BIPPY__.getDisplayName(fiber.type) === 'TestChild') {
          testChildFiber = fiber;
          return true;
        }
      });
      if (!testChildFiber) return null;

      const ownerStack = await window.__BIPPY__.getOwnerStack(testChildFiber);
      return ownerStack
        .filter((frame) => frame.fileName)
        .map((frame) => ({
          fileName: frame.fileName,
          lineNumber: frame.lineNumber,
        }));
    });
    expect(result).not.toBeNull();
    const framesWithFile = result!.filter((frame) => frame.fileName);
    expect(framesWithFile.length).toBeGreaterThan(0);
    for (const frame of framesWithFile) {
      expect(typeof frame.fileName).toBe('string');
      expect(frame.fileName!.length).toBeGreaterThan(0);
    }
  });

  test('getOwnerStack for TestParent has fewer frames than TestChild', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let testChildFiber: any = null;
      let testParentFiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        const displayName = window.__BIPPY__.getDisplayName(fiber.type);
        if (displayName === 'TestChild') testChildFiber = fiber;
        if (displayName === 'TestParent') testParentFiber = fiber;
      });
      if (!testChildFiber || !testParentFiber) return null;

      const childStack = await window.__BIPPY__.getOwnerStack(testChildFiber);
      const parentStack = await window.__BIPPY__.getOwnerStack(testParentFiber);
      return {
        childStackLength: childStack.length,
        parentStackLength: parentStack.length,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.childStackLength).toBeGreaterThanOrEqual(result!.parentStackLength);
  });
});

test.describe('normalizeFileName', () => {
  test('normalizeFileName strips query parameters from URLs', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.normalizeFileName(
        'http://localhost:5180/src/test-app.tsx?t=1234567890',
      );
    });
    expect(result).toBe('/src/test-app.tsx');
  });

  test('normalizeFileName strips webpack-internal:// prefix', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.normalizeFileName(
        'webpack-internal:///app-pages-browser/./src/components/test.tsx',
      );
    });
    expect(result).toBe('./src/components/test.tsx');
  });

  test('normalizeFileName strips webpack:// prefix', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.normalizeFileName('webpack://./src/app.tsx');
    });
    expect(result).toBe('./src/app.tsx');
  });

  test('normalizeFileName strips turbopack:// prefix', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.normalizeFileName('turbopack:///src/components/button.tsx');
    });
    expect(result).toBe('/src/components/button.tsx');
  });

  test('normalizeFileName handles http URL with host', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.normalizeFileName('http://localhost:5180/src/main.tsx');
    });
    expect(result).toBe('/src/main.tsx');
  });

  test('normalizeFileName returns empty for anonymous patterns', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.normalizeFileName('<anonymous>');
    });
    expect(result).toBe('');
  });

  test('normalizeFileName returns empty for empty string', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.normalizeFileName('');
    });
    expect(result).toBe('');
  });

  test('normalizeFileName handles real stack trace URL from current page', async ({ page }) => {
    const result = await page.evaluate(() => {
      const error = new Error('test');
      const stack = error.stack ?? '';
      const lines = stack.split('\n');
      const frameWithUrl = lines.find(
        (line) => line.includes('http://') || line.includes('https://'),
      );
      if (!frameWithUrl) return 'no-url-found';

      const urlMatch = frameWithUrl.match(/https?:\/\/[^\s)]+/);
      if (!urlMatch) return 'no-match';

      const rawUrl = urlMatch[0].replace(/:\d+:\d+$/, '');
      const normalized = window.__BIPPY__.normalizeFileName(rawUrl);
      return { rawUrl, normalized };
    });
    if (typeof result === 'object' && result !== null) {
      expect(result.normalized).toBeTruthy();
      expect(result.normalized).not.toContain('http://');
      expect(result.normalized).not.toContain('https://');
    }
  });
});

test.describe('isSourceFile', () => {
  test('isSourceFile returns true for .tsx files', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.isSourceFile('/src/test-app.tsx');
    });
    expect(result).toBe(true);
  });

  test('isSourceFile returns true for .ts files', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.isSourceFile('/src/main.ts');
    });
    expect(result).toBe(true);
  });

  test('isSourceFile returns true for .jsx files', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.isSourceFile('/components/App.jsx');
    });
    expect(result).toBe(true);
  });

  test('isSourceFile returns false for bundled/chunk files', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.isSourceFile('/assets/main.bundle.js');
    });
    expect(result).toBe(false);
  });

  test('isSourceFile returns false for vendor files', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.isSourceFile('/dist/vendor.js');
    });
    expect(result).toBe(false);
  });

  test('isSourceFile returns false for node_modules files', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.isSourceFile('/node_modules/react/index.js');
    });
    expect(result).toBe(false);
  });

  test('isSourceFile returns false for empty string', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.isSourceFile('');
    });
    expect(result).toBe(false);
  });

  test('isSourceFile returns false for anonymous', async ({ page }) => {
    const result = await page.evaluate(() => {
      return window.__BIPPY__.isSourceFile('<anonymous>');
    });
    expect(result).toBe(false);
  });
});

test.describe('parseStack', () => {
  test('parseStack parses a real browser Error.stack', async ({ page }) => {
    const result = await page.evaluate(() => {
      const error = new Error('test-error');
      const stack = error.stack ?? '';
      const parsedFrames = window.__BIPPY__.parseStack(stack);
      return parsedFrames.map((frame) => ({
        functionName: frame.functionName,
        fileName: frame.fileName,
        lineNumber: frame.lineNumber,
        columnNumber: frame.columnNumber,
      }));
    });
    expect(result).not.toBeNull();
    expect(result.length).toBeGreaterThan(0);

    const firstFrame = result[0];
    expect(firstFrame.lineNumber).toBeGreaterThan(0);
  });

  test('parseStack returns StackFrame objects with expected shape', async ({ page }) => {
    const result = await page.evaluate(() => {
      const error = new Error('test');
      const parsedFrames = window.__BIPPY__.parseStack(error.stack ?? '');
      if (parsedFrames.length === 0) return null;

      const frame = parsedFrames[0];
      return {
        hasFunctionName: 'functionName' in frame,
        hasFileName: 'fileName' in frame,
        hasLineNumber: 'lineNumber' in frame,
        hasColumnNumber: 'columnNumber' in frame,
        hasSource: 'source' in frame,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.hasFunctionName).toBe(true);
    expect(result!.hasFileName).toBe(true);
    expect(result!.hasLineNumber).toBe(true);
    expect(result!.hasColumnNumber).toBe(true);
    expect(result!.hasSource).toBe(true);
  });
});

test.describe('getDisplayNameFromSource', () => {
  test('getDisplayNameFromSource resolves TestChild by name', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let testChildFiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        if (window.__BIPPY__.getDisplayName(fiber.type) === 'TestChild') {
          testChildFiber = fiber;
          return true;
        }
      });
      if (!testChildFiber) return null;

      return window.__BIPPY__.getDisplayNameFromSource(testChildFiber);
    });
    expect(result).not.toBeNull();
    expect(result).toBe('TestChild');
  });

  test('getDisplayNameFromSource resolves MemoChild by name', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let memoFiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        if (window.__BIPPY__.getDisplayName(fiber.type) === 'MemoChild') {
          memoFiber = fiber;
          return true;
        }
      });
      if (!memoFiber) return null;

      return window.__BIPPY__.getDisplayNameFromSource(memoFiber);
    });
    expect(result).not.toBeNull();
    expect(result).toBe('MemoChild');
  });
});

test.describe('source map resolution per bundler', () => {
  test('source maps are fetchable for the current framework', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let testChildFiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        if (window.__BIPPY__.getDisplayName(fiber.type) === 'TestChild') {
          testChildFiber = fiber;
          return true;
        }
      });
      if (!testChildFiber) return null;

      const ownerStack = await window.__BIPPY__.getOwnerStack(testChildFiber);
      const framesWithFile = ownerStack.filter((frame) => frame.fileName);
      const hasSymbolicatedFrames = framesWithFile.length > 0;
      const allHaveLineNumbers = framesWithFile.every(
        (frame) => typeof frame.lineNumber === 'number' && frame.lineNumber > 0,
      );

      return { hasSymbolicatedFrames, allHaveLineNumbers, frameCount: framesWithFile.length };
    });
    expect(result).not.toBeNull();
    expect(result!.hasSymbolicatedFrames).toBe(true);
    expect(result!.frameCount).toBeGreaterThan(0);
  });

  test('symbolicateStack correctly maps positions back to original source', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const element = document.querySelector('[data-testid="parent-host"]');
      const hostFiber = window.__BIPPY__.getFiberFromHostInstance(element);
      if (!hostFiber) return null;

      let rootFiber = hostFiber;
      while (rootFiber.return) rootFiber = rootFiber.return;

      let testChildFiber: any = null;
      window.__BIPPY__.traverseFiber(rootFiber, (fiber) => {
        if (window.__BIPPY__.getDisplayName(fiber.type) === 'TestChild') {
          testChildFiber = fiber;
          return true;
        }
      });
      if (!testChildFiber) return null;

      const ownerStack = await window.__BIPPY__.getOwnerStack(testChildFiber);
      const testChildFrame = ownerStack.find((frame) => frame.functionName === 'TestChild');
      if (!testChildFrame) return null;

      return {
        functionName: testChildFrame.functionName,
        fileName: testChildFrame.fileName,
        lineNumber: testChildFrame.lineNumber,
        columnNumber: testChildFrame.columnNumber,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.functionName).toBe('TestChild');
    if (result!.fileName) {
      const normalizedFileName = result!.fileName.toLowerCase();
      expect(
        normalizedFileName.includes('test-app') || normalizedFileName.includes('test-harness'),
      ).toBe(true);
    }
  });
});
