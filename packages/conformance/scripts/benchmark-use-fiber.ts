import assert from "node:assert/strict";
import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createBrowserBootstrapScript,
  createIsolatedReactRuntime,
  removeIsolatedReactRuntimes,
} from "../tests/unit/isolated-react-runtime.js";
import { runNodeScript } from "../tests/unit/run-node-script.js";
import {
  getUseFiberConfigurations,
  getUseFiberFixtures,
} from "../benchmarks/use-fiber-fixtures.js";

interface BenchmarkSample {
  enabled: boolean;
  mountMs: number;
  updateMs: number;
  mountCaptureMicroseconds: number;
  updateCaptureMicroseconds: number;
}

interface BenchmarkVersionSamples {
  reactVersion: string;
  samples: BenchmarkSample[];
}

const getMedian = (values: number[]): number => {
  const sorted = values.toSorted((first, second) => first - second);
  return Number(sorted[Math.floor(sorted.length / 2)].toFixed(3));
};

const quick = process.argv.includes("--quick");
const format = process.argv.includes("--cjs") ? "cjs" : "esm";
const fixtures = getUseFiberFixtures(quick);
const sampleCount = quick ? 1 : 5;
const updateCount = quick ? 2 : 5;
const configurations = getUseFiberConfigurations(quick);
const builtDirectory = fileURLToPath(new URL("../../bippy/dist/", import.meta.url));

console.log(
  `Production ${format}; ${process.version}; median of ${sampleCount} samples after warm-up; ${updateCount} updates per sample`,
);
try {
  for (const fixture of fixtures) {
    const runtime = createIsolatedReactRuntime(fixture);
    const builtEntry = new URL(
      `../dist/index.${format === "esm" ? "js" : "cjs"}`,
      runtime.bippyEntryUrl,
    );
    cpSync(builtDirectory, fileURLToPath(new URL("./", builtEntry)), { recursive: true });
    for (const configuration of configurations) {
      const result = runNodeScript(
        `
        import assert from "node:assert/strict";
        ${createBrowserBootstrapScript()}
        const BippyModule = await import(${JSON.stringify(builtEntry.href)});
        const Bippy = BippyModule.default ?? BippyModule;
        const React = (await import(${JSON.stringify(runtime.reactUrl)})).default;
        const ReactDOM = (await import(${JSON.stringify(runtime.reactDOMUrl)})).default;
        const ReactDOMClient = ${fixture.major >= 18 ? `(await import(${JSON.stringify(runtime.reactDOMClientUrl)})).default` : "null"};
        const samples = [];
        for (let trial = 0; trial <= ${sampleCount}; trial++) {
          for (const enabled of trial % 2 === 0 ? [false, true] : [true, false]) {
            let captureTime = 0;
            let invalidFibers = 0;
            let renders = 0;
            const Probe = (props) => {
              for (let hookIndex = 0; hookIndex < ${configuration.precedingHooks}; hookIndex++) React.useRef(null);
              const captureStart = performance.now();
              const fiber = enabled ? Bippy.useFiber() : null;
              captureTime += performance.now() - captureStart;
              renders++;
              if (enabled && (!fiber || fiber.type !== Probe || fiber.pendingProps !== props)) invalidFibers++;
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
            for (let revision = 1; revision <= ${updateCount}; revision++) render(revision);
            const updateMs = (performance.now() - updateStart) / ${updateCount};
            const updateCaptureMicroseconds = captureTime * 1000 / (${updateCount} * ${configuration.components});
            ReactDOM.flushSync(() => {
              if (root) root.unmount();
              else ReactDOM.unmountComponentAtNode(container);
            });
            container.remove();
            assert.equal(invalidFibers, 0);
            assert.equal(renders, ${configuration.components} * (${updateCount} + 1));
            if (trial > 0) samples.push({ enabled, mountMs, updateMs, mountCaptureMicroseconds, updateCaptureMicroseconds });
          }
        }
        console.log("__REPORT__" + JSON.stringify({ reactVersion: React.version, samples }));
        process.exit(0);
      `,
        { environment: { NODE_ENV: "production" }, timeout: 120000 },
      );
      assert.equal(result.status, 0, result.stderr);
      const reportLine = result.stdout.split("\n").find((line) => line.startsWith("__REPORT__"));
      assert.ok(reportLine);
      const { samples, reactVersion }: BenchmarkVersionSamples = JSON.parse(
        reportLine.slice("__REPORT__".length),
      );
      const baseline = samples.filter(({ enabled }) => !enabled);
      const captured = samples.filter(({ enabled }) => enabled);
      console.log(
        JSON.stringify({
          react: fixture.label,
          reactVersion,
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
