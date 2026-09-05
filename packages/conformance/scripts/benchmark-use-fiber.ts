import assert from "node:assert/strict";
import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createBrowserBootstrapScript,
  createIsolatedReactRuntime,
  earlyReactVersionFixtures,
  reactVersionFixtures,
  removeIsolatedReactRuntimes,
} from "../tests/unit/isolated-react-runtime.js";
import { runNodeScript } from "../tests/unit/run-node-script.js";

interface BenchmarkSample {
  enabled: boolean;
  mountMs: number;
  updateMs: number;
  mountCaptureMicroseconds: number;
  updateCaptureMicroseconds: number;
}

const getMedian = (values: number[]): number => {
  const sorted = values.toSorted((first, second) => first - second);
  return Number(sorted[Math.floor(sorted.length / 2)].toFixed(3));
};

const fixtures = [...earlyReactVersionFixtures, ...reactVersionFixtures].filter(({ label }) =>
  ["16.8.6", "16.14", "18", "19"].includes(label),
);
const configurations = [
  { components: 100, precedingHooks: 0 },
  { components: 1000, precedingHooks: 0 },
  { components: 1000, precedingHooks: 32 },
];
const builtDirectory = fileURLToPath(new URL("../../bippy/dist/", import.meta.url));

console.log(
  `Production ESM; ${process.version}; median of 5 samples after warm-up; 5 updates per sample`,
);
try {
  for (const fixture of fixtures) {
    const runtime = createIsolatedReactRuntime(fixture);
    const builtEntry = new URL("../dist/index.js", runtime.bippyEntryUrl);
    cpSync(builtDirectory, fileURLToPath(new URL("./", builtEntry)), { recursive: true });
    for (const configuration of configurations) {
      const result = runNodeScript(
        `
        import assert from "node:assert/strict";
        ${createBrowserBootstrapScript()}
        const Bippy = await import(${JSON.stringify(builtEntry.href)});
        const React = (await import(${JSON.stringify(runtime.reactUrl)})).default;
        const ReactDOM = (await import(${JSON.stringify(runtime.reactDOMUrl)})).default;
        const ReactDOMClient = ${fixture.major >= 18 ? `(await import(${JSON.stringify(runtime.reactDOMClientUrl)})).default` : "null"};
        const samples = [];
        for (let trial = 0; trial < 6; trial++) {
          for (const enabled of trial % 2 === 0 ? [false, true] : [true, false]) {
            let captureTime = 0;
            let missingFibers = 0;
            const Probe = () => {
              for (let hookIndex = 0; hookIndex < ${configuration.precedingHooks}; hookIndex++) React.useRef(null);
              const captureStart = performance.now();
              const fiber = enabled ? Bippy.useFiber() : null;
              captureTime += performance.now() - captureStart;
              if (enabled && !fiber) missingFibers++;
              return null;
            };
            const container = document.createElement("div");
            document.body.appendChild(container);
            const root = ReactDOMClient?.createRoot(container);
            const render = (revision) => {
              const elements = Array.from({ length: ${configuration.components} }, (_, index) =>
                React.createElement(Probe, { key: index, revision }));
              ReactDOM.flushSync(() => {
                if (root) root.render(elements);
                else ReactDOM.render(elements, container);
              });
            };
            const mountStart = performance.now();
            render(0);
            const mountMs = performance.now() - mountStart;
            const mountCaptureMicroseconds = captureTime * 1000 / ${configuration.components};
            captureTime = 0;
            const updateStart = performance.now();
            for (let revision = 1; revision <= 5; revision++) render(revision);
            const updateMs = (performance.now() - updateStart) / 5;
            const updateCaptureMicroseconds = captureTime * 1000 / (5 * ${configuration.components});
            ReactDOM.flushSync(() => {
              if (root) root.unmount();
              else ReactDOM.unmountComponentAtNode(container);
            });
            container.remove();
            assert.equal(missingFibers, 0);
            if (trial > 0) samples.push({ enabled, mountMs, updateMs, mountCaptureMicroseconds, updateCaptureMicroseconds });
          }
        }
        console.log("__REPORT__" + JSON.stringify(samples));
        process.exit(0);
      `,
        { environment: { NODE_ENV: "production" }, timeout: 120000 },
      );
      assert.equal(result.status, 0, result.stderr);
      const reportLine = result.stdout.split("\n").find((line) => line.startsWith("__REPORT__"));
      assert.ok(reportLine);
      const samples: BenchmarkSample[] = JSON.parse(reportLine.slice("__REPORT__".length));
      const baseline = samples.filter(({ enabled }) => !enabled);
      const captured = samples.filter(({ enabled }) => enabled);
      console.log(
        JSON.stringify({
          react: fixture.label,
          ...configuration,
          baselineMountMs: getMedian(baseline.map(({ mountMs }) => mountMs)),
          useFiberMountMs: getMedian(captured.map(({ mountMs }) => mountMs)),
          baselineUpdateMs: getMedian(baseline.map(({ updateMs }) => updateMs)),
          useFiberUpdateMs: getMedian(captured.map(({ updateMs }) => updateMs)),
          mountCaptureMicroseconds: getMedian(
            captured.map(({ mountCaptureMicroseconds }) => mountCaptureMicroseconds),
          ),
          updateCaptureMicroseconds: getMedian(
            captured.map(({ updateCaptureMicroseconds }) => updateCaptureMicroseconds),
          ),
        }),
      );
    }
  }
} finally {
  removeIsolatedReactRuntimes();
}
