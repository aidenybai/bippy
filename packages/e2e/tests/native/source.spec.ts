// the detox jest environment injects its own global `expect` for element
// assertions, so jest's must be imported explicitly for plain values
import { expect } from "@jest/globals";
import { by, element, waitFor } from "detox";

import { launchFixtureApp, readElementText } from "./helpers";

describe("bippy source functions on React Native (Metro)", () => {
  beforeAll(async () => {
    await launchFixtureApp(false);
    // the fixture renders a result-source-done sentinel row once the async
    // source results (source map fetches) have all settled
    await waitFor(element(by.id("result-source-done")))
      .toExist()
      .withTimeout(240_000);
  });

  describe("getSource", () => {
    it("returns a fileName for TestChild fiber", async () => {
      const fileName = await readElementText("result-source-fileName");
      expect(fileName).not.toBe("null");
      expect(fileName).not.toBe("error");
      expect(fileName.length).toBeGreaterThan(0);
    });

    it("returns a positive lineNumber for TestChild fiber", async () => {
      const lineNumber = await readElementText("result-source-lineNumber");
      expect(lineNumber).not.toBe("null");
      expect(lineNumber).not.toBe("error");
      expect(parseInt(lineNumber, 10)).toBeGreaterThan(0);
    });

    it("returns a columnNumber for TestChild fiber", async () => {
      const columnNumber = await readElementText("result-source-columnNumber");
      expect(columnNumber).not.toBe("null");
      expect(columnNumber).not.toBe("error");
    });
  });

  describe("getOwnerStack", () => {
    it("returns a non-empty owner stack", async () => {
      const ownerStackLength = await readElementText("result-ownerStack-length");
      expect(ownerStackLength).not.toBe("error");
      expect(parseInt(ownerStackLength, 10)).toBeGreaterThan(0);
    });

    it("owner stack contains TestChild function name", async () => {
      const ownerStackNames = await readElementText("result-ownerStack-names");
      expect(ownerStackNames).not.toBe("error");
      expect(ownerStackNames).toContain("TestChild");
    });

    it("owner stack contains TestParent function name", async () => {
      const ownerStackNames = await readElementText("result-ownerStack-names");
      expect(ownerStackNames).not.toBe("error");
      expect(ownerStackNames).toContain("TestParent");
    });
  });

  describe("getDisplayNameFromSource", () => {
    it("returns a non-null display name", async () => {
      const displayName = await readElementText("result-displayNameFromSource");
      expect(displayName).not.toBe("null");
      expect(displayName).not.toBe("error");
      expect(displayName.length).toBeGreaterThan(0);
    });
  });

  describe("parent source resolution", () => {
    it("getSource returns a fileName for TestParent", async () => {
      const fileName = await readElementText("result-parentSource-fileName");
      expect(fileName).not.toBe("error");
    });

    it("getOwnerStack returns frames for TestParent", async () => {
      const ownerStackLength = await readElementText("result-parentOwnerStack-length");
      expect(ownerStackLength).not.toBe("error");
      expect(parseInt(ownerStackLength, 10)).toBeGreaterThan(0);
    });
  });
});
