import { describe, expect, it } from "vite-plus/test";
import { comparePatternToRuntime } from "../src/harness/compare.js";
import type { RuntimeFiberSnapshot } from "../src/harness/snapshot.js";
import type { PatternFiber } from "../src/harness/static-pattern.js";

const runtimeFiber = (
  name: string,
  children: RuntimeFiberSnapshot[] = [],
  tag: RuntimeFiberSnapshot["tag"] = "FunctionComponent",
): RuntimeFiberSnapshot => ({ tag, name, key: null, text: null, props: {}, children });

const patternFiber = (
  name: string,
  children: PatternFiber[] = [],
  tag: PatternFiber["tag"] = "FunctionComponent",
): PatternFiber => ({ kind: "fiber", tag, name, key: null, children });

const runtimeClass = (name: string): RuntimeFiberSnapshot =>
  runtimeFiber(name, [], "ClassComponent");

const patternClass = (name: string): PatternFiber => patternFiber(name, [], "ClassComponent");

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
});
