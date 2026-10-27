import { getRDTHook } from "bippy";
import { createElement } from "react";
import type { ComponentType, ReactElement, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { PROVIDERS_PATH } from "../types";
import type { Capture, MountRequest } from "../types";
import { markDispatchersIdle, watchHookCallers } from "../write-origins";
import {
  captureMountedComponent,
  createEmptyCapture,
  getFirstCommitShapes,
  resetFirstCommitShapes,
} from "./capture";
import {
  Boundary,
  getDepthMarker,
  getRecordedError,
  recordCaughtError,
  recordError,
  resetErrors,
} from "./errors";
import { resetCommitTracking, setMountedType } from "./fibers";
import { hydrateProp } from "./hydrate";
import { importComponentModule, loadWrapper, runScenario } from "./load";
import type { LoadedWrapper } from "./load";
import { resetMutationTracking } from "./mutations";
import { resetProbeHits } from "./probes";
import {
  callServerComponent,
  isAsyncFunction,
  isFunctionComponent,
  resolveServerTree,
} from "./server-components";
import { drain, settle } from "./settle";

interface ProvidersProps {
  children?: ReactNode;
  isRouterless: boolean;
}

interface ProvidersModule {
  default: ComponentType<ProvidersProps>;
}

interface MountedComponent {
  props: Record<string, unknown>;
  wrappers: Array<LoadedWrapper | null>;
  Providers: ComponentType<ProvidersProps>;
}

const OPEN_PARENT_PROPS = {
  open: true,
  defaultOpen: true,
  isOpen: true,
  type: "single",
  collapsible: true,
};
const NESTED_ROUTER_PATTERN = /cannot render a <Router> inside another <Router>/;
const ASYNC_CLIENT_COMPONENT_PATTERN =
  /async\/await is not yet supported in Client Components|is an async Client Component/;

let mountedRoot: Root | null = null;

const resetRenderState = (): void => {
  resetErrors();
  resetCommitTracking();
  resetFirstCommitShapes();
};

const resetMountState = (): void => {
  resetRenderState();
  resetProbeHits();
  resetMutationTracking();
};

const createMountElement = (type: unknown, mounted: MountedComponent): ReactElement => {
  let element = createElement(type as Parameters<typeof createElement>[0], mounted.props);
  for (let depth = mounted.wrappers.length; depth > 0; depth--) {
    const wrapper = mounted.wrappers[depth - 1];
    if (wrapper)
      element = createElement(
        wrapper.type as ComponentType<Record<string, unknown>>,
        { ...wrapper.props, ...OPEN_PARENT_PROPS },
        createElement(getDepthMarker(depth), null, element),
      );
  }
  return element;
};

const getDocumentBody = (): HTMLElement =>
  document.body ?? document.documentElement.appendChild(document.createElement("body"));

const renderMounted = async (
  type: unknown,
  mounted: MountedComponent,
  isRouterless = false,
): Promise<void> => {
  mountedRoot?.unmount();
  resetRenderState();
  setMountedType(type);
  watchHookCallers(
    [...getRDTHook().renderers.values()].flatMap((renderer) => renderer.currentDispatcherRef ?? []),
  );
  markDispatchersIdle();
  const container = document.createElement("div");
  getDocumentBody().replaceChildren(container);
  mountedRoot = createRoot(container, { onCaughtError: recordCaughtError });
  const element = createMountElement(type, mounted);
  mountedRoot.render(
    createElement(Boundary, null, createElement(mounted.Providers, { isRouterless }, element)),
  );
  await settle();
};

const renderClientComponent = async (
  componentType: unknown,
  mounted: MountedComponent,
): Promise<void> => {
  await renderMounted(componentType, mounted);
  const error = getRecordedError();
  const isAsyncClientComponent =
    error !== null &&
    ASYNC_CLIENT_COMPONENT_PATTERN.test(error.message) &&
    isFunctionComponent(componentType);
  const serverRendered = isAsyncClientComponent
    ? await callServerComponent(componentType, mounted.props)
    : null;
  if (serverRendered) {
    const output = await resolveServerTree(serverRendered.output, true);
    await renderMounted(() => output, mounted);
  }
  if (error && NESTED_ROUTER_PATTERN.test(error.message))
    await renderMounted(componentType, mounted, true);
};

export const mount = async (request: MountRequest): Promise<Capture> => {
  mountedRoot?.unmount();
  setMountedType(null);
  await drain();
  resetMountState();
  const providersModule: ProvidersModule = await import(/* @vite-ignore */ PROVIDERS_PATH);
  if (request.scenario && !(await runScenario(request.scenario)))
    return createEmptyCapture(`setup has no scenario ${request.scenario.name}`);
  const moduleExports = await importComponentModule(request.module);
  const componentType = moduleExports[request.exportName];
  if (!componentType) return createEmptyCapture(`export ${request.exportName} not found`);
  const mounted: MountedComponent = {
    props: Object.fromEntries(
      Object.entries(request.props).map(([name, sample]) => [name, hydrateProp(name, sample)]),
    ),
    wrappers: await Promise.all(request.wrappers.map(loadWrapper)),
    Providers: providersModule.default,
  };
  try {
    if (isAsyncFunction(componentType)) {
      const output = await resolveServerTree(await componentType(mounted.props));
      await renderMounted(() => output, mounted);
    } else {
      await renderClientComponent(componentType, mounted);
    }
  } catch (error) {
    return createEmptyCapture(recordError(error).message);
  }
  return { ...captureMountedComponent(), firstCommitShapes: getFirstCommitShapes() };
};
