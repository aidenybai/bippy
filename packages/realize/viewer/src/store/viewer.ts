import { createContext, useContext, useEffect } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import {
  buildGraphIndex,
  getCausalNodeIds,
  getDefaultComponent,
  type GraphIndex,
} from "@/lib/graph";
import type { GraphNode, ViewFile } from "@/model";

interface FocusRequest {
  name: string;
}

interface ViewerStoreState {
  index: GraphIndex;
  defaultName: string | null;
  activeName: string | null;
  panels: Map<string, boolean>;
  focusRequest: FocusRequest | null;
  hoveredNodeId: string | null;
  causalNodeIds: Set<string> | null;
  activate: (name: string) => void;
  setPanelOpen: (name: string, open: boolean) => void;
  hover: (nodeId: string) => void;
  leave: () => void;
}

export type ViewerStore = StoreApi<ViewerStoreState>;

export const getActiveName = (state: ViewerStoreState): string | null =>
  state.activeName ?? state.defaultName;

const openOnFirstActivation = (
  panels: Map<string, boolean>,
  name: string | null,
): Map<string, boolean> =>
  name === null || panels.has(name) ? panels : new Map(panels).set(name, true);

export const createViewerStore = (view: ViewFile): ViewerStore => {
  const defaultName = getDefaultComponent(view)?.name ?? null;
  return createStore<ViewerStoreState>()((set, get) => ({
    index: buildGraphIndex(view),
    defaultName,
    activeName: null,
    panels: openOnFirstActivation(new Map(), defaultName),
    focusRequest: null,
    hoveredNodeId: null,
    causalNodeIds: null,
    activate: (activeName) => {
      const { panels } = get();
      if (get().activeName === activeName) return;
      set({ activeName, panels: openOnFirstActivation(panels, activeName) });
    },
    setPanelOpen: (name, open) => {
      const panels = new Map(get().panels).set(name, open);
      if (open) set({ panels, activeName: name, focusRequest: { name } });
      else set({ panels });
    },
    hover: (nodeId) => {
      const { index, hoveredNodeId, panels } = get();
      if (hoveredNodeId === nodeId) return;
      const activeName = index.nodes.get(nodeId)?.component ?? null;
      set({
        hoveredNodeId: nodeId,
        activeName,
        panels: openOnFirstActivation(panels, activeName),
        causalNodeIds: getCausalNodeIds(index, nodeId),
      });
    },
    leave: () => {
      if (get().hoveredNodeId !== null) set({ hoveredNodeId: null, causalNodeIds: null });
    },
  }));
};

export const ViewerStoreContext = createContext<ViewerStore | null>(null);

export const useViewerStoreApi = (): ViewerStore => {
  const store = useContext(ViewerStoreContext);
  if (!store) throw new Error("useViewerStore must be used inside <Viewer>");
  return store;
};

export const useViewerStore = <Selected>(
  selector: (state: ViewerStoreState) => Selected,
): Selected => useStore(useViewerStoreApi(), selector);

export const useIsHovered = (nodeId: string): boolean =>
  useViewerStore((state) => state.hoveredNodeId === nodeId);

export const useHoveredNode = (): GraphNode | null =>
  useViewerStore((state) =>
    state.hoveredNodeId === null ? null : (state.index.nodes.get(state.hoveredNodeId) ?? null),
  );

export const useIsDimmed = (nodeIds: string[]): boolean =>
  useViewerStore(
    (state) =>
      state.causalNodeIds !== null &&
      nodeIds.length > 0 &&
      !nodeIds.some((nodeId) => state.causalNodeIds?.has(nodeId)),
  );

export const useIsInactive = (component: string): boolean =>
  useViewerStore((state) => state.activeName !== null && component !== state.activeName);

export const useIsCausalEdge = (from: string, to: string): boolean =>
  useViewerStore(
    (state) =>
      state.causalNodeIds !== null && state.causalNodeIds.has(from) && state.causalNodeIds.has(to),
  );

export const useHasHover = (): boolean => useViewerStore((state) => state.causalNodeIds !== null);

export const useFocusListener = (onFocus: (name: string) => void): void => {
  const store = useViewerStoreApi();
  useEffect(
    () =>
      store.subscribe((state, previous) => {
        if (state.focusRequest !== null && state.focusRequest !== previous.focusRequest)
          onFocus(state.focusRequest.name);
      }),
    [store, onFocus],
  );
};
