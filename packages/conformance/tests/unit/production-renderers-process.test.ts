import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { type RuntimeResult, runNodeScript } from "./run-node-script.js";

interface ProductionRendererFixture {
  name: string;
  script: string;
}

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bippyEntryUrl = pathToFileURL(resolve(packageDirectory, "../bippy/src/index.ts")).href;

const delay = (duration: number): string =>
  `await new Promise((resolvePromise) => setTimeout(resolvePromise, ${duration}));`;

const productionRendererFixtures: ProductionRendererFixture[] = [
  {
    name: "react-nil",
    script: `
      const renderer = await import("react-nil");
      createHostElement = (revision) => React.createElement("nil-view", { revision });
      renderer.render(React.createElement(Probe, { revision: 1 }));
      await waitForRevision(1);
      const mountedFiber = verifyMountedFiber();
      renderer.render(React.createElement(Probe, { revision: 2 }));
      await waitForRevision(2);
      verifyUpdatedFiber(mountedFiber);
      renderer.render(null);
      ${delay(20)}
    `,
  },
  {
    name: "Ink",
    script: `
      const { Text } = await import("ink");
      const { render } = await import("ink-testing-library");
      createHostElement = (revision) => React.createElement(Text, null, String(revision));
      const instance = render(React.createElement(Probe, { revision: 1 }));
      await waitForRevision(1);
      const mountedFiber = verifyMountedFiber();
      instance.rerender(React.createElement(Probe, { revision: 2 }));
      await waitForRevision(2);
      verifyUpdatedFiber(mountedFiber);
      instance.unmount();
      instance.cleanup();
    `,
  },
  {
    name: "OpenTUI",
    script: `
      const { BaseRenderable, engine } = await import("@opentui/core");
      const { createRoot, extend } = await import("@opentui/react");
      class TestRenderable extends BaseRenderable {
        constructor(context, options) {
          super(options);
          this.ctx = context;
          this.children = [];
        }
        add(child) {
          child.parent = this;
          this.children.push(child);
          return this.children.length - 1;
        }
        remove(child) {
          const childIndex = this.children.indexOf(child);
          if (childIndex === -1) return;
          this.children.splice(childIndex, 1);
          child.parent = null;
        }
        insertBefore(child, beforeChild) {
          const beforeChildIndex = this.children.indexOf(beforeChild);
          child.parent = this;
          this.children.splice(beforeChildIndex < 0 ? this.children.length : beforeChildIndex, 0, child);
        }
        getChildren() {
          return this.children;
        }
        getChildrenCount() {
          return this.children.length;
        }
        getRenderable(renderableId) {
          return this.id === renderableId ? this : this.findDescendantById(renderableId);
        }
        requestRender() {}
        findDescendantById(renderableId) {
          for (const child of this.children) {
            if (child.id === renderableId) return child;
            const descendant = child.findDescendantById(renderableId);
            if (descendant) return descendant;
          }
        }
      }
      extend({ "bippy-production-test": TestRenderable });
      const context = Object.create(null);
      const container = new TestRenderable(context, { id: "root" });
      const terminalRenderer = {
        dropLive: () => {},
        keyInput: null,
        once: () => {},
        removeFrameCallback: () => {},
        requestLive: () => {},
        root: container,
        setFrameCallback: () => {},
      };
      const root = createRoot(terminalRenderer);
      expectedStateInitializerCalls = 2;
      createHostElement = (revision) =>
        React.createElement("bippy-production-test", { id: String(revision) });
      root.render(React.createElement(Probe, { revision: 1 }));
      await waitForRevision(1);
      const mountedFiber = verifyMountedFiber();
      root.render(React.createElement(Probe, { revision: 2 }));
      await waitForRevision(2);
      verifyUpdatedFiber(mountedFiber);
      root.unmount();
      engine.detach();
    `,
  },
  {
    name: "Pixi React",
    script: `
      const { Window } = await import("happy-dom");
      const browserWindow = new Window();
      globalThis.window = browserWindow;
      globalThis.document = browserWindow.document;
      globalThis.Node = browserWindow.Node;
      globalThis.HTMLElement = browserWindow.HTMLElement;
      globalThis.HTMLCanvasElement = browserWindow.HTMLCanvasElement;
      const { createRequire } = await import("node:module");
      const { Container } = await import("pixi.js");
      const renderer = createRequire(import.meta.url)("@pixi/react");
      renderer.extend({ Container });
      const root = renderer.createRoot(document.createElement("canvas"));
      root.applicationState.isInitialised = true;
      createHostElement = (revision) =>
        React.createElement("pixiContainer", { label: String(revision) });
      await root.render(React.createElement(Probe, { revision: 1 }), {});
      await waitForRevision(1);
      const mountedFiber = verifyMountedFiber();
      await root.render(React.createElement(Probe, { revision: 2 }), {});
      await waitForRevision(2);
      verifyUpdatedFiber(mountedFiber);
      await root.render(null, {});
    `,
  },
  {
    name: "React BabylonJS",
    script: `
      const { NullEngine } = await import("@babylonjs/core/Engines/nullEngine.js");
      const { Scene } = await import("@babylonjs/core/scene.js");
      const reactBabylonJs = await import("react-babylonjs");
      const createReconciler = Reflect.get(reactBabylonJs, "createReconciler");
      assert.equal(typeof createReconciler, "function");
      const engine = new NullEngine();
      const scene = new Scene(engine);
      const container = {
        rootInstance: {
          children: [],
          customProps: {},
          hostInstance: scene,
          metadata: { className: "root" },
          observers: {},
          parent: null,
        },
        scene,
      };
      const renderer = createReconciler({});
      const render = (element) =>
        new Promise((resolvePromise) => renderer.render(element, container, resolvePromise, null));
      createHostElement = (revision) =>
        React.createElement("transformNode", { name: String(revision) });
      await render(React.createElement(Probe, { revision: 1 }));
      const mountedFiber = verifyMountedFiber();
      await render(React.createElement(Probe, { revision: 2 }));
      verifyUpdatedFiber(mountedFiber);
      await render(null);
      renderer.unmount(container);
      scene.dispose();
      engine.dispose();
    `,
  },
  {
    name: "React Konva",
    script: `
      const { KonvaRenderer } = await import("react-konva/lib/ReactKonvaCore.js");
      const { Group } = await import("konva/lib/Group.js");
      const container = new Group();
      const root = Reflect.apply(KonvaRenderer.createContainer, undefined, [
        container,
        1,
        null,
        false,
        null,
        "",
        console.error,
        console.error,
        console.error,
        null,
      ]);
      const render = (element) => {
        KonvaRenderer.updateContainer(element, root, null, () => {});
        KonvaRenderer.flushSyncWork();
      };
      createHostElement = (revision) =>
        React.createElement("Group", { name: String(revision) });
      render(React.createElement(Probe, { revision: 1 }));
      const mountedFiber = verifyMountedFiber();
      render(React.createElement(Probe, { revision: 2 }));
      verifyUpdatedFiber(mountedFiber);
      render(null);
      container.destroy();
    `,
  },
  {
    name: "react-pdf",
    script: `
      const reactPdf = await import("@react-pdf/renderer");
      const renderer = reactPdf.createRenderer({ onChange: () => {} });
      const container = { document: null, type: "ROOT" };
      const root = renderer.createContainer(container);
      const render = (element) =>
        new Promise((resolvePromise) => renderer.updateContainer(element, root, null, resolvePromise));
      createHostElement = (revision) =>
        React.createElement(reactPdf.Text, null, String(revision));
      const createDocument = (revision) =>
        React.createElement(
          reactPdf.Document,
          null,
          React.createElement(
            reactPdf.Page,
            null,
            React.createElement(Probe, { revision }),
          ),
        );
      await render(createDocument(1));
      const mountedFiber = verifyMountedFiber();
      await render(createDocument(2));
      verifyUpdatedFiber(mountedFiber);
      await render(null);
    `,
  },
  {
    name: "React Three Fiber",
    script: `
      const reactThreeFiber = await import("@react-three/fiber");
      const three = await import("three");
      reactThreeFiber.extend(three);
      const canvas = {
        addEventListener: () => {},
        clientHeight: 100,
        clientWidth: 100,
        removeEventListener: () => {},
      };
      const graphicsRenderer = {
        domElement: canvas,
        render: () => {},
        setAnimationLoop: () => {},
        setPixelRatio: () => {},
        setSize: () => {},
        shadowMap: {},
        xr: {
          addEventListener: () => {},
          isPresenting: false,
          removeEventListener: () => {},
          setAnimationLoop: () => {},
        },
      };
      const root = reactThreeFiber.createRoot(canvas);
      await root.configure({
        events: undefined,
        frameloop: "never",
        gl: graphicsRenderer,
        size: { height: 100, left: 0, top: 0, width: 100 },
      });
      createHostElement = (revision) =>
        React.createElement("group", { name: String(revision) });
      root.render(React.createElement(Probe, { revision: 1 }));
      reactThreeFiber.reconciler.flushSyncWork();
      await waitForRevision(1);
      const mountedFiber = verifyMountedFiber();
      root.render(React.createElement(Probe, { revision: 2 }));
      reactThreeFiber.reconciler.flushSyncWork();
      await waitForRevision(2);
      verifyUpdatedFiber(mountedFiber);
      root.unmount();
      ${delay(10)}
    `,
  },
];

const createProductionScript = (rendererScript: string): string => `
  import assert from "node:assert/strict";
  const Bippy = await import(${JSON.stringify(bippyEntryUrl)});
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE = () => {};
  const ReactModule = await import("react");
  const React = ReactModule.default ?? ReactModule;
  const originalBind = Function.prototype.bind;
  let createHostElement;
  let observedFiber;
  let observedSecondFiber;
  let expectedStateInitializerCalls = 1;
  let stateInitializerCalls = 0;
  let wasBindRestoredDuringRender = true;
  const waitForRevision = async (expectedRevision) => {
    const deadline = Date.now() + 2_000;
    while (observedFiber?.memoizedProps?.revision !== expectedRevision) {
      if (Date.now() >= deadline) {
        throw new Error(\`renderer did not render revision \${expectedRevision}\`);
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1));
    }
  };
  const Probe = ({ revision }) => {
    observedFiber = Bippy.useFiber();
    wasBindRestoredDuringRender &&= Function.prototype.bind === originalBind;
    observedSecondFiber = Bippy.useFiber();
    wasBindRestoredDuringRender &&= Function.prototype.bind === originalBind;
    React.useState(() => {
      stateInitializerCalls += 1;
      return revision;
    });
    return createHostElement(revision);
  };
  const verifyMountedFiber = () => {
    assert.ok(Bippy.isFiber(observedFiber));
    assert.equal(observedFiber.type, Probe);
    assert.equal(observedSecondFiber, observedFiber);
    assert.equal(observedFiber.memoizedProps.revision, 1);
    assert.equal(Function.prototype.bind, originalBind);
    return observedFiber;
  };
  const verifyUpdatedFiber = (mountedFiber) => {
    assert.ok(Bippy.isFiber(observedFiber));
    assert.equal(observedFiber.type, Probe);
    assert.equal(observedSecondFiber, observedFiber);
    assert.notEqual(observedFiber, mountedFiber);
    assert.equal(observedFiber.memoizedProps.revision, 2);
    assert.equal(Function.prototype.bind, originalBind);
  };
  ${rendererScript}
  assert.equal(stateInitializerCalls, expectedStateInitializerCalls);
  assert.equal(wasBindRestoredDuringRender, true);
  assert.equal(Function.prototype.bind, originalBind);
  console.log(JSON.stringify({ production: true }));
  process.exit(0);
`;

const runProductionRenderer = (rendererScript: string): RuntimeResult =>
  runNodeScript(createProductionScript(rendererScript), {
    environment: { DEV: "false", NODE_ENV: "production" },
    timeout: 30_000,
  });

describe.each(productionRendererFixtures)("$name production renderer", ({ script }) => {
  it("returns the exact mount and update fibers through the production fallback", () => {
    const result = runProductionRenderer(script);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('"production":true');
  }, 35_000);
});
