import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { getFilesRecursively } from "./file-inventory.js";

interface ExpectedUpstreamTestFile {
  count: number;
  path: string;
}

interface UpstreamDisabledPort {
  localPath: string;
  localTitle: string;
  upstreamPath: string;
  upstreamTitle: string;
}

interface UpstreamDefinition {
  disabled: boolean;
  path: string;
  title: string;
}

interface UpstreamManifestDefinition {
  disabled: boolean;
  title: string;
}

interface UpstreamManifestTestFile {
  definitions: UpstreamManifestDefinition[];
  path: string;
}

interface UpstreamManifest {
  committedAt: string;
  repository: string;
  requestedRef: string;
  revision: string;
  schemaVersion: number;
  testFiles: UpstreamManifestTestFile[];
}

const expectedTestFiles: ExpectedUpstreamTestFile[] = [
  {
    count: 5,
    path: "packages/react-debug-tools/src/__tests__/ReactDevToolsHooksIntegration-test.js",
  },
  { count: 11, path: "packages/react-debug-tools/src/__tests__/ReactHooksInspection-test.js" },
  {
    count: 25,
    path: "packages/react-debug-tools/src/__tests__/ReactHooksInspectionIntegration-test.js",
  },
  {
    count: 1,
    path: "packages/react-debug-tools/src/__tests__/ReactHooksInspectionIntegrationDOM-test.js",
  },
  {
    count: 22,
    path: "packages/react-devtools-cdt-mcp/src/__tests__/DevToolsCdtMcp-test.js",
  },
  {
    count: 2,
    path: "packages/react-devtools-extensions/src/__tests__/ignoreList-test.js",
  },
  {
    count: 108,
    path: "packages/react-devtools-facade/src/__tests__/DevToolsFacade-test.js",
  },
  {
    count: 7,
    path: "packages/react-devtools-inline/__tests__/__e2e__/components.test.js",
  },
  {
    count: 2,
    path: "packages/react-devtools-inline/__tests__/__e2e__/profiler.test.js",
  },
  { count: 1, path: "packages/react-devtools-shared/src/__tests__/backend-test.js" },
  { count: 4, path: "packages/react-devtools-shared/src/__tests__/bridge-test.js" },
  {
    count: 2,
    path: "packages/react-devtools-shared/src/__tests__/compiler-integration-test.js",
  },
  {
    count: 3,
    path: "packages/react-devtools-shared/src/__tests__/componentStacks-test.js",
  },
  { count: 19, path: "packages/react-devtools-shared/src/__tests__/console-test.js" },
  { count: 21, path: "packages/react-devtools-shared/src/__tests__/editing-test.js" },
  {
    count: 4,
    path: "packages/react-devtools-shared/src/__tests__/errorReporting-test.js",
  },
  { count: 8, path: "packages/react-devtools-shared/src/__tests__/events-test.js" },
  {
    count: 8,
    path: "packages/react-devtools-shared/src/__tests__/extractHOCNames-test.js",
  },
  {
    count: 3,
    path: "packages/react-devtools-shared/src/__tests__/FastRefreshDevToolsIntegration-test.js",
  },
  { count: 2, path: "packages/react-devtools-shared/src/__tests__/gate-test.js" },
  {
    count: 53,
    path: "packages/react-devtools-shared/src/__tests__/inspectedElement-test.js",
  },
  {
    count: 12,
    path: "packages/react-devtools-shared/src/__tests__/legacy/editing-test.js",
  },
  {
    count: 13,
    path: "packages/react-devtools-shared/src/__tests__/legacy/inspectElement-test.js",
  },
  {
    count: 13,
    path: "packages/react-devtools-shared/src/__tests__/legacy/storeLegacy-v15-test.js",
  },
  {
    count: 2,
    path: "packages/react-devtools-shared/src/__tests__/optimisticKeyDevToolsIntegration.js",
  },
  {
    count: 4,
    path: "packages/react-devtools-shared/src/__tests__/ownersListContext-test.js",
  },
  {
    count: 1,
    path: "packages/react-devtools-shared/src/__tests__/profilerChangeDescriptions-test.js",
  },
  {
    count: 14,
    path: "packages/react-devtools-shared/src/__tests__/profilerContext-test.js",
  },
  {
    count: 7,
    path: "packages/react-devtools-shared/src/__tests__/profilerStore-test.js",
  },
  {
    count: 16,
    path: "packages/react-devtools-shared/src/__tests__/profilingCache-test.js",
  },
  {
    count: 5,
    path: "packages/react-devtools-shared/src/__tests__/profilingCharts-test.js",
  },
  {
    count: 4,
    path: "packages/react-devtools-shared/src/__tests__/profilingCommitTreeBuilder-test.js",
  },
  {
    count: 3,
    path: "packages/react-devtools-shared/src/__tests__/profilingHostRoot-test.js",
  },
  {
    count: 1,
    path: "packages/react-devtools-shared/src/__tests__/profilingUtils-test.js",
  },
  { count: 79, path: "packages/react-devtools-shared/src/__tests__/store-test.js" },
  {
    count: 15,
    path: "packages/react-devtools-shared/src/__tests__/storeComponentFilters-test.js",
  },
  {
    count: 1,
    path: "packages/react-devtools-shared/src/__tests__/storeForceError-test.js",
  },
  {
    count: 4,
    path: "packages/react-devtools-shared/src/__tests__/storeOwners-test.js",
  },
  {
    count: 4,
    path: "packages/react-devtools-shared/src/__tests__/storeStressSync-test.js",
  },
  {
    count: 4,
    path: "packages/react-devtools-shared/src/__tests__/storeStressTestConcurrent-test.js",
  },
  { count: 5, path: "packages/react-devtools-shared/src/__tests__/traceUpdates-test.js" },
  {
    count: 16,
    path: "packages/react-devtools-shared/src/__tests__/transform-react-version-pragma-test.js",
  },
  {
    count: 37,
    path: "packages/react-devtools-shared/src/__tests__/treeContext-test.js",
  },
  {
    count: 5,
    path: "packages/react-devtools-shared/src/__tests__/useEditableValue-test.js",
  },
  { count: 55, path: "packages/react-devtools-shared/src/__tests__/utils-test.js" },
  {
    count: 6,
    path: "packages/react-devtools-shared/src/backend/StyleX/__tests__/utils-test.js",
  },
  {
    count: 4,
    path: "packages/react-devtools-shared/src/hooks/__tests__/generateHookMap-test.js",
  },
  {
    count: 4,
    path: "packages/react-devtools-shared/src/hooks/__tests__/getHookNameForLocation-test.js",
  },
  {
    count: 27,
    path: "packages/react-devtools-shared/src/hooks/__tests__/parseHookNames-test.js",
  },
  {
    count: 3,
    path: "packages/react/src/__tests__/ReactProfilerDevToolsIntegration-test.internal.js",
  },
];

const expectedDisabledTestFiles: ExpectedUpstreamTestFile[] = [
  { count: 1, path: "packages/react-devtools-shared/src/__tests__/componentStacks-test.js" },
  { count: 6, path: "packages/react-devtools-shared/src/__tests__/inspectedElement-test.js" },
  { count: 1, path: "packages/react-devtools-shared/src/__tests__/storeComponentFilters-test.js" },
  { count: 2, path: "packages/react-devtools-shared/src/hooks/__tests__/parseHookNames-test.js" },
];
const disabledTestPorts: UpstreamDisabledPort[] = [
  {
    localPath: "legacy-react.test.tsx",
    localTitle:
      "should disable the current dispatcher before shallow rendering so no effects get scheduled",
    upstreamPath: "packages/react-devtools-shared/src/__tests__/componentStacks-test.js",
    upstreamTitle:
      "should disable the current dispatcher before shallow rendering so no effects get scheduled",
  },
  {
    localPath: "legacy-react.test.tsx",
    localTitle: "should inspect the currently selected element (legacy render)",
    upstreamPath: "packages/react-devtools-shared/src/__tests__/inspectedElement-test.js",
    upstreamTitle: "should inspect the currently selected element (legacy render)",
  },
  {
    localPath: "legacy-react.test.tsx",
    localTitle: "should inspect hooks for components that only use context (legacy render)",
    upstreamPath: "packages/react-devtools-shared/src/__tests__/inspectedElement-test.js",
    upstreamTitle: "should inspect hooks for components that only use context (legacy render)",
  },
  {
    localPath: "legacy-react.test.tsx",
    localTitle:
      "should not error when an unchanged component is re-inspected after component filters changed (legacy render)",
    upstreamPath: "packages/react-devtools-shared/src/__tests__/inspectedElement-test.js",
    upstreamTitle:
      "should not error when an unchanged component is re-inspected after component filters changed (legacy render)",
  },
  {
    localPath: "legacy-react.test.tsx",
    localTitle: "should display the root type for ReactDOM.hydrate",
    upstreamPath: "packages/react-devtools-shared/src/__tests__/inspectedElement-test.js",
    upstreamTitle: "should display the root type for ReactDOM.hydrate",
  },
  {
    localPath: "legacy-react.test.tsx",
    localTitle: "should display the root type for ReactDOM.render",
    upstreamPath: "packages/react-devtools-shared/src/__tests__/inspectedElement-test.js",
    upstreamTitle: "should display the root type for ReactDOM.render",
  },
  {
    localPath: "legacy-react.test.tsx",
    localTitle: "inspecting nested renderers should not throw (legacy render)",
    upstreamPath: "packages/react-devtools-shared/src/__tests__/inspectedElement-test.js",
    upstreamTitle: "inspecting nested renderers should not throw (legacy render)",
  },
  {
    localPath: "component-store-filters.test.ts",
    localTitle: "should filter by path",
    upstreamPath: "packages/react-devtools-shared/src/__tests__/storeComponentFilters-test.js",
    upstreamTitle: "should filter by path",
  },
  {
    localPath: "hook-source-fixtures.test.ts",
    localTitle: "should work for inline requires",
    upstreamPath: "packages/react-devtools-shared/src/hooks/__tests__/parseHookNames-test.js",
    upstreamTitle: "should work for inline requires",
  },
  {
    localPath: "hook-source-fixtures.test.ts",
    localTitle: "should work for inline requires",
    upstreamPath: "packages/react-devtools-shared/src/hooks/__tests__/parseHookNames-test.js",
    upstreamTitle: "should work for inline requires",
  },
];
const testDefinitionPattern = /^\s*(?:it|test)(?:\.(?:skip|only))?\s*\(\s*(["'`])([^\n]*?)\1/gm;
const localDisabledTestInvocationPattern = /^\s*(?:describe|it|test)\.(?:skip|todo)\s*\(/gm;
const localTestDirectory = dirname(fileURLToPath(import.meta.url));
const upstreamManifest: UpstreamManifest = JSON.parse(
  readFileSync(join(localTestDirectory, "../upstream.json"), "utf8"),
);

const getDefinitionTitles = (path: string): string[] =>
  [...readFileSync(path, "utf8").matchAll(testDefinitionPattern)].map((match) =>
    match[2].replaceAll('\\"', '"').replaceAll("\\'", "'"),
  );

const sortTestFiles = (testFiles: ExpectedUpstreamTestFile[]): ExpectedUpstreamTestFile[] =>
  [...testFiles].sort((left, right) => left.path.localeCompare(right.path));

const upstreamDefinitions: UpstreamDefinition[] = upstreamManifest.testFiles.flatMap((testFile) =>
  testFile.definitions.map((definition) => ({ ...definition, path: testFile.path })),
);
const recordedTestFiles: ExpectedUpstreamTestFile[] = upstreamManifest.testFiles.map(
  (testFile) => ({ count: testFile.definitions.length, path: testFile.path }),
);
const getDefinitionKey = (path: string, title: string): string => `${path}\0${title}`;

describe("upstream executable test inventory", () => {
  it("pins the React DevTools source revision", () => {
    expect(upstreamManifest.schemaVersion).toBe(2);
    expect(upstreamManifest.repository).toBe("https://github.com/facebook/react.git");
    expect(upstreamManifest.revision).toMatch(/^[a-f\d]{40}$/);
  });

  it("accounts for every file that registers a test", () => {
    expect(sortTestFiles(recordedTestFiles)).toEqual(sortTestFiles(expectedTestFiles));
  });

  it("tracks all 675 upstream test definitions", () => {
    expect(expectedTestFiles.reduce((total, testFile) => total + testFile.count, 0)).toBe(675);
    expect(upstreamDefinitions).toHaveLength(675);
  });

  it("has one executable static TypeScript port for every upstream definition", () => {
    const localTitleCounts = new Map<string, number>();
    for (const path of getFilesRecursively(localTestDirectory)) {
      if (!path.endsWith(".ts") && !path.endsWith(".tsx")) continue;
      for (const title of getDefinitionTitles(path)) {
        localTitleCounts.set(title, (localTitleCounts.get(title) ?? 0) + 1);
      }
    }
    const missingDefinitions = upstreamDefinitions.filter((definition) => {
      const count = localTitleCounts.get(definition.title) ?? 0;
      if (count === 0) return true;
      localTitleCounts.set(definition.title, count - 1);
      return false;
    });
    const upstreamTitles = new Set(upstreamDefinitions.map((definition) => definition.title));
    const duplicatePorts = [...localTitleCounts]
      .filter(([title, count]) => count > 0 && upstreamTitles.has(title))
      .map(([title, count]) => ({ count, title }));
    expect(missingDefinitions).toEqual([]);
    expect(duplicatePorts).toEqual([]);
  });

  it("ports all ten definitions disabled by upstream", () => {
    const disabledDefinitions = upstreamDefinitions.filter((definition) => definition.disabled);
    const disabledCounts = new Map<string, number>();
    for (const definition of disabledDefinitions) {
      const key = getDefinitionKey(definition.path, definition.title);
      disabledCounts.set(key, (disabledCounts.get(key) ?? 0) + 1);
    }
    const disabledTestFiles = recordedTestFiles.flatMap((testFile) => {
      const count = disabledDefinitions.filter(
        (definition) => definition.path === testFile.path,
      ).length;
      return count > 0 ? [{ count, path: testFile.path }] : [];
    });
    expect(disabledTestFiles).toEqual(expectedDisabledTestFiles);
    expect(disabledTestPorts).toHaveLength(10);
    for (const port of disabledTestPorts) {
      const key = getDefinitionKey(port.upstreamPath, port.upstreamTitle);
      const count = disabledCounts.get(key) ?? 0;
      expect(count, port.upstreamPath).toBeGreaterThan(0);
      disabledCounts.set(key, count - 1);
      expect(
        readFileSync(join(localTestDirectory, port.localPath), "utf8"),
        port.localPath,
      ).toContain(`it("${port.localTitle}"`);
    }
    expect([...disabledCounts.values()].every((count) => count === 0)).toBe(true);
  });

  it("keeps every local test port executable", () => {
    const disabledLocalTests = getFilesRecursively(localTestDirectory).flatMap((path) =>
      path.endsWith(".ts") || path.endsWith(".tsx")
        ? [...readFileSync(path, "utf8").matchAll(localDisabledTestInvocationPattern)].map(() =>
            relative(localTestDirectory, path),
          )
        : [],
    );
    expect(disabledLocalTests).toEqual([]);
  });
});
