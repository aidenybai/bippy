import React, { act } from "react";
import { getRDTHook, traverseFiber } from "../src/index.js";
import type { Fiber } from "../src/types.js";
import type { RendererAdapter, RendererAdapterFactory } from "./renderer-test-harness.js";

interface ReactPdfContainer {
  document: unknown;
  type: "ROOT";
}

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
      let container: ReturnType<typeof render> | undefined;
      await act(async () => {
        container = render(element);
      });
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
  process.env.DEV = "true";
  const [{ Text }, { render }] = await Promise.all([import("ink"), import("ink-testing-library")]);

  return {
    createHostElement: ({ label, value }) => <Text color="green">{`${label}:${value}`}</Text>,
    render: async (element) => {
      process.env.DEV = "true";
      let instance: ReturnType<typeof render> | undefined;
      await act(async () => {
        instance = render(element);
      });
      if (previousDevValue === undefined) {
        delete process.env.DEV;
      } else {
        process.env.DEV = previousDevValue;
      }
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
  const createRenderer = Reflect.get(reactPdfModule, "createRenderer");
  const renderer = createRenderer({ onChange: () => {} });
  const rdtHook = getRDTHook();
  // HACK: react-pdf does not register its reconciler with DevTools, so forward its real root through the hook.
  const rendererId = rdtHook.inject({
    bundleType: 1,
    currentDispatcherRef: Reflect.get(
      React,
      "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
    ),
    reconcilerVersion: reactPdfModule.version,
    rendererPackageName: "@react-pdf/renderer",
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
  },
  {
    create: createInkAdapter,
    name: "Ink",
    rendererPackageName: "ink",
  },
  {
    create: createRemotionAdapter,
    name: "Remotion",
    rendererPackageName: "react-dom",
  },
  {
    create: createReactPdfAdapter,
    name: "react-pdf",
    rendererPackageName: "@react-pdf/renderer",
  },
  {
    create: createReactThreeFiberAdapter,
    name: "React Three Fiber",
    rendererPackageName: "@react-three/fiber",
    usesTrackedHostInstances: true,
  },
];
