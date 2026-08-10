import React, { act } from "react";
import { getRDTHook, traverseFiber } from "../src/index.js";
import { ReactBuildType } from "../src/react-internals/index.js";
import type { BaseRenderable, BaseRenderableOptions, RenderContext } from "@opentui/core";
import type { Fiber, FiberRoot, RendererDispatcherRef } from "../src/react-internals/index.js";
import type { RendererAdapter, RendererAdapterFactory } from "./renderer-test-harness.js";

interface ReactPdfContainer {
  document: unknown;
  type: "ROOT";
}

interface ReactPdfRenderer {
  createContainer: (container: ReactPdfContainer) => FiberRoot;
  updateContainer: (
    element: React.ReactElement | null,
    root: FiberRoot,
    parentComponent: null,
    callback: () => void,
  ) => void;
}

interface ReactPdfRendererFactory {
  (options: { onChange: () => void }): ReactPdfRenderer;
}

interface ReactBabylonJsReconciler {
  render: (
    element: React.ReactElement | null,
    container: object,
    callback: () => void,
    parentComponent: null,
  ) => unknown;
  unmount: (container: object) => void;
}

interface ReactBabylonJsReconcilerFactory {
  (options: object): ReactBabylonJsReconciler;
}

interface OpenTuiTestRenderableOptions extends BaseRenderableOptions {
  label?: string;
  value?: number;
}

const isReactPdfRendererFactory = (value: unknown): value is ReactPdfRendererFactory =>
  typeof value === "function";

const isReactBabylonJsReconcilerFactory = (
  value: unknown,
): value is ReactBabylonJsReconcilerFactory => typeof value === "function";

const isRendererDispatcherRef = (value: unknown): value is RendererDispatcherRef =>
  typeof value === "object" && value !== null && ("H" in value || "current" in value);

const createReactNilAdapter = async (): Promise<RendererAdapter> => {
  const { render } = await import("react-nil");

  return {
    createHostElement: ({ label, value }) =>
      React.createElement(
        "nil-view",
        { label, value },
        React.createElement("nil-text", null, `${label}:${value}`),
      ),
    render: async (element) => {
      const renderState: { container: ReturnType<typeof render> | undefined } = {
        container: undefined,
      };
      await act(async () => {
        renderState.container = render(element);
      });
      const container = renderState.container;
      if (!container) throw new Error("react-nil did not create a container");
      return {
        getOutput: () => container.head,
        update: async (nextElement, updateState) => {
          await act(async () => {
            updateState();
            render(nextElement);
          });
        },
        unmount: async () => {
          await act(async () => render(null));
        },
      };
    },
    wrap: (element) => <>{element}</>,
  };
};

const createInkAdapter = async (): Promise<RendererAdapter> => {
  const previousDevValue = process.env.DEV;
  const restoreDevValue = (): void => {
    if (previousDevValue === undefined) {
      delete process.env.DEV;
    } else {
      process.env.DEV = previousDevValue;
    }
  };
  process.env.DEV = "true";
  const [{ Text }, { render }] = await Promise.all([
    import("ink"),
    import("ink-testing-library"),
  ]).finally(restoreDevValue);

  return {
    createHostElement: ({ label, value }) => <Text color="green">{`${label}:${value}`}</Text>,
    render: async (element) => {
      process.env.DEV = "true";
      const renderState: { instance: ReturnType<typeof render> | undefined } = {
        instance: undefined,
      };
      try {
        await act(async () => {
          renderState.instance = render(element);
        });
      } finally {
        restoreDevValue();
      }
      const instance = renderState.instance;
      if (!instance) throw new Error("Ink did not create a renderer instance");
      return {
        getOutput: instance.lastFrame,
        update: async (nextElement, updateState) => {
          await act(async () => {
            updateState();
            instance.rerender(nextElement);
          });
        },
        unmount: async () => {
          await act(async () => instance.unmount());
          instance.cleanup();
        },
      };
    },
    wrap: (element) => <>{element}</>,
  };
};

const createOpenTuiAdapter = async (): Promise<RendererAdapter> => {
  const [{ BaseRenderable, engine }, { createRoot, extend }] = await Promise.all([
    import("@opentui/core"),
    import("@opentui/react"),
  ]);

  class OpenTuiTestRenderable extends BaseRenderable {
    readonly ctx: RenderContext;
    label: string | undefined;
    value: number | undefined;
    private readonly children: BaseRenderable[] = [];

    constructor(context: RenderContext, options: OpenTuiTestRenderableOptions) {
      super(options);
      this.ctx = context;
      this.label = options.label;
      this.value = options.value;
    }

    add(child: BaseRenderable): number {
      child.parent = this;
      this.children.push(child);
      return this.children.length - 1;
    }

    remove(child: BaseRenderable): void {
      const childIndex = this.children.indexOf(child);
      if (childIndex === -1) return;
      this.children.splice(childIndex, 1);
      child.parent = null;
    }

    insertBefore(child: BaseRenderable, beforeChild: BaseRenderable): void {
      const beforeChildIndex = this.children.indexOf(beforeChild);
      if (beforeChildIndex === -1) {
        this.add(child);
        return;
      }
      child.parent = this;
      this.children.splice(beforeChildIndex, 0, child);
    }

    getChildren(): BaseRenderable[] {
      return this.children;
    }

    getChildrenCount(): number {
      return this.children.length;
    }

    getRenderable(renderableId: string): BaseRenderable | undefined {
      if (this.id === renderableId) return this;
      return this.findDescendantById(renderableId);
    }

    requestRender(): void {}

    findDescendantById(renderableId: string): BaseRenderable | undefined {
      for (const child of this.children) {
        if (child.id === renderableId) return child;
        const descendant = child.findDescendantById(renderableId);
        if (descendant) return descendant;
      }
      return undefined;
    }
  }

  extend({ "bippy-test": OpenTuiTestRenderable });

  return {
    createHostElement: ({ label, value }) => React.createElement("bippy-test", { label, value }),
    render: async (element) => {
      // HACK: Exercise OpenTUI's real reconciler without attaching native terminal output during Node tests.
      const renderContext: RenderContext = Object.create(null);
      const rootContainer = new OpenTuiTestRenderable(renderContext, { id: "root" });
      const openTuiRenderer = {
        dropLive: () => {},
        keyInput: null,
        once: () => {},
        removeFrameCallback: () => {},
        requestLive: () => {},
        root: rootContainer,
        setFrameCallback: () => {},
      };
      const root = Reflect.apply(createRoot, undefined, [openTuiRenderer]);
      let setRenderedElement: React.Dispatch<React.SetStateAction<React.ReactElement>> | undefined;

      const OpenTuiTestRoot = () => {
        const [renderedElement, setCurrentElement] = React.useState(element);
        setRenderedElement = setCurrentElement;
        return renderedElement;
      };

      await act(async () => {
        root.render(<OpenTuiTestRoot />);
      });

      return {
        getOutput: () => rootContainer.getChildren(),
        update: async (nextElement, updateState) => {
          await act(async () => {
            updateState();
            setRenderedElement?.(nextElement);
          });
        },
        unmount: async () => {
          await act(async () => root.unmount());
          engine.detach();
        },
      };
    },
    wrap: (element) => <>{element}</>,
  };
};

const createPixiAdapter = async (): Promise<RendererAdapter> => {
  const [{ createRequire }, { Container }] = await Promise.all([
    import("node:module"),
    import("pixi.js"),
  ]);
  // HACK: Pixi's published ESM entry uses an extensionless react-reconciler subpath under Node.
  const pixiReactModule: typeof import("@pixi/react") = createRequire(import.meta.url)(
    "@pixi/react",
  );
  const { createRoot, extend } = pixiReactModule;

  extend({ Container });

  return {
    createHostElement: ({ label, value }) => React.createElement("pixiContainer", { label, value }),
    render: async (element) => {
      const canvas = document.createElement("canvas");
      const root = createRoot(canvas);
      // HACK: The renderer matrix needs the real reconciler and host tree, not GPU initialization.
      root.applicationState.isInitialised = true;

      await act(async () => {
        await root.render(element, {});
      });

      return {
        getOutput: () => root.internalState.rootContainer.children,
        update: async (nextElement, updateState) => {
          await act(async () => {
            updateState();
            await root.render(nextElement, {});
          });
        },
        unmount: async () => {
          await act(async () => {
            await root.render(null, {});
          });
        },
      };
    },
    wrap: (element) => <>{element}</>,
  };
};

const createReactBabylonJsAdapter = async (): Promise<RendererAdapter> => {
  const [{ NullEngine }, { Scene }, reactBabylonJsModule] = await Promise.all([
    import("@babylonjs/core/Engines/nullEngine.js"),
    import("@babylonjs/core/scene.js"),
    import("react-babylonjs"),
  ]);
  const createReconciler: unknown = Reflect.get(reactBabylonJsModule, "createReconciler");
  if (!isReactBabylonJsReconcilerFactory(createReconciler)) {
    throw new Error("react-babylonjs does not expose createReconciler");
  }
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
  const renderElement = (element: React.ReactElement | null) => {
    renderer.render(element, container, () => {}, null);
  };

  return {
    createHostElement: ({ label, value }) =>
      React.createElement("transformNode", { name: `${label}-${value}` }),
    render: async (element) => {
      await act(async () => {
        renderElement(element);
      });
      return {
        getOutput: () => scene.transformNodes,
        update: async (nextElement, updateState) => {
          await act(async () => {
            updateState();
            renderElement(nextElement);
          });
        },
        unmount: async () => {
          await act(async () => {
            renderElement(null);
          });
          renderer.unmount(container);
          scene.dispose();
          engine.dispose();
        },
      };
    },
    wrap: (element) => <>{element}</>,
  };
};

const createReactKonvaCompatibilityAdapter = async (): Promise<RendererAdapter> => {
  const [{ KonvaRenderer }, { Group }] = await Promise.all([
    import("react-konva/lib/ReactKonvaCore.js"),
    import("konva/lib/Group.js"),
  ]);
  const devToolsConfig = {
    bundleType: ReactBuildType.Development,
    findFiberByHostInstance: () => null,
    reconcilerVersion: React.version,
    rendererPackageName: "react-konva",
    version: React.version,
  };
  KonvaRenderer.injectIntoDevTools(devToolsConfig);

  return {
    createHostElement: ({ label, value }) =>
      React.createElement("Group", { name: `${label}-${value}` }),
    render: async (element) => {
      const container = new Group();
      const createContainer = KonvaRenderer.createContainer.bind(KonvaRenderer);
      const root = Reflect.apply(createContainer, undefined, [
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
      const renderElement = (nextElement: React.ReactElement | null) =>
        new Promise<void>((resolve) => {
          KonvaRenderer.updateContainer(nextElement, root, null, resolve);
          KonvaRenderer.flushSyncWork();
        });

      await act(async () => renderElement(element));
      return {
        getOutput: () => container.getChildren(),
        update: async (nextElement, updateState) => {
          await act(async () => {
            updateState();
            await renderElement(nextElement);
          });
        },
        unmount: async () => {
          await act(async () => renderElement(null));
          container.destroy();
        },
      };
    },
    wrap: (element) => <>{element}</>,
  };
};

const createRemotionAdapter = async (): Promise<RendererAdapter> => {
  const [{ render }, { AbsoluteFill }] = await Promise.all([
    import("@testing-library/react"),
    import("remotion"),
  ]);

  return {
    createHostElement: ({ label, value }) => (
      <AbsoluteFill data-label={label} data-value={value}>
        {`${label}:${value}`}
      </AbsoluteFill>
    ),
    render: async (element) => {
      const instance = render(element);
      return {
        getOutput: () => instance.container.firstChild,
        update: async (nextElement, updateState) => {
          await act(async () => {
            updateState();
            instance.rerender(nextElement);
          });
        },
        unmount: async () => {
          await act(async () => instance.unmount());
        },
      };
    },
    wrap: (element) => <>{element}</>,
  };
};

const createReactPdfAdapter = async (): Promise<RendererAdapter> => {
  const reactPdfModule = await import("@react-pdf/renderer");
  const createRenderer: unknown = Reflect.get(reactPdfModule, "createRenderer");
  if (!isReactPdfRendererFactory(createRenderer)) {
    throw new Error("@react-pdf/renderer does not expose createRenderer");
  }
  const renderer = createRenderer({ onChange: () => {} });
  const rdtHook = getRDTHook();
  const reactDispatcherRef: unknown = Reflect.get(
    React,
    "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
  );
  // HACK: react-pdf does not register its reconciler with DevTools, so forward its real root through the hook.
  const rendererId = rdtHook.inject({
    bundleType: ReactBuildType.Development,
    currentDispatcherRef: isRendererDispatcherRef(reactDispatcherRef)
      ? reactDispatcherRef
      : undefined,
    reconcilerVersion: React.version,
    rendererPackageName: "@react-pdf/renderer",
    version: React.version,
  });

  return {
    createHostElement: ({ label, value }) => (
      <reactPdfModule.Text id={label}>{`${label}:${value}`}</reactPdfModule.Text>
    ),
    render: async (element) => {
      const container: ReactPdfContainer = { document: null, type: "ROOT" };
      const root = renderer.createContainer(container);
      const updateContainer = (nextElement: React.ReactElement | null) =>
        new Promise<void>((resolve) => {
          renderer.updateContainer(nextElement, root, null, () => {
            rdtHook.onCommitFiberRoot(rendererId, root, undefined);
            resolve();
          });
        });
      await act(async () => updateContainer(element));
      return {
        getOutput: () => container.document,
        update: async (nextElement, updateState) => {
          await act(async () => {
            updateState();
            await updateContainer(nextElement);
          });
        },
        unmount: async () => {
          const mountedFibers: Fiber[] = [];
          traverseFiber(root.current, (fiber) => {
            mountedFibers.push(fiber);
          });
          await act(async () => {
            for (const fiber of mountedFibers) {
              rdtHook.onCommitFiberUnmount(rendererId, fiber);
            }
            await updateContainer(null);
          });
        },
      };
    },
    wrap: (element) => (
      <reactPdfModule.Document>
        <reactPdfModule.Page size="A4">{element}</reactPdfModule.Page>
      </reactPdfModule.Document>
    ),
  };
};

const createReactThreeFiberAdapter = async (): Promise<RendererAdapter> => {
  const ReactThreeTestRenderer = await import("@react-three/test-renderer");

  return {
    createHostElement: ({ label, value }) =>
      React.createElement(
        "group",
        { name: `${label}-${value}` },
        React.createElement("mesh", { name: label }),
      ),
    render: async (element) => {
      const instance = await ReactThreeTestRenderer.create(element);
      return {
        getOutput: () => instance.toTree(),
        update: async (nextElement, updateState) => {
          await ReactThreeTestRenderer.act(async () => {
            updateState();
            await instance.update(nextElement);
          });
        },
        unmount: async () => {
          await instance.unmount();
        },
      };
    },
    wrap: (element) => <>{element}</>,
  };
};

export const rendererAdapterFactories: RendererAdapterFactory[] = [
  {
    create: createReactNilAdapter,
    name: "react-nil",
    supportLevel: "automatic",
  },
  {
    create: createInkAdapter,
    name: "Ink",
    rendererPackageName: "ink",
    supportLevel: "automatic",
  },
  {
    create: createOpenTuiAdapter,
    name: "OpenTUI",
    rendererPackageName: "@opentui/react",
    supportLevel: "automatic",
    supportsHostInstanceLookup: true,
  },
  {
    create: createPixiAdapter,
    name: "Pixi React",
    rendererPackageName: "@pixi/react",
    supportLevel: "automatic",
    supportsHostInstanceLookup: true,
  },
  {
    create: createReactBabylonJsAdapter,
    name: "React BabylonJS",
    supportLevel: "automatic",
    supportsHostInstanceLookup: true,
  },
  {
    create: createReactKonvaCompatibilityAdapter,
    name: "React Konva bridge",
    supportLevel: "compatibility",
    supportsHostInstanceLookup: true,
  },
  {
    create: createRemotionAdapter,
    name: "Remotion",
    rendererPackageName: "react-dom",
    supportLevel: "automatic",
  },
  {
    create: createReactPdfAdapter,
    name: "react-pdf bridge",
    rendererPackageName: "@react-pdf/renderer",
    supportLevel: "compatibility",
    supportsHostInstanceLookup: true,
  },
  {
    create: createReactThreeFiberAdapter,
    name: "React Three Fiber",
    rendererPackageName: "@react-three/fiber",
    supportLevel: "automatic",
  },
];
