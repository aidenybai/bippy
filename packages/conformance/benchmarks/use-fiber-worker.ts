import assert from "node:assert/strict";
import type { ReactNode } from "react";
import type { BenchmarkContext } from "./harness.js";
import { createBrowser } from "./browser.js";
import { getSampleStatistics } from "./statistics.js";
import { verifyUseFiberConfiguration } from "./use-fiber-fixtures.js";
import { verifyUseFiberResult, writeReport, type UseFiberResult } from "./report.js";

interface LegacyReactDOM {
  flushSync: BenchmarkContext["ReactDOM"]["flushSync"];
  render?: (element: ReactNode, container: Element) => unknown;
  unmountComponentAtNode?: (container: Element) => boolean;
}

interface RevisionProps {
  revision: number;
}

interface CaptureSample {
  isEnabled: boolean;
  mountMs: number;
  updateMs: number;
  mountCaptureMicroseconds: number;
  updateCaptureMicroseconds: number;
}

const configuration: unknown = JSON.parse(process.argv[2]);
verifyUseFiberConfiguration(configuration);
const browser = createBrowser();
try {
  const BippyModule = await import(configuration.builtEntryUrl);
  const Bippy: BenchmarkContext["Bippy"] = BippyModule.default ?? BippyModule;
  const React: BenchmarkContext["React"] = (await import(configuration.reactUrl)).default;
  const ReactDOM: LegacyReactDOM = (await import(configuration.reactDOMUrl)).default;
  const ReactDOMClient: BenchmarkContext["ReactDOMClient"] | null = configuration.reactDOMClientUrl
    ? (await import(configuration.reactDOMClientUrl)).default
    : null;
  const samples: CaptureSample[] = [];
  for (let trial = 0; trial <= configuration.sampleCount; trial++) {
    for (const isEnabled of trial % 2 === 0 ? [false, true] : [true, false]) {
      let captureTime = 0;
      let invalidFiberCount = 0;
      let renderCount = 0;
      const Probe = (props: RevisionProps) => {
        for (let hookIndex = 0; hookIndex < configuration.precedingHooks; hookIndex++)
          React.useRef(null);
        const captureStart = performance.now();
        const fiber = isEnabled ? Bippy.useFiber() : null;
        captureTime += performance.now() - captureStart;
        renderCount++;
        if (isEnabled && (!fiber || fiber.type !== Probe || fiber.pendingProps !== props))
          invalidFiberCount++;
        return null;
      };
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = ReactDOMClient?.createRoot(container);
      const render = (revision: number): void => {
        const elements = Array.from({ length: configuration.components }, (_, index) =>
          React.createElement(Probe, { key: index, revision }),
        );
        ReactDOM.flushSync(() => {
          if (root) root.render(elements);
          else {
            assert.ok(ReactDOM.render);
            ReactDOM.render(elements, container);
          }
        });
      };
      try {
        const mountStart = performance.now();
        render(0);
        const mountMs = performance.now() - mountStart;
        const mountCaptureMicroseconds = (captureTime * 1000) / configuration.components;
        captureTime = 0;
        const updateStart = performance.now();
        for (let revision = 1; revision <= configuration.updateCount; revision++) render(revision);
        const updateMs = (performance.now() - updateStart) / configuration.updateCount;
        const updateCaptureMicroseconds =
          (captureTime * 1000) / (configuration.updateCount * configuration.components);
        assert.equal(invalidFiberCount, 0);
        assert.equal(renderCount, configuration.components * (configuration.updateCount + 1));
        if (trial > 0)
          samples.push({
            isEnabled,
            mountMs,
            updateMs,
            mountCaptureMicroseconds,
            updateCaptureMicroseconds,
          });
      } finally {
        ReactDOM.flushSync(() => {
          if (root) root.unmount();
          else ReactDOM.unmountComponentAtNode?.(container);
        });
        container.remove();
      }
    }
  }
  const baselineSamples = samples.filter(({ isEnabled }) => !isEnabled);
  const captureSamples = samples.filter(({ isEnabled }) => isEnabled);
  const getMedian = (values: number[]): number =>
    Number(getSampleStatistics(values).median.toFixed(3));
  const result: UseFiberResult = {
    react: configuration.react,
    reactVersion: React.version,
    components: configuration.components,
    precedingHooks: configuration.precedingHooks,
    baselineMountMs: getMedian(baselineSamples.map(({ mountMs }) => mountMs)),
    useFiberMountMs: getMedian(captureSamples.map(({ mountMs }) => mountMs)),
    baselineUpdateMs: getMedian(baselineSamples.map(({ updateMs }) => updateMs)),
    useFiberUpdateMs: getMedian(captureSamples.map(({ updateMs }) => updateMs)),
    mountCaptureMicroseconds: getMedian(
      captureSamples.map(({ mountCaptureMicroseconds }) => mountCaptureMicroseconds),
    ),
    updateCaptureMicroseconds: getMedian(
      captureSamples.map(({ updateCaptureMicroseconds }) => updateCaptureMicroseconds),
    ),
  };
  verifyUseFiberResult(result);
  writeReport(result);
} finally {
  await browser.happyDOM.close();
}

// HACK: Early React schedulers retain MessagePorts; exit only after stdout has flushed.
process.stdout.end(() => process.exit(0));
