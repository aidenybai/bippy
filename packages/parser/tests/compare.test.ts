import { describe, expect, it } from "vite-plus/test";
import { comparePatternToRuntime } from "../src/harness/compare.js";
import type { RuntimeFiberSnapshot, SnapshotWorkTag } from "../src/harness/snapshot.js";
import type { PatternFiber, PatternNode, PatternOpaque } from "../src/harness/static-pattern.js";

const staticFiber = (name: string, children: PatternNode[] = []): PatternFiber => ({
  kind: "fiber",
  tag: "ClassComponent",
  name,
  key: null,
  children,
});

const opaqueFiber = (name: string, passedChildren: PatternNode[]): PatternOpaque => ({
  kind: "opaque",
  name,
  runtimeNames: [name],
  key: null,
  reason: `${name} is not analyzed`,
  passedChildren,
});

const runtimeFiber = (
  name: string,
  children: RuntimeFiberSnapshot[] = [],
  tag: SnapshotWorkTag = "ClassComponent",
): RuntimeFiberSnapshot => ({
  tag,
  name,
  key: null,
  text: null,
  props: {},
  children,
});

describe("comparePatternToRuntime", () => {
  it("accepts esbuild's dedupe counter on a component the bundler renamed", () => {
    const report = comparePatternToRuntime(
      [staticFiber("PersistGate", [staticFiber("Gate")])],
      [runtimeFiber("PersistGate2", [runtimeFiber("Gate")])],
    );
    expect(report.status).toBe("exact");
    expect(report.matchedFibers).toBe(2);
  });

  it("keeps a different component name a mismatch", () => {
    for (const runtimeName of ["PersistGate0", "PersistGateX", "PersistGat"]) {
      const report = comparePatternToRuntime(
        [staticFiber("PersistGate")],
        [runtimeFiber(runtimeName)],
      );
      expect(report.status).toBe("mismatch");
    }
  });

  it("places nested opaque children in the slot whose own slot matches, not the first component", () => {
    const report = comparePatternToRuntime(
      [opaqueFiber("MantineProvider", [opaqueFiber("ModalsProvider", [staticFiber("App")])])],
      [
        runtimeFiber("MantineProvider", [
          runtimeFiber("CssVariables", [runtimeFiber("style", [], "HostComponent")]),
          runtimeFiber("ModalsProvider", [
            runtimeFiber("Fragment", [runtimeFiber("App")], "Fragment"),
          ]),
        ]),
      ],
    );
    expect(report.status).toBe("partial");
    expect(report.matchedFibers).toBe(1);
    expect(report.slotsMatched).toBe(2);
    expect(report.slotsUnmatched).toBe(0);
    expect(report.opaqueRenamed).toBe(0);
  });

  it("prefers the slot explaining the most runtime fibers over one that hides them in an unmatched slot", () => {
    const report = comparePatternToRuntime(
      [
        opaqueFiber("MantineProvider", [
          opaqueFiber("ModalsProvider", [
            staticFiber("App", [opaqueFiber("Shell", [staticFiber("Page")])]),
          ]),
        ]),
      ],
      [
        runtimeFiber("MantineProvider", [
          runtimeFiber("CssVariables", [runtimeFiber("style", [], "HostComponent")]),
          runtimeFiber("ModalsProvider", [
            runtimeFiber("App", [
              runtimeFiber("Shell", [runtimeFiber("Sidebar", [], "FunctionComponent")]),
            ]),
          ]),
        ]),
      ],
    );
    expect(report.status).toBe("partial");
    expect(report.matchedFibers).toBe(1);
    expect(report.slotsMatched).toBe(2);
    expect(report.slotsUnmatched).toBe(1);
  });
});
