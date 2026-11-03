import { createContext, useContext, useEffect } from "react";
import { createStore, useStore, type StoreApi } from "zustand";
import { buildGraphIndex, getCausalNodeIds, type GraphIndex } from "@/lib/graph";
import type { GraphNode, ViewFile } from "@/model";

interface FocusRequest {
  name: string;
}

interface ViewerStoreState {
  index: GraphIndex;
  activeName: string | null;
  focusRequest: FocusRequest | null;
  hoveredNodeId: string | null;
  causalNodeIds: Set<string> | null;
  activate: (name: string) => void;
  focus: (name: string) => void;
  hover: (nodeId: string) => void;
  leave: () => void;
}

export type ViewerStore = StoreApi<ViewerStoreState>;

export const createViewerStore = (view: ViewFile): ViewerStore =>
  createStore<ViewerStoreState>()((set, get) => ({
    index: buildGraphIndex(view),
    activeName: null,
    focusRequest: null,
    hoveredNodeId: null,
    causalNodeIds: null,
    activate: (activeName) => {
      if (get().activeName !== activeName) set({ activeName });
    },
    focus: (name) => set({ activeName: name, focusRequest: { name } }),
    hover: (nodeId) => {
      const { index, hoveredNodeId } = get();
      if (hoveredNodeId === nodeId) return;
      set({
        hoveredNodeId: nodeId,
        activeName: index.nodes.get(nodeId)?.component ?? null,
        causalNodeIds: getCausalNodeIds(index, nodeId),
      });
    },
    leave: () => {
      if (get().hoveredNodeId !== null) set({ hoveredNodeId: null, causalNodeIds: null });
    },
  }));

export const ViewerStoreContext = createContext<ViewerStore | null>(null);

const useViewerStoreApi = (): ViewerStore => {
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
