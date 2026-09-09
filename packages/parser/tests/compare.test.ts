import { describe, expect, it } from "vite-plus/test";
import { comparePatternToRuntime } from "../src/harness/compare.js";
import type { RuntimeFiberSnapshot } from "../src/harness/snapshot.js";
import type { PatternFiber, PatternNode, PatternOpaque } from "../src/harness/static-pattern.js";

const runtimeFiber = (
  name: string,
  children: RuntimeFiberSnapshot[] = [],
  tag: RuntimeFiberSnapshot["tag"] = "FunctionComponent",
): RuntimeFiberSnapshot => ({ tag, name, key: null, text: null, props: {}, children });

const patternFiber = (
  name: string,
  children: PatternNode[] = [],
  tag: PatternFiber["tag"] = "FunctionComponent",
): PatternFiber => ({ kind: "fiber", tag, name, key: null, children });

const opaqueFiber = (name: string, passedChildren: PatternNode[]): PatternOpaque => ({
  kind: "opaque",
  name,
  runtimeNames: [name],
  key: null,
  reason: `${name} is not analyzed`,
  passedChildren,
});

describe("comparePatternToRuntime", () => {
  it("accepts a bundler-deconflicted `$N` suffix on the runtime name", () => {
    const report = comparePatternToRuntime(
      [patternFiber("Dialog", [patternFiber("Panel", [patternFiber("div", [], "HostComponent")])])],
      [
        runtimeFiber("Dialog$1", [
          runtimeFiber("Panel$12", [runtimeFiber("div", [], "HostComponent")]),
        ]),
      ],
    );
    expect(report.status).toBe("exact");
    expect(report.matchedFibers).toBe(3);
  });

  it("accepts esbuild's `Name2` counter on forwardRef and function names", () => {
    const pattern = patternFiber("App", [
      patternFiber("Dialog", [patternFiber("Modal", [], "ForwardRef")], "ForwardRef"),
      patternFiber("Insertion"),
    ]);
    const runtime = runtimeFiber("App", [
      runtimeFiber("Dialog2", [runtimeFiber("Modal$1", [], "ForwardRef")], "ForwardRef"),
      runtimeFiber("Insertion6"),
    ]);
    const report = comparePatternToRuntime([pattern], [runtime]);
    expect(report.status).toBe("exact");
    expect(report.matchedFibers).toBe(4);
  });

  it("accepts esbuild's `_Name` alias of a lowered class", () => {
    const report = comparePatternToRuntime(
      [patternFiber("ErrorBoundary", [], "ClassComponent")],
      [runtimeFiber("_ErrorBoundary", [], "ClassComponent")],
    );
    expect(report.status).toBe("exact");
  });

  it("accepts esbuild's dedupe counter on a component the bundler renamed", () => {
    const report = comparePatternToRuntime(
      [patternFiber("PersistGate", [patternFiber("Gate")])],
      [runtimeFiber("PersistGate2", [runtimeFiber("Gate")])],
    );
    expect(report.status).toBe("exact");
    expect(report.matchedFibers).toBe(2);
  });

  it("does not equate names that differ beyond a `$N` suffix", () => {
    const report = comparePatternToRuntime([patternFiber("Dialog")], [runtimeFiber("Dialog$1x")]);
    expect(report.status).toBe("mismatch");
  });

  it("keeps distinct names and host tags apart", () => {
    const divergences = [
      comparePatternToRuntime(
        [patternFiber("Dialog", [], "ForwardRef")],
        [runtimeFiber("DialogTitle", [], "ForwardRef")],
      ),
      comparePatternToRuntime(
        [patternFiber("h", [], "HostComponent")],
        [runtimeFiber("h1", [], "HostComponent")],
      ),
      comparePatternToRuntime(
        [patternFiber("Panel", [], "FunctionComponent")],
        [runtimeFiber("_Panel", [], "FunctionComponent")],
      ),
    ];
    expect(divergences.map((report) => report.status)).toEqual([
      "mismatch",
      "mismatch",
      "mismatch",
    ]);
  });

  it("keeps a different component name a mismatch", () => {
    for (const runtimeName of ["PersistGateX", "PersistGat"]) {
      const report = comparePatternToRuntime(
        [patternFiber("PersistGate")],
        [runtimeFiber(runtimeName)],
      );
      expect(report.status).toBe("mismatch");
    }
  });

  it("places nested opaque children in the slot whose own slot matches, not the first component", () => {
    const report = comparePatternToRuntime(
      [opaqueFiber("MantineProvider", [opaqueFiber("ModalsProvider", [patternFiber("App")])])],
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
            patternFiber("App", [opaqueFiber("Shell", [patternFiber("Page")])]),
          ]),
        ]),
      ],
      [
        runtimeFiber("MantineProvider", [
          runtimeFiber("CssVariables", [runtimeFiber("style", [], "HostComponent")]),
          runtimeFiber("ModalsProvider", [
            runtimeFiber("App", [runtimeFiber("Shell", [runtimeFiber("Sidebar")])]),
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
