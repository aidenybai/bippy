import { describe, expect, it } from "vite-plus/test";
import { comparePatternToRuntime } from "../src/harness/compare.js";
import type { RuntimeFiberSnapshot } from "../src/harness/snapshot.js";
import type {
  PatternBranch,
  PatternFiber,
  PatternNode,
  PatternOpaque,
  PatternWildcard,
} from "../src/harness/static-pattern.js";

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

const host = (name: string, children: RuntimeFiberSnapshot[] = []): RuntimeFiberSnapshot =>
  runtimeFiber(name, children, "HostComponent");

const patternHost = (name: string, children: PatternNode[] = []): PatternFiber =>
  patternFiber(name, children, "HostComponent");

const branch = (variable: string, ...alternatives: PatternNode[][]): PatternBranch => ({
  kind: "branch",
  variable,
  path: null,
  reason: variable,
  location: null,
  preferredIndex: 0,
  alternatives,
});

const opaqueFiber = (name: string, passedChildren: PatternNode[]): PatternOpaque => ({
  kind: "opaque",
  name,
  runtimeNames: [name],
  key: null,
  reason: `${name} is not analyzed`,
  passedChildren,
});

const patternBranch = (alternatives: PatternNode[][]): PatternBranch => ({
  kind: "branch",
  variable: "choice",
  path: null,
  reason: "unknown flag",
  location: null,
  preferredIndex: 0,
  alternatives,
});

const patternWildcard: PatternWildcard = {
  kind: "wildcard",
  reason: "unknown children",
  isTruncated: false,
};

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

  it("matches a wide list of decision-free siblings beside a decision without deep recursion", () => {
    const rows = Array.from({ length: 6000 }, () =>
      patternFiber("Row", [patternFiber("td", [], "HostComponent")]),
    );
    const runtimeRows = rows.map(() =>
      runtimeFiber("Row", [runtimeFiber("td", [], "HostComponent")]),
    );
    const report = comparePatternToRuntime(
      [patternFiber("Table", [patternBranch([[patternFiber("Header")], []]), ...rows])],
      [runtimeFiber("Table", runtimeRows)],
    );
    expect(report.status).toBe("exact");
    expect(report.matchedFibers).toBe(1 + rows.length * 2);
  });

  it("counts a slot's consumed fibers once when its passed children backtrack", () => {
    const report = comparePatternToRuntime(
      [opaqueFiber("Layout", [patternBranch([[patternWildcard], [patternFiber("Page")]])])],
      [runtimeFiber("Layout", [runtimeFiber("Page")])],
    );
    expect(report.status).toBe("partial");
    expect(report.matchedFibers).toBe(1);
    expect(report.wildcardAbsorbedFibers).toBe(0);
    expect(report.opaqueSkippedFibers).toBe(1);
    expect(report.coverage).toBe(1);
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

/**
 * Dependency pre-bundling renames a binding that collides in the merged chunk
 * (rolldown: `Ae` becomes `Ae$5`; esbuild: `TextareaAutosize` becomes
 * `TextareaAutosize2`); the static tree keeps the source name.
 */
describe("bundler-deduplicated component names", () => {
  it("matches a source name against its esbuild `<n>` suffixed runtime name", () => {
    const report = comparePatternToRuntime(
      [patternFiber("TextareaAutosize")],
      [runtimeFiber("TextareaAutosize2")],
    );
    expect(report.status).toBe("exact");
  });

  it("accepts a deduplicated runtime name for an opaque component", () => {
    const report = comparePatternToRuntime([opaqueFiber("Menu", [])], [runtimeFiber("Menu$2")]);
    expect(report.status).toBe("partial");
    expect(report.opaqueSubtrees).toBe(1);
  });

  it("keeps rejecting names that merely share a prefix", () => {
    for (const runtimeName of ["Ae$", "Ae$x", "AeX", "Ae2$1", "A"]) {
      const report = comparePatternToRuntime([patternFiber("Ae")], [runtimeFiber(runtimeName)]);
      expect(report.status, runtimeName).toBe("mismatch");
    }
  });
});

const WRAPPERS = new Set(["Root", "ErrorBoundary"]);
const unwrapWrapper = (fiber: RuntimeFiberSnapshot): RuntimeFiberSnapshot[] | null =>
  WRAPPERS.has(fiber.name ?? fiber.tag) ? fiber.children : null;

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
      { unwrapTransparentRuntimeFiber: unwrapWrapper },
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
      unwrapTransparentRuntimeFiber: unwrapWrapper,
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
        unwrapTransparentRuntimeFiber: unwrapWrapper,
      },
    );
    expect(report.status).toBe("exact");
    expect(report.transparentFibers).toBe(3);
    expect(report.runtimeFibers).toBe(2);
  });

  it("reports the divergence past a spliced wrapper", () => {
    const runtime = [runtimeFiber("Root", [host("main", [host("h2")])])];
    const report = comparePatternToRuntime([patternHost("main", [patternHost("h1")])], runtime, {
      unwrapTransparentRuntimeFiber: unwrapWrapper,
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
      unwrapTransparentRuntimeFiber: unwrapWrapper,
    });
    expect(report.status).toBe("partial");
    expect(report.slotsMatched).toBe(1);
    expect(report.transparentFibers).toBe(2);
    expect(report.opaqueSkippedFibers).toBe(1);
    expect(report.coverage).toBe(1);
  });

  it("matches thousands of rows that each decide for themselves without growing the stack", () => {
    const rowCount = 5000;
    const rows = Array.from({ length: rowCount }, (_, rowIndex) =>
      patternHost("tr", [
        patternFiber("Cell", [branch(`cell${rowIndex}`, [patternHost("b")], [patternHost("i")])]),
      ]),
    );
    const runtimeRows = Array.from({ length: rowCount }, (_, rowIndex) =>
      host("tr", [runtimeFiber("Cell", [host(rowIndex % 2 === 0 ? "b" : "i")])]),
    );
    const report = comparePatternToRuntime(
      [patternHost("table", rows)],
      [host("table", runtimeRows)],
    );
    expect(report.status).toBe("exact");
    expect(report.branchesResolved).toBe(rowCount);
    expect(report.matchedFibers).toBe(rowCount * 3 + 1);
  });

  it("still forces a variable shared across self-deciding rows to agree", () => {
    const row = (): PatternFiber =>
      patternHost("tr", [
        patternFiber("Cell", [branch("dense", [patternHost("b")], [patternHost("i")])]),
      ]);
    const pattern = patternHost("table", [row(), row()]);
    const agreeing = host("table", [
      host("tr", [runtimeFiber("Cell", [host("i")])]),
      host("tr", [runtimeFiber("Cell", [host("i")])]),
    ]);
    const disagreeing = host("table", [
      host("tr", [runtimeFiber("Cell", [host("b")])]),
      host("tr", [runtimeFiber("Cell", [host("i")])]),
    ]);
    expect(comparePatternToRuntime([pattern], [agreeing]).status).toBe("exact");
    expect(comparePatternToRuntime([pattern], [disagreeing]).status).toBe("mismatch");
  });
});
