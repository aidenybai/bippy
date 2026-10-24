import { create } from "zustand";
import { getCausalNodeIds, getComponentName, type GraphIndex } from "@/lib/graph";

export interface TokenAnchor {
  nodeId: string;
  getBoundingClientRect: () => DOMRect;
}

interface FocusRequest {
  name: string;
  id: number;
}

interface HoverState {
  index: GraphIndex | null;
  activeName: string | null;
  focusRequest: FocusRequest | null;
  hoveredNodeId: string | null;
  causalNodeIds: Set<string> | null;
  anchor: TokenAnchor | null;
  setIndex: (index: GraphIndex | null) => void;
  activate: (name: string | null) => void;
  focus: (name: string) => void;
  hover: (nodeId: string, anchor?: TokenAnchor) => void;
  leave: () => void;
}

export const useHoverStore = create<HoverState>((set, get) => ({
  index: null,
  activeName: null,
  focusRequest: null,
  hoveredNodeId: null,
  causalNodeIds: null,
  anchor: null,
  setIndex: (index) =>
    set({ index, activeName: null, hoveredNodeId: null, causalNodeIds: null, anchor: null }),
  activate: (activeName) => {
    if (get().activeName !== activeName) set({ activeName });
  },
  focus: (name) =>
    set((state) => ({
      activeName: name,
      focusRequest: { name, id: (state.focusRequest?.id ?? 0) + 1 },
    })),
  hover: (nodeId, anchor) => {
    const { index, hoveredNodeId } = get();
    if (hoveredNodeId === nodeId) return;
    set({
      hoveredNodeId: nodeId,
      activeName: getComponentName(nodeId),
      causalNodeIds: index ? getCausalNodeIds(index, nodeId) : null,
      anchor: anchor ?? null,
    });
  },
  leave: () => {
    if (get().hoveredNodeId !== null)
      set({ hoveredNodeId: null, causalNodeIds: null, anchor: null });
  },
}));

export const useIsHovered = (nodeId: string): boolean =>
  useHoverStore((state) => state.hoveredNodeId === nodeId);

export const useIsDimmed = (nodeIds: string[]): boolean =>
  useHoverStore(
    (state) =>
      state.causalNodeIds !== null &&
      nodeIds.length > 0 &&
      !nodeIds.some((nodeId) => state.causalNodeIds?.has(nodeId)),
  );

export const useIsInactive = (nodeId: string): boolean =>
  useHoverStore(
    (state) => state.activeName !== null && getComponentName(nodeId) !== state.activeName,
  );

export const useIsCausalEdge = (from: string, to: string): boolean =>
  useHoverStore(
    (state) =>
      state.causalNodeIds !== null && state.causalNodeIds.has(from) && state.causalNodeIds.has(to),
  );

export const useHasHover = (): boolean => useHoverStore((state) => state.causalNodeIds !== null);
