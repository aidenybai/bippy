// the detox jest environment injects its own global `expect` for element
// assertions, so jest's must be imported explicitly for plain values
import { expect } from "@jest/globals";
import { by, element, expect as detoxExpect, waitFor } from "detox";

import { launchFixtureApp, readElementText } from "./helpers";

const ASYNC_RESULT_TIMEOUT_MS = 30_000;

describe("bippy core functions on React Native", () => {
  beforeAll(async () => {
    // the fixture renders a result-core-done sentinel row after all core
    // results are computed, so every row below it is already stable
    await launchFixtureApp(true, "result-core-done");
  });

  describe("environment", () => {
    it("isInstrumentationActive returns true", async () => {
      await detoxExpect(element(by.id("result-instrument-active"))).toHaveText("true");
    });

    it("isClientEnvironment returns true", async () => {
      await detoxExpect(element(by.id("result-isClientEnvironment"))).toHaveText("true");
    });

    it("hasRDTHook returns true", async () => {
      await detoxExpect(element(by.id("result-hasRDTHook"))).toHaveText("true");
    });

    it("getRDTHook stores the injected renderer", async () => {
      const rendererCount = parseInt(await readElementText("result-rdtHook-renderers-count"), 10);
      expect(rendererCount).toBeGreaterThanOrEqual(1);
    });

    it("detectReactBuildType reports development for the dev bundle", async () => {
      await detoxExpect(element(by.id("result-detectReactBuildType"))).toHaveText("development");
    });

    it("isRealReactDevtools returns false for bippy's own hook", async () => {
      await detoxExpect(element(by.id("result-isRealReactDevtools"))).toHaveText("false");
    });

    it("isReactRefresh resolves to a boolean on hermes", async () => {
      const isReactRefreshResult = await readElementText("result-isReactRefresh");
      expect(["true", "false"]).toContain(isReactRefreshResult);
    });

    it("version identifies the bippy build", async () => {
      await detoxExpect(element(by.id("result-version-is-string"))).toHaveText("true");
    });
  });

  describe("secure", () => {
    it("secured handlers fire on the development renderer", async () => {
      // the secure probe instruments during the core-tests commit, so its
      // handler first fires on the follow-up commit that renders the results
      await waitFor(element(by.id("result-secure-commit-fired")))
        .toExist()
        .withTimeout(ASYNC_RESULT_TIMEOUT_MS);
      await detoxExpect(element(by.id("result-secure-commit-fired"))).toHaveText("true");
    });
  });

  describe("overrides", () => {
    it("overrideProps rewrites a prop and the native view re-renders", async () => {
      await waitFor(element(by.text("e2e-test 123")))
        .toExist()
        .withTimeout(ASYNC_RESULT_TIMEOUT_MS);
    });
  });

  describe("type guards", () => {
    it("isFiber returns true for a valid fiber", async () => {
      await detoxExpect(element(by.id("result-isFiber"))).toHaveText("true");
    });

    it("isFiber returns false for null", async () => {
      await detoxExpect(element(by.id("result-isFiber-null"))).toHaveText("false");
    });

    it("isFiber returns false for plain object", async () => {
      await detoxExpect(element(by.id("result-isFiber-object"))).toHaveText("false");
    });

    it("isValidFiber returns true for a live fiber", async () => {
      await detoxExpect(element(by.id("result-isValidFiber"))).toHaveText("true");
    });

    it("isHostFiber returns true for host fiber", async () => {
      await detoxExpect(element(by.id("result-isHostFiber-host"))).toHaveText("true");
    });

    it("isHostFiber returns false for composite fiber", async () => {
      await detoxExpect(element(by.id("result-isHostFiber-composite"))).toHaveText("false");
    });

    it("isCompositeFiber returns true for composite fiber", async () => {
      await detoxExpect(element(by.id("result-isCompositeFiber"))).toHaveText("true");
    });

    it("isValidElement returns true for a JSX element", async () => {
      await detoxExpect(element(by.id("result-isValidElement-element"))).toHaveText("true");
    });

    it("isValidElement returns false for a plain object", async () => {
      await detoxExpect(element(by.id("result-isValidElement-object"))).toHaveText("false");
    });
  });

  describe("display name", () => {
    it("getDisplayName returns TestChild for TestChild fiber", async () => {
      await detoxExpect(element(by.id("result-displayName-TestChild"))).toHaveText("TestChild");
    });

    it("getDisplayName returns TestParent for TestParent fiber", async () => {
      await detoxExpect(element(by.id("result-displayName-TestParent"))).toHaveText("TestParent");
    });
  });

  describe("render detection", () => {
    it("didFiberRender returns true for rendered fiber", async () => {
      await detoxExpect(element(by.id("result-didFiberRender"))).toHaveText("true");
    });
  });

  describe("timings", () => {
    it("selfTime is a non-negative number", async () => {
      const selfTime = parseFloat(await readElementText("result-selfTime"));
      expect(selfTime).toBeGreaterThanOrEqual(0);
    });

    it("totalTime is a non-negative number", async () => {
      const totalTime = parseFloat(await readElementText("result-totalTime"));
      expect(totalTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe("fiber stack", () => {
    it("getFiberStack returns a non-empty stack", async () => {
      const stackLength = parseInt(await readElementText("result-fiberStack-length"), 10);
      expect(stackLength).toBeGreaterThan(1);
    });
  });

  describe("host fiber lookup", () => {
    it("getNearestHostFiber returns a non-null fiber", async () => {
      await detoxExpect(element(by.id("result-nearestHostFiber"))).toHaveText("true");
    });

    it("getNearestHostFibers returns multiple host fibers", async () => {
      const hostFiberCount = parseInt(await readElementText("result-nearestHostFibers-count"), 10);
      expect(hostFiberCount).toBeGreaterThan(1);
    });

    it("getFiberFromHostInstance resolves a fiber from a native view ref", async () => {
      await detoxExpect(element(by.id("result-getFiberFromHostInstance"))).toHaveText("true");
    });
  });

  describe("fiber identity", () => {
    it("getLatestFiber returns a valid fiber", async () => {
      await detoxExpect(element(by.id("result-getLatestFiber"))).toHaveText("true");
    });

    it("getFiberId returns a number", async () => {
      await detoxExpect(element(by.id("result-getFiberId"))).toHaveText("true");
    });
  });

  describe("traversal", () => {
    it("traverseFiber visits multiple fibers", async () => {
      const visitedFiberCount = parseInt(await readElementText("result-traverseFiber-count"), 10);
      expect(visitedFiberCount).toBeGreaterThan(5);
    });

    it("traverseProps finds expected prop keys", async () => {
      const propKeys = await readElementText("result-traverseProps-keys");
      expect(propKeys).toContain("name");
      expect(propKeys).toContain("count");
    });

    it("traverseContexts reads the provided context value", async () => {
      await detoxExpect(element(by.id("result-traverseContexts-value"))).toHaveText(
        "provided-value",
      );
    });

    it("traverseRenderedFibers visits fibers from the last commit", async () => {
      const renderedFiberCount = parseInt(
        await readElementText("result-traverseRenderedFibers-count"),
        10,
      );
      expect(renderedFiberCount).toBeGreaterThan(0);
    });
  });

  describe("fiber filtering", () => {
    it("shouldFilterFiber keeps host component fibers", async () => {
      await detoxExpect(element(by.id("result-shouldFilterFiber-tag-is-host"))).toHaveText("true");
      await detoxExpect(element(by.id("result-shouldFilterFiber-host"))).toHaveText("false");
    });

    it("shouldFilterFiber keeps composite fibers", async () => {
      await detoxExpect(element(by.id("result-shouldFilterFiber-composite"))).toHaveText("false");
    });
  });

  describe("memo cache", () => {
    it("hasMemoCache returns false for normal components", async () => {
      await detoxExpect(element(by.id("result-hasMemoCache"))).toHaveText("false");
    });
  });

  describe("type unwrapping", () => {
    it("getType returns a non-null value for component fiber", async () => {
      await detoxExpect(element(by.id("result-getType"))).toHaveText("true");
    });
  });
});
