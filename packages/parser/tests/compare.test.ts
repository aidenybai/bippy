import { describe, expect, it } from "vite-plus/test";
import { comparePatternToRuntime } from "../src/harness/compare.js";
import type { RuntimeFiberSnapshot } from "../src/harness/snapshot.js";
import type { PatternFiber, PatternNode } from "../src/harness/static-pattern.js";

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

const host = (name: string, children: RuntimeFiberSnapshot[] = []): RuntimeFiberSnapshot =>
  runtimeFiber(name, children, "HostComponent");

const patternHost = (name: string, children: PatternFiber[] = []): PatternFiber =>
  patternFiber(name, children, "HostComponent");

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
});

const WRAPPERS = new Set(["Root", "ErrorBoundary"]);
const isWrapper = (fiber: RuntimeFiberSnapshot): boolean => WRAPPERS.has(fiber.name ?? fiber.tag);

describe("transparent runtime fibers", () => {
  it("splices framework wrappers the static tree does not render", () => {
    const runtime = [
      runtimeFiber("Root", [
        runtimeFiber("ErrorBoundary", [host("main", [host("h1")])]),
        host("footer"),
      ]),
    ];
    const report = comparePatternToRuntime(
      [patternHost("main", [patternHost("h1")]), patternHost("footer")],
      runtime,
      { isTransparentRuntimeFiber: isWrapper },
    );
    expect(report.status).toBe("exact");
    expect(report.transparentFibers).toBe(2);
    expect(report.runtimeFibers).toBe(3);
    expect(report.strictCoverage).toBe(1);
  });

  it("keeps an application fiber that shares a wrapper's name", () => {
    const runtime = [
      runtimeFiber("Root", [
        host("nav", [runtimeFiber("Root", [runtimeFiber("Dialog", [host("button")])])]),
      ]),
    ];
    const pattern = [
      patternHost("nav", [patternFiber("Root", [patternFiber("Dialog", [patternHost("button")])])]),
    ];
    const report = comparePatternToRuntime(pattern, runtime, {
      isTransparentRuntimeFiber: isWrapper,
    });
    expect(report.status).toBe("exact");
    expect(report.transparentFibers).toBe(1);
    expect(report.matchedFibers).toBe(4);
    expect(report.strictCoverage).toBe(1);
  });

  it("splices empty wrappers trailing the last application fiber", () => {
    const runtime = [
      host("main", [
        host("article"),
        runtimeFiber("ErrorBoundary", [runtimeFiber("Root")]),
        runtimeFiber("Root"),
      ]),
    ];
    const report = comparePatternToRuntime(
      [patternHost("main", [patternHost("article")])],
      runtime,
      {
        isTransparentRuntimeFiber: isWrapper,
      },
    );
    expect(report.status).toBe("exact");
    expect(report.transparentFibers).toBe(3);
    expect(report.runtimeFibers).toBe(2);
  });

  it("reports the divergence past a spliced wrapper", () => {
    const runtime = [runtimeFiber("Root", [host("main", [host("h2")])])];
    const report = comparePatternToRuntime([patternHost("main", [patternHost("h1")])], runtime, {
      isTransparentRuntimeFiber: isWrapper,
    });
    expect(report.status).toBe("mismatch");
    expect(report.divergence).toEqual({
      path: "root > <main> [HostComponent][0]",
      expected: "<h1> [HostComponent]",
      actual: "<h2> [HostComponent]",
    });
  });

  it("locates passed children behind wrappers inside an opaque subtree", () => {
    const runtime = [
      runtimeFiber("Provider", [
        runtimeFiber("ErrorBoundary", [runtimeFiber("Root", [host("section", [host("p")])])]),
      ]),
    ];
    const opaque: PatternNode = {
      kind: "opaque",
      name: "Provider",
      runtimeNames: ["Provider"],
      key: null,
      reason: "library",
      passedChildren: [patternHost("section", [patternHost("p")])],
    };
    const report = comparePatternToRuntime([opaque], runtime, {
      isTransparentRuntimeFiber: isWrapper,
    });
    expect(report.status).toBe("partial");
    expect(report.slotsMatched).toBe(1);
    expect(report.transparentFibers).toBe(2);
    expect(report.opaqueSkippedFibers).toBe(1);
    expect(report.coverage).toBe(1);
  });
});
