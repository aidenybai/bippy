import { createRequire } from "node:module";
import { createCommitRecorder } from "../../src/harness/commit-recorder.js";
import { getRootContainer } from "../../src/harness/runtime-snapshot.js";
import { ensureDomGlobals } from "../../src/materialize/dom-environment.js";
import { loadReactRuntime } from "../../src/materialize/react-runtime.js";

interface RuntimeObservation {
  environment: string;
  environmentUnchanged: boolean;
  nativeModulesUnchanged: boolean;
  html: string;
  commits: number;
  cleanups: number;
  errors: string[];
}

const getObservations = async (): Promise<RuntimeObservation[]> => {
  ensureDomGlobals();
  const requireFromTest = createRequire(import.meta.url);
  const nativeReact = requireFromTest("react");
  const nativeClient = requireFromTest("react-dom/client");
  const environments = process.argv.slice(2);
  const observations: RuntimeObservation[] = [];
  for (const environment of environments) {
    process.env.NODE_ENV = environment;
    const originalEnvironment = process.env;
    const runtime = await loadReactRuntime({ rootDirectory: `runtime-${environment}` });
    const container = document.createElement("div");
    const errors: string[] = [];
    const onError = (error: unknown) => errors.push(String(error));
    const recorder = createCommitRecorder({
      rootFilter: (root) => getRootContainer(root) === container,
    });
    const root = runtime.createRoot(container, {
      onCaughtError: onError,
      onUncaughtError: onError,
    });
    let cleanups = 0;
    const Component = () => {
      const [value, setValue] = runtime.react.useState(0);
      runtime.react.useEffect(() => {
        setValue(1);
        return () => {
          cleanups++;
        };
      }, []);
      return runtime.react.createElement("span", null, `${environment}:${value}`);
    };
    try {
      await runtime.act(() => root.render(runtime.react.createElement(Component)));
      const html = container.innerHTML;
      const commits = recorder.commitCount();
      await runtime.act(() => root.unmount());
      observations.push({
        environment,
        environmentUnchanged:
          process.env === originalEnvironment && process.env.NODE_ENV === environment,
        nativeModulesUnchanged:
          requireFromTest("react") === nativeReact &&
          requireFromTest("react-dom/client") === nativeClient,
        html,
        commits,
        cleanups,
        errors,
      });
    } finally {
      recorder.dispose();
    }
  }
  return observations;
};

// HACK: React's scheduler retains a MessagePort after awaited rendering; report the actual subprocess outcome explicitly.
getObservations().then(
  (observations) => {
    console.log(JSON.stringify(observations));
    process.exit(0);
  },
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
