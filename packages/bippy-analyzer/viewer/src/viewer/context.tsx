import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useView } from "../hooks/queries";
import { getColorByNodeId } from "../lib/colors";
import { buildGraphIndex, getDefaultComponent, type GraphIndex } from "../lib/graph";
import { readLocation, writeLocation, type Source } from "../lib/source";
import type { ViewMode } from "../lib/view-mode";
import type { GraphNode, ViewComponent, ViewFile } from "../model";
import { useHoverStore } from "../store/hover";

export interface ViewerState {
  source: Source | null;
  open: (source: Source | null) => void;
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  view: ViewFile | null;
  viewError: string | null;
  isViewLoading: boolean;
  index: GraphIndex | null;
  colorByNodeId: Map<string, string>;
}

const ViewerContext = createContext<ViewerState | null>(null);

export const ViewerProvider = ({ children }: { children: ReactNode }) => {
  const [location, setLocation] = useState(readLocation);
  const { source, mode } = location;
  const viewQuery = useView(source);
  const view = viewQuery.data ?? null;
  const setIndex = useHoverStore((state) => state.setIndex);
  const index = useMemo(() => (view ? buildGraphIndex(view) : null), [view]);
  const colorByNodeId = useMemo(
    () => (view ? getColorByNodeId(view) : new Map<string, string>()),
    [view],
  );
  useEffect(() => writeLocation(location), [location]);
  useEffect(() => setIndex(index), [index, setIndex]);
  const open = useCallback(
    (next: Source | null) => setLocation((current) => ({ ...current, source: next })),
    [],
  );
  const setMode = useCallback(
    (next: ViewMode) => setLocation((current) => ({ ...current, mode: next })),
    [],
  );
  const value = useMemo<ViewerState>(
    () => ({
      source,
      open,
      mode,
      setMode,
      view,
      viewError: viewQuery.error?.message ?? null,
      isViewLoading: viewQuery.isLoading,
      index,
      colorByNodeId,
    }),
    [source, open, mode, setMode, view, viewQuery.error, viewQuery.isLoading, index, colorByNodeId],
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
