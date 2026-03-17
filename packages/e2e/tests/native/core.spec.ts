import { by, device, element, expect } from "detox";

describe("bippy core functions on React Native", () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true });
  });

  beforeEach(async () => {
    await device.reloadReactNative();
    await waitFor(element(by.id("results-container")))
      .toBeVisible()
      .withTimeout(15_000);
  });

  describe("instrumentation", () => {
    it("isInstrumentationActive returns true", async () => {
      await expect(element(by.id("result-instrument-active"))).toHaveText("true");
    });
  });

  describe("type guards", () => {
    it("isFiber returns true for a valid fiber", async () => {
      await expect(element(by.id("result-isFiber"))).toHaveText("true");
    });

    it("isFiber returns false for null", async () => {
      await expect(element(by.id("result-isFiber-null"))).toHaveText("false");
    });

    it("isFiber returns false for plain object", async () => {
      await expect(element(by.id("result-isFiber-object"))).toHaveText("false");
    });

    it("isValidFiber returns true for a live fiber", async () => {
      await expect(element(by.id("result-isValidFiber"))).toHaveText("true");
    });

    it("isHostFiber returns true for host fiber", async () => {
      await expect(element(by.id("result-isHostFiber-host"))).toHaveText("true");
    });

    it("isHostFiber returns false for composite fiber", async () => {
      await expect(element(by.id("result-isHostFiber-composite"))).toHaveText("false");
    });

    it("isCompositeFiber returns true for composite fiber", async () => {
      await expect(element(by.id("result-isCompositeFiber"))).toHaveText("true");
    });
  });

  describe("display name", () => {
    it("getDisplayName returns TestChild for TestChild fiber", async () => {
      await expect(element(by.id("result-displayName-TestChild"))).toHaveText("TestChild");
    });

    it("getDisplayName returns TestParent for TestParent fiber", async () => {
      await expect(element(by.id("result-displayName-TestParent"))).toHaveText("TestParent");
    });
  });

  describe("render detection", () => {
    it("didFiberRender returns true for rendered fiber", async () => {
      await expect(element(by.id("result-didFiberRender"))).toHaveText("true");
    });
  });

  describe("timings", () => {
    it("selfTime is a non-negative number", async () => {
      const attributes = await element(by.id("result-selfTime")).getAttributes();
      const selfTime = parseFloat((attributes as any).text);
      expect(selfTime).toBeGreaterThanOrEqual(0);
    });

    it("totalTime is a non-negative number", async () => {
      const attributes = await element(by.id("result-totalTime")).getAttributes();
      const totalTime = parseFloat((attributes as any).text);
      expect(totalTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe("fiber stack", () => {
    it("getFiberStack returns a non-empty stack", async () => {
      const attributes = await element(by.id("result-fiberStack-length")).getAttributes();
      const stackLength = parseInt((attributes as any).text, 10);
      expect(stackLength).toBeGreaterThan(1);
    });
  });

  describe("host fiber lookup", () => {
    it("getNearestHostFiber returns a non-null fiber", async () => {
      await expect(element(by.id("result-nearestHostFiber"))).toHaveText("true");
    });

    it("getNearestHostFibers returns multiple host fibers", async () => {
      const attributes = await element(by.id("result-nearestHostFibers-count")).getAttributes();
      const count = parseInt((attributes as any).text, 10);
      expect(count).toBeGreaterThan(1);
    });
  });

  describe("fiber identity", () => {
    it("getLatestFiber returns a valid fiber", async () => {
      await expect(element(by.id("result-getLatestFiber"))).toHaveText("true");
    });

    it("getFiberId returns a number", async () => {
      await expect(element(by.id("result-getFiberId"))).toHaveText("true");
    });
  });

  describe("traversal", () => {
    it("traverseFiber visits multiple fibers", async () => {
      const attributes = await element(by.id("result-traverseFiber-count")).getAttributes();
      const count = parseInt((attributes as any).text, 10);
      expect(count).toBeGreaterThan(5);
    });

    it("traverseProps finds expected prop keys", async () => {
      const attributes = await element(by.id("result-traverseProps-keys")).getAttributes();
      const keys = (attributes as any).text;
      expect(keys).toContain("name");
      expect(keys).toContain("count");
    });
  });

  describe("memo cache", () => {
    it("hasMemoCache returns false for normal components", async () => {
      await expect(element(by.id("result-hasMemoCache"))).toHaveText("false");
    });
  });

  describe("type unwrapping", () => {
    it("getType returns a non-null value for component fiber", async () => {
      await expect(element(by.id("result-getType"))).toHaveText("true");
    });
  });
});
