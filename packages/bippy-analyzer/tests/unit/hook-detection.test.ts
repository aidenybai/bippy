import type { Node } from "typescript/unstable/ast";
import { isCallExpression } from "typescript/unstable/ast/is";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import {
  analyzeProject,
  isProjectSourceFile,
  withProject,
} from "../../src/core/entrypoint/analyze-project.js";
import type { HIRFunction } from "../../src/core/hir/hir.js";
import { BuiltInUseStateId } from "../../src/core/hir/object-shape.js";
import type { ProjectAnalysis } from "../../src/core/inference/types.js";
import { getReactExportName } from "../../src/core/typescript/nodes.js";
import {
  getBinding,
  getComponent,
  getFixtureConfig,
  getInstructions,
  lowerProject,
} from "./helpers.js";

const STATE_COMPONENTS = [
  "Direct",
  "Aliased",
  "Namespaced",
  "DefaultImported",
  "FromBarrel",
  "FromRenamedBarrel",
];

/**
 * The React export names the checker gives each call's callee, keyed by the callee's text.
 */
const getCalleeExportNames = (fixture: string): Map<string, Array<string | null>> =>
  withProject(getFixtureConfig(fixture), (project) => {
    const exportNames = new Map<string, Array<string | null>>();
    for (const fileName of project.program.getSourceFileNames().filter(isProjectSourceFile)) {
      const sourceFile = project.program.getSourceFile(fileName);
      if (!sourceFile) continue;
      const visit = (node: Node): void => {
        if (isCallExpression(node)) {
          const calleeText = node.expression.getText(sourceFile);
          exportNames.set(calleeText, [
            ...(exportNames.get(calleeText) ?? []),
            getReactExportName(project.checker, node.expression),
          ]);
        }
        node.forEachChild(visit);
      };
      sourceFile.forEachChild(visit);
    }
    return exportNames;
  });

const getHookCallResultShapes = (fn: HIRFunction): Array<string | null> =>
  getInstructions(fn).flatMap((instruction) =>
    instruction.value.kind === "CallExpression" || instruction.value.kind === "MethodCall"
      ? [
          instruction.lvalue.identifier.type.kind === "Object"
            ? instruction.lvalue.identifier.type.shapeId
            : null,
        ]
      : [],
  );

describe("getReactExportName", () => {
  let exportNames = new Map<string, Array<string | null>>();
  let plainExportNames = new Map<string, Array<string | null>>();

  beforeAll(() => {
    exportNames = getCalleeExportNames("hooks");
    plainExportNames = getCalleeExportNames("plain-jsx");
  });

  it("resolves direct, aliased, namespace, default and barrel imports to useState", () => {
    expect(exportNames.get("useState")).toEqual(["useState", "useState"]);
    expect(exportNames.get("useLocal")).toEqual(["useState"]);
    expect(exportNames.get("React.useState")).toEqual(["useState", "useState"]);
    expect(exportNames.get("useToggleState")).toEqual(["useState"]);
  });

  it("gives nothing for functions declared outside React", () => {
    expect(exportNames.get("useUser")).toEqual([null]);
    expect(exportNames.get("user")).toEqual([null]);
  });

  it("gives nothing when React's declarations can't be resolved", () => {
    expect(plainExportNames.get("useState")).toEqual([null]);
    expect(plainExportNames.get("React.useState")).toEqual([null]);
  });
});

describe("hook detection through the checker", () => {
  let project: ProjectAnalysis;
  let plainProject: ProjectAnalysis;
  let functions = new Map<string, HIRFunction>();

  beforeAll(() => {
    project = analyzeProject(getFixtureConfig("hooks"));
    plainProject = analyzeProject(getFixtureConfig("plain-jsx"));
    functions = lowerProject("hooks");
  });

  it.each(STATE_COMPONENTS)("binds useState in %s as state", (name) => {
    const component = getComponent(project, name);
    const isOpen = getBinding(component, "isOpen");
    expect(isOpen.kind).toBe("state");
    expect(isOpen.hookKind).toBe("useState");
    expect(component.analysis.transitions).toHaveLength(1);
    expect(component.report.states).toHaveLength(2);
  });

  it.each(STATE_COMPONENTS)("types the useState call in %s with the compiler's shape", (name) => {
    const fn = functions.get(name);
    expect(fn).toBeDefined();
    expect(fn && getHookCallResultShapes(fn)).toContain(BuiltInUseStateId);
  });

  it("treats a custom hook from another file as a custom hook", () => {
    const current = getBinding(getComponent(project, "Profile"), "current");
    expect(current.kind).toBe("hook");
    expect(current.hookKind).toBe("Custom");
  });

  it("treats a non-hook function named user as a plain call", () => {
    const component = getComponent(project, "Greeting");
    expect(component.analysis.bindings.map((binding) => binding.kind)).toEqual(["call"]);
    expect(component.analysis.bindings[0]?.hookKind).toBeNull();
  });

  it("falls back to the import name when react resolves to an untyped stub", () => {
    const toggle = getComponent(plainProject, "PlainToggle");
    expect(getBinding(toggle, "isOpen").kind).toBe("state");
    expect(toggle.report.states).toHaveLength(2);
    const namespaced = getComponent(plainProject, "PlainNamespaced");
    expect(getBinding(namespaced, "count").hookKind).toBe("useState");
  });
});
