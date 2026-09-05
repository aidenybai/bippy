import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { reactVersionFixtures } from "./regression-fixtures.js";
import type { ReactVersionFixture } from "./regression-fixtures.js";

interface RuntimeResult {
  status: number | null;
  stderr: string;
  stdout: string;
}

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bippyDirectory = resolve(packageDirectory, "../../../bippy");
const packageRequire = createRequire(import.meta.url);
const runtimeDirectories: string[] = [];
const copyPackage = (
  sourcePackageJsonPath: string,
  targetPackageName: string,
  runtimeNodeModules: string,
  copiedPackages: Set<string>,
): void => {
  if (copiedPackages.has(targetPackageName)) return;
  copiedPackages.add(targetPackageName);
  const targetDirectory = join(runtimeNodeModules, ...targetPackageName.split("/"));
  mkdirSync(dirname(targetDirectory), { recursive: true });
  cpSync(dirname(realpathSync(sourcePackageJsonPath)), targetDirectory, {
    dereference: true,
    recursive: true,
  });
  const packageJson = JSON.parse(readFileSync(sourcePackageJsonPath, "utf8"));
  const sourceRequire = createRequire(sourcePackageJsonPath);
  for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
    if (dependencyName === "react" && copiedPackages.has("react")) continue;
    copyPackage(
      sourceRequire.resolve(`${dependencyName}/package.json`),
      dependencyName,
      runtimeNodeModules,
      copiedPackages,
    );
  }
};

const createRuntime = (fixture: ReactVersionFixture) => {
  const directory = mkdtempSync(
    join(tmpdir(), `react-devtools-headless-${fixture.version.replace(".", "-")}-`),
  );
  runtimeDirectories.push(directory);
  const runtimeNodeModules = join(directory, "node_modules");
  mkdirSync(runtimeNodeModules, { recursive: true });
  const copiedPackages = new Set<string>();
  copyPackage(
    packageRequire.resolve(`${fixture.reactPackageName}/package.json`),
    "react",
    runtimeNodeModules,
    copiedPackages,
  );
  copyPackage(
    packageRequire.resolve(`${fixture.reactDOMPackageName}/package.json`),
    "react-dom",
    runtimeNodeModules,
    copiedPackages,
  );
  copyPackage(
    packageRequire.resolve("@jridgewell/sourcemap-codec/package.json"),
    "@jridgewell/sourcemap-codec",
    runtimeNodeModules,
    copiedPackages,
  );

  const runtimeBippyDirectory = join(runtimeNodeModules, "bippy");
  mkdirSync(runtimeBippyDirectory, { recursive: true });
  cpSync(resolve(bippyDirectory, "src"), join(runtimeBippyDirectory, "src"), { recursive: true });
  writeFileSync(
    join(runtimeBippyDirectory, "package.json"),
    JSON.stringify({
      exports: { ".": "./src/index.ts", "./source": "./src/source/index.ts" },
      name: "bippy",
      type: "module",
    }),
  );

  const runtimeHeadlessDirectory = join(runtimeNodeModules, "react-devtools-headless");
  mkdirSync(runtimeHeadlessDirectory, { recursive: true });
  cpSync(resolve(packageDirectory, "src"), join(runtimeHeadlessDirectory, "src"), {
    recursive: true,
  });
  writeFileSync(
    join(runtimeHeadlessDirectory, "package.json"),
    JSON.stringify({
      exports: { ".": "./src/index.ts" },
      name: "react-devtools-headless",
      type: "module",
    }),
  );

  return {
    directory,
    headlessUrl: pathToFileURL(join(runtimeHeadlessDirectory, "src/index.ts")).href,
    reactDOMClientUrl: pathToFileURL(join(runtimeNodeModules, "react-dom/client.js")).href,
    reactDOMTestUtilsUrl: pathToFileURL(join(runtimeNodeModules, "react-dom/test-utils.js")).href,
    reactDOMUrl: pathToFileURL(join(runtimeNodeModules, "react-dom/index.js")).href,
    reactUrl: pathToFileURL(join(runtimeNodeModules, "react/index.js")).href,
  };
};

const runFixture = (fixture: ReactVersionFixture): RuntimeResult => {
  const runtime = createRuntime(fixture);
  const script = `
    import assert from "node:assert/strict";
    import { Window } from "happy-dom";

    const browserWindow = new Window({ url: "http://localhost" });
    globalThis.window = browserWindow;
    globalThis.document = browserWindow.document;
    globalThis.Node = browserWindow.Node;
    globalThis.HTMLElement = browserWindow.HTMLElement;
    globalThis.requestAnimationFrame = browserWindow.requestAnimationFrame.bind(browserWindow);
    globalThis.cancelAnimationFrame = browserWindow.cancelAnimationFrame.bind(browserWindow);
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;

    const { createTools, installFacade } = await import(${JSON.stringify(runtime.headlessUrl)});
    const ReactModule = await import(${JSON.stringify(runtime.reactUrl)});
    const React = ReactModule.default ?? ReactModule;
    const ReactDOMModule = await import(${JSON.stringify(runtime.reactDOMUrl)});
    const ReactDOM = ReactDOMModule.default ?? ReactDOMModule;
    const ReactDOMClientModule = await import(${JSON.stringify(runtime.reactDOMClientUrl)}).catch(() => null);
    const ReactDOMClient = ReactDOMClientModule?.default ?? ReactDOMClientModule;
    const TestUtilsModule = await import(${JSON.stringify(runtime.reactDOMTestUtilsUrl)});
    const actImplementation = TestUtilsModule.act;
    const act = async (callback) => {
      if (typeof actImplementation === "function") await actImplementation(callback);
      else callback();
    };
    const facade = installFacade();
    const tools = createTools(facade);
    const container = document.createElement("div");
    document.body.append(container);
    let appInstance = null;

    const ListItem = ({ label }) => React.createElement("li", null, label);
    const Context = ${fixture.supportsHooks} ? React.createContext("context-value") : null;
    const HookProbe = () => {
      React.useState("hook-state");
      React.useEffect(() => undefined);
      React.useLayoutEffect(() => undefined);
      return null;
    };
    const ContextProbe = () => {
      React.useContext(Context);
      return null;
    };
    class App extends React.Component {
      constructor(props) {
        super(props);
        this.state = { items: ["one", "two", "three"] };
        appInstance = this;
      }
      render() {
        return React.createElement(
          "div",
          null,
          React.createElement(
            "ul",
            null,
            this.state.items.map((item) =>
              React.createElement(ListItem, { key: item, label: item }),
            ),
          ),
          ${fixture.supportsHooks} ? React.createElement(HookProbe) : null,
          ${fixture.supportsHooks} ? React.createElement(ContextProbe) : null,
        );
      }
    }

    let root = null;
    const renderApp = () => {
      const element = React.createElement(App);
      if (${fixture.major} < 18) ReactDOM.render(element, container);
      else {
        root ??= ReactDOMClient.createRoot(container);
        root.render(element);
      }
    };
    const setItems = (items) => appInstance.setState({ items });

    await act(renderApp);
    const tree = tools.getComponentTree();
    assert.ok(Array.isArray(tree));
    assert.equal(tree.filter((node) => node.name === "ListItem").length, 3);
    const firstItem = tree.find((node) => node.name === "ListItem");
    const firstItemInfo = tools.getComponentByUid(firstItem.uid);
    assert.deepEqual(firstItemInfo.props, { label: "one" });

    if (${fixture.supportsHooks}) {
      const hookProbe = tree.find((node) => node.name === "HookProbe");
      assert.match(JSON.stringify(tools.getComponentByUid(hookProbe.uid, true).hooks), /State/);
      const contextProbe = tree.find((node) => node.name === "ContextProbe");
      assert.match(JSON.stringify(tools.getComponentByUid(contextProbe.uid, true).hooks), /Context/);
      const source = tools.getComponentSource(firstItem.uid);
      assert.ok(!("error" in source));
    }

    if (${fixture.supportsProfiler}) {
      assert.deepEqual(tools.startProfiling("regression"), {
        status: "started",
        traceName: "regression",
      });
    }
    await act(() => setItems(["one", "two", "three", "four"]));
    await act(() => setItems(["one", "two", "three", "four", "five"]));
    assert.equal(tools.findComponents("ListItem").totalCount, 5);
    if (${fixture.supportsProfiler}) {
      assert.equal(tools.stopProfiling().commits, 2);
      for (const [commitIndex, expectedCount] of [4, 5].entries()) {
        const report = tools.getCommitReport("regression", commitIndex);
        assert.equal(
          report.components.filter((component) => component.name === "ListItem").length,
          expectedCount,
        );
        assert.ok(report.layoutDuration === null || report.layoutDuration >= 0);
        assert.ok(report.passiveDuration === null || report.passiveDuration >= 0);
      }
    }

    if (${fixture.supportsEditing}) {
      const updatedItem = tools.findComponents("ListItem").results[0];
      await act(() => {
        assert.deepEqual(tools.overrideProps(updatedItem.uid, ["label"], "edited"), {
          success: true,
        });
      });
      assert.equal(container.querySelector("li").textContent, "edited");
    }

    await act(() => {
      if (${fixture.major} < 18) ReactDOM.unmountComponentAtNode(container);
      else root.unmount();
    });
    facade.dispose();
    console.log(JSON.stringify({ success: true, version: ${JSON.stringify(fixture.version)} }));
    process.exit(0);
  `;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    { cwd: packageDirectory, encoding: "utf8", timeout: 30_000 },
  );
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
};

afterAll(() => {
  for (const runtimeDirectory of runtimeDirectories) {
    rmSync(runtimeDirectory, { force: true, recursive: true });
  }
});

describe("React DevTools regression version matrix", () => {
  it.each(reactVersionFixtures)("supports React $version", (fixture) => {
    const result = runFixture(fixture);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({ success: true, version: fixture.version });
  });
});
