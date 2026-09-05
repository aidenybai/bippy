import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import type { Fiber, FiberRoot } from "bippy";
import { getStateValues } from "../tests/hook-tree.js";
import { getExpectedExports } from "./test-inventory.js";

const mode = process.argv[2];
if (!mode) {
  for (const environment of ["development", "production"]) {
    for (const format of ["import", "require"]) {
      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", import.meta.filename, format],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            NODE_ENV: environment,
            TSX_TSCONFIG_PATH: fileURLToPath(new URL("../tsconfig-built.json", import.meta.url)),
          },
          timeout: 15000,
        },
      );
      assert.equal(
        result.status,
        0,
        `${environment}/${format}\n${result.stdout}\n${result.stderr}\n${result.error ?? ""}`,
      );
      console.log(`Published entrypoints: ${environment}/${format} passed`);
    }
  }
} else {
  assert.ok(mode === "import" || mode === "require");
  const browser = new Window();
  Reflect.set(globalThis, "window", browser);
  Reflect.set(globalThis, "document", browser.document);
  const require = createRequire(import.meta.url);
  for (const entry of ["bippy", "bippy/source", "bippy/install-hook-only"]) {
    const resolvedEntry = mode === "import" ? import.meta.resolve(entry) : require.resolve(entry);
    assert.match(resolvedEntry, /[/\\]dist[/\\]/, `${entry} must resolve to built output`);
  }
  const hookOnly =
    mode === "import"
      ? await import("bippy/install-hook-only")
      : require("bippy/install-hook-only");
  assert.deepEqual(Object.keys(hookOnly), []);
  assert.ok(globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__);
  const Bippy: typeof import("bippy") =
    mode === "import" ? await import("bippy") : require("bippy");
  const Source: typeof import("bippy/source") =
    mode === "import" ? await import("bippy/source") : require("bippy/source");
  for (const { entry, module } of [
    { entry: "bippy", module: Bippy },
    { entry: "bippy/source", module: Source },
  ]) {
    assert.deepEqual(Object.keys(module).sort(), getExpectedExports(entry));
  }
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { flushSync } = await import("react-dom");
  assert.equal(Bippy.getFiberFromHostInstance, Bippy.getFiber);
  assert.equal(Source.BippyError, Bippy.BippyError);
  assert.equal(Bippy.isValidElement(React.createElement("span")), true);
  assert.equal(Bippy.isValidElement({ $$typeof: Symbol("react.transitional.element") }), false);
  let committedRoot: FiberRoot | undefined;
  let capturedFiber: Fiber | undefined;
  const unsubscribe = Bippy.instrument({
    onCommitFiberRoot: (_rendererId, root) => {
      committedRoot = root;
    },
  });
  const Component = () => {
    capturedFiber = Bippy.useFiber();
    const [state] = React.useState(7);
    return React.createElement("span", null, state);
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    flushSync(() => root.render(React.createElement(Component)));
    assert.ok(committedRoot);
    const componentFiber = Bippy.traverseFiber(
      committedRoot.current,
      (fiber) => fiber.type === Component,
    );
    assert.ok(componentFiber);
    assert.equal(capturedFiber, componentFiber);
    assert.equal(container.textContent, "7");
    const hostFiber = Bippy.getFiber(container.firstChild);
    assert.ok(hostFiber);
    assert.equal(Bippy.isHostFiber(hostFiber), true);
    const identifier = Bippy.getFiberId(componentFiber);
    assert.equal(Bippy.getFiberById(identifier), componentFiber);
    flushSync(() => root.render(React.createElement(Component)));
    assert.equal(Bippy.getLatestFiber(componentFiber), capturedFiber);
    assert.equal(Bippy.getFiberById(identifier), capturedFiber);
    assert.deepEqual(
      getStateValues(Source.getFiberHooks(Bippy.getLatestFiber(componentFiber))),
      [7],
    );
    assert.equal(container.textContent, "7");
    flushSync(() => root.unmount());
    assert.equal(Bippy.getFiberById(identifier), null);
  } finally {
    unsubscribe();
    await browser.happyDOM.close();
  }
}
