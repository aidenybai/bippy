import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useView } from "@/hooks/queries";
import { getColorByNodeId } from "@/lib/colors";
import { buildGraphIndex, getDefaultComponent, type GraphIndex } from "@/lib/graph";
import { useLocation, writeLocation } from "@/lib/source";
import type { ViewMode } from "@/lib/view-mode";
import type { Example, GraphNode, ViewComponent, ViewFile } from "@/model";
import { useHoverStore } from "@/store/hover";

export interface ViewerState {
  examples: Example[];
  file: string | null;
  open: (file: string | null) => void;
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  view: ViewFile | null;
  viewError: string | null;
  isViewLoading: boolean;
  index: GraphIndex | null;
  colorByNodeId: Map<string, string>;
}

const ViewerContext = createContext<ViewerState | null>(null);

interface ViewerProviderProps {
  examples: Example[];
  children: ReactNode;
}

export const ViewerProvider = ({ examples, children }: ViewerProviderProps) => {
  const location = useLocation();
  const { file, mode } = location;
  const viewQuery = useView(file);
  const view = viewQuery.data ?? null;
  const setIndex = useHoverStore((state) => state.setIndex);
  const index = useMemo(() => (view ? buildGraphIndex(view) : null), [view]);
  const colorByNodeId = useMemo(
    () => (view ? getColorByNodeId(view) : new Map<string, string>()),
    [view],
  );
  useEffect(() => setIndex(index), [index, setIndex]);
  const open = useCallback(
    (next: string | null) => writeLocation({ file: next, mode: "code" }),
    [],
  );
  const setMode = useCallback((next: ViewMode) => writeLocation({ file, mode: next }), [file]);
  const value = useMemo<ViewerState>(
    () => ({
      examples,
      file,
      open,
      mode,
      setMode,
      view,
      viewError: viewQuery.error?.message ?? null,
      isViewLoading: viewQuery.isLoading,
      index,
      colorByNodeId,
    }),
    [
      examples,
      file,
      open,
      mode,
      setMode,
      view,
      viewQuery.error,
      viewQuery.isLoading,
      index,
      colorByNodeId,
    ],
  );
  return <ViewerContext value={value}>{children}</ViewerContext>;
};

export const useViewer = (): ViewerState => {
  const state = useContext(ViewerContext);
  if (!state) throw new Error("useViewer must be used inside <Viewer>");
  return state;
};

export const useLoadedView = (): ViewFile => {
  const { view } = useViewer();
  if (!view) throw new Error("useLoadedView needs a loaded view");
  return view;
};

export const useActiveComponent = (): ViewComponent | null => {
  const { view } = useViewer();
  const activeName = useHoverStore((state) => state.activeName);
  return useMemo(() => {
    if (!view) return null;
    return (
      view.components.find((component) => component.name === activeName) ??
      getDefaultComponent(view)
    );
  }, [view, activeName]);
};

export const useHoveredNode = (): GraphNode | null => {
  const { index } = useViewer();
  const hoveredNodeId = useHoverStore((state) => state.hoveredNodeId);
  return hoveredNodeId !== null ? (index?.nodes.get(hoveredNodeId) ?? null) : null;
};
