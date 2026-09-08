import { describe, expect, it } from "vite-plus/test";
import { comparePatternToRuntime } from "../src/harness/compare.js";
import type { RuntimeFiberSnapshot } from "../src/harness/snapshot.js";
import type { PatternNode } from "../src/harness/static-pattern.js";

const runtimeClass = (name: string): RuntimeFiberSnapshot => ({
  tag: "ClassComponent",
  name,
  key: null,
  text: null,
  props: {},
  children: [],
});

const staticClass = (name: string): PatternNode => ({
  kind: "fiber",
  tag: "ClassComponent",
  name,
  key: null,
  children: [],
});

describe("comparePatternToRuntime", () => {
  it("matches a class whose bundler lowered its name to a placeholder", () => {
    for (const placeholder of ["_a", "_a2", "_class", "_class1"]) {
      const report = comparePatternToRuntime([staticClass("App")], [runtimeClass(placeholder)]);
      expect(report.status, placeholder).toBe("exact");
    }
  });

  it("matches a component the bundler renamed with a dedupe suffix", () => {
    for (const renamed of ["SnackbarProvider2", "SnackbarProvider$1"]) {
      const report = comparePatternToRuntime(
        [staticClass("SnackbarProvider")],
        [runtimeClass(renamed)],
      );
      expect(report.status, renamed).toBe("exact");
    }
    expect(
      comparePatternToRuntime([staticClass("Snackbar")], [runtimeClass("SnackbarProvider")]).status,
    ).toBe("mismatch");
  });

  it("matches a wrapper display name whose wrapped component the bundler renamed", () => {
    for (const renamed of ["SideEffect(NullComponent2)", "SideEffect(NullComponent$1)"]) {
      const report = comparePatternToRuntime(
        [staticClass("SideEffect(NullComponent)")],
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
        comparePatternToRuntime([staticClass("SideEffect(NullComponent)")], [runtimeClass(other)])
          .status,
        other,
      ).toBe("mismatch");
    }
  });

  it("keeps disagreeing class names a mismatch", () => {
    const report = comparePatternToRuntime([staticClass("App")], [runtimeClass("Shell")]);
    expect(report.status).toBe("mismatch");
  });
});
