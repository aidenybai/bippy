import { describe, expect, it } from "vite-plus/test";
import { formatSymbolicValue } from "../../src/core/format";
import { analyzeFixture, getComponent } from "./helpers";

describe("ref snapshots", () => {
  const project = analyzeFixture("conformance-repros", "ref-snapshots");

  const getUpdates = (name: string) =>
    getComponent(project, name).analysis.handlers.flatMap((handler) =>
      handler.updates.map((update) => [
        formatSymbolicValue(update.value),
        update.guards.map(formatSymbolicValue),
      ]),
    );

  it("compares a ref read after an await with the value stored before it", () => {
    expect(getUpdates("RefSnapshot")).toEqual([
      ['"stale"', ["Unknown(async) !== request.current + 1"]],
      ['"saved"', ["!(Unknown(async) !== request.current + 1)"]],
    ]);
  });

  it("gives a property store expression the stored value", () => {
    expect(getUpdates("IncrementedId")).toEqual([
      ['"saved"', ["!(Unknown(async) !== request.current + 1)"]],
    ]);
  });

  it("reads a ref stored after an await as the stored value", () => {
    expect(getUpdates("StoreAfterAwait")).toEqual([['"saved"', ["true"]]]);
  });

  it.fails("compares a ref read after an opaque call with the value read before it", () => {
    expect(getUpdates("SyncSnapshot")).not.toEqual([
      ['count.current === count.current ? "same" : "changed"', []],
    ]);
  });
});
