import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import type { Fiber, FiberRoot } from "bippy";
import { getStateValues } from "../tests/conformance/hook-tree";
import { getExpectedExports } from "./test-inventory";

const mode = process.argv[2];
if (!mode) {
  // Bun strips unknown directives when it loads a module, so read the published files directly.
  for (const entryPath of ["../dist/index.js", "../dist/index.cjs"]) {
    assert.match(
      await Bun.file(new URL(entryPath, import.meta.url)).text(),
      /\{\s*["']use no memo["'];/,
      `${entryPath} lost the React Compiler opt-out directive in useFiber`,
    );
  }
  for (const environment of ["development", "production"]) {
    for (const format of ["import", "require"]) {
      const result = Bun.spawnSync(
        [
          "bun",
          "--tsconfig-override",
          fileURLToPath(new URL("../tsconfig-built.json", import.meta.url)),
          import.meta.filename,
          format,
        ],
        { env: { ...process.env, NODE_ENV: environment }, timeout: 15000 },
      );
      assert.ok(result.success, `${environment}/${format}\n${result.stdout}\n${result.stderr}`);
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
