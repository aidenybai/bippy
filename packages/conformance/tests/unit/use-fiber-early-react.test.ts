import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import {
  createBrowserBootstrapScript,
  createIsolatedReactRuntime,
  createReactImportScript,
  earlyReactVersionFixtures,
  type ReactBuildMode,
  type ReactVersionFixture,
  removeIsolatedReactRuntimes,
} from "./isolated-react-runtime.js";
import { runNodeScript } from "./run-node-script.js";

interface EarlyReactReport {
  reactVersion: string;
  observed: string[];
  rendered: string;
  wasBindRestored: boolean;
}

const buildModes: ReactBuildMode[] = ["development", "production"];
const oracleUrl = pathToFileURL(
  resolve(dirname(fileURLToPath(import.meta.url)), "use-fiber-oracle.ts"),
).href;

const createEarlyReactScript = (
  fixture: ReactVersionFixture,
  mode: ReactBuildMode,
  moduleFormat: "import" | "require",
): string => {
  const runtime = createIsolatedReactRuntime(fixture);
  return `
    ${createBrowserBootstrapScript()}
    ${createReactImportScript(runtime, fixture, mode, moduleFormat)}
    const { checkCallingFiber, createFiberRootRegistry, matchByProps } = await import(${JSON.stringify(oracleUrl)});
    const originalBind = Function.prototype.bind;
    const registry = createFiberRootRegistry();
    const container = document.createElement("div");
    document.body.appendChild(container);
    registry.addContainer(container);
    const observed = [];
    let update = () => {};
    const Probe = (props) => {
      const fiber = Bippy.useFiber();
      const mismatch = checkCallingFiber(registry, matchByProps(Probe, props), fiber, ${mode === "development"});
      observed.push(fiber === undefined ? "undefined" : mismatch === null ? "fiber" : "wrong-fiber");
      const [count, setCount] = React.useState(0);
      update = () => ReactDOM.flushSync(() => setCount((previousCount) => previousCount + 1));
      return React.createElement("i", null, props.revision + ":" + count);
    };
    for (const revision of [0, 1, 2]) {
      ReactDOM.render(React.createElement(Probe, { revision }), container);
    }
    update();
    update();
    const rendered = container.textContent;
    ReactDOM.unmountComponentAtNode(container);
    console.log("__REPORT__" + JSON.stringify({
      reactVersion: React.version,
      observed,
      rendered,
      wasBindRestored: Function.prototype.bind === originalBind,
    }));
    process.exit(0);
  `;
};

afterAll(removeIsolatedReactRuntimes);

const moduleFormats: Array<"import" | "require"> = ["import", "require"];

describe.each(earlyReactVersionFixtures)("React $label render-marker visibility", (fixture) => {
  describe.each(moduleFormats)("%s", (moduleFormat) => {
    it.each(buildModes)(
      "checks mount, prop updates, and state updates in %s",
      (mode) => {
        const result = runNodeScript(createEarlyReactScript(fixture, mode, moduleFormat), {
          environment: { NODE_ENV: mode },
          timeout: 15_000,
        });
        expect(result.status, result.stderr).toBe(0);
        const reportLine = result.stdout.split("\n").find((line) => line.startsWith("__REPORT__"));
        const report: EarlyReactReport = JSON.parse(reportLine?.slice("__REPORT__".length) ?? "{}");
        expect(report.reactVersion).toBe(fixture.label);
        expect(report.observed).toEqual(["fiber", "fiber", "fiber", "fiber", "fiber"]);
        expect(report.rendered).toBe("2:2");
        expect(report.wasBindRestored).toBe(true);
      },
      20_000,
    );
  });
});
