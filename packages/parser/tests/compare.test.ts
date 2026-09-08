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

const runtimeClass = (name: string): RuntimeFiberSnapshot =>
  runtimeFiber(name, [], "ClassComponent");

const patternClass = (name: string): PatternFiber => patternFiber(name, [], "ClassComponent");

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

  it("matches a class whose bundler lowered its name to a placeholder", () => {
    for (const placeholder of ["_a", "_a2", "_class", "_class1"]) {
      const report = comparePatternToRuntime([patternClass("App")], [runtimeClass(placeholder)]);
      expect(report.status, placeholder).toBe("exact");
    }
  });

  it("matches a component the bundler renamed with a dedupe suffix", () => {
    for (const renamed of ["SnackbarProvider2", "SnackbarProvider$1"]) {
      const report = comparePatternToRuntime(
        [patternClass("SnackbarProvider")],
        [runtimeClass(renamed)],
      );
      expect(report.status, renamed).toBe("exact");
    }
    expect(
      comparePatternToRuntime([patternClass("Snackbar")], [runtimeClass("SnackbarProvider")])
        .status,
    ).toBe("mismatch");
  });

  it("matches a wrapper display name whose wrapped component the bundler renamed", () => {
    for (const renamed of ["SideEffect(NullComponent2)", "SideEffect(NullComponent$1)"]) {
      const report = comparePatternToRuntime(
        [patternClass("SideEffect(NullComponent)")],
        [runtimeClass(renamed)],
      );
      expect(report.status, renamed).toBe("exact");
    }
    for (const other of [
      "SideEffect(Other)",
      "Effect(NullComponent2)",
      "SideEffect2(NullComponent)",
    ]) {
      expect(
        comparePatternToRuntime([patternClass("SideEffect(NullComponent)")], [runtimeClass(other)])
          .status,
        other,
      ).toBe("mismatch");
    }
  });

  it("keeps disagreeing class names a mismatch", () => {
    const report = comparePatternToRuntime([patternClass("App")], [runtimeClass("Shell")]);
    expect(report.status).toBe("mismatch");
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
