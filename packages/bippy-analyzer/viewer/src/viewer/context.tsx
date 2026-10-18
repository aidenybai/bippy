import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useFileInfo, useView, type ViewKey } from "../hooks/queries";
import { getColorByNodeId } from "../lib/analysis";
import type { GraphNode, ViewComponent } from "../model";

export interface Selection {
  file: string | null;
  component: string | null;
}

export interface ViewerState {
  selection: Selection;
  select: (change: Partial<Selection>) => void;
  view: ViewComponent | null;
  viewError: string | null;
  isViewLoading: boolean;
  colorByNodeId: Map<string, string>;
  hoveredNodeId: string | null;
  hoveredNode: GraphNode | null;
  hover: (nodeId: string | null) => void;
}

const ViewerContext = createContext<ViewerState | null>(null);

const readSelection = (): Selection => {
  const query = new URLSearchParams(window.location.search);
  return { file: query.get("file"), component: query.get("component") };
};

const writeSelection = (selection: Selection): void => {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(selection))
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  window.history.replaceState(null, "", url);
};

const getViewKey = ({ file, component }: Selection): ViewKey | null =>
  file && component ? { file, component } : null;

export const ViewerProvider = ({ children }: { children: ReactNode }) => {
  const [selection, setSelection] = useState<Selection>(readSelection);
  const [hoveredNodeId, hover] = useState<string | null>(null);
  const fileInfo = useFileInfo(selection.file);
  const firstComponent = useMemo(
    () =>
      [...(fileInfo.data?.components ?? [])].sort((a, b) => b.stateCount - a.stateCount)[0]?.name ??
      null,
    [fileInfo.data],
  );
  const resolved = useMemo(
    () => ({ ...selection, component: selection.component ?? firstComponent }),
    [selection, firstComponent],
  );
  const viewQuery = useView(getViewKey(resolved));
  const view = viewQuery.data ?? null;
  const select = useCallback((change: Partial<Selection>) => {
    setSelection((current) => ({ ...current, ...change }));
    hover(null);
  }, []);
  useEffect(() => writeSelection(selection), [selection]);
  const colorByNodeId = useMemo(
    () => (view ? getColorByNodeId(view) : new Map<string, string>()),
    [view],
  );
  const hoveredNode = useMemo(
    () => view?.graph.nodes.find((node) => node.id === hoveredNodeId) ?? null,
    [view, hoveredNodeId],
  );
  const value = useMemo<ViewerState>(
    () => ({
      selection,
      select,
      view,
      viewError: (fileInfo.error ?? viewQuery.error)?.message ?? null,
      isViewLoading: fileInfo.isLoading || viewQuery.isLoading,
      colorByNodeId,
      hoveredNodeId,
      hoveredNode,
      hover,
    }),
    [
      selection,
      select,
      view,
      fileInfo.error,
      fileInfo.isLoading,
      viewQuery.error,
      viewQuery.isLoading,
      colorByNodeId,
      hoveredNodeId,
      hoveredNode,
    ],
  );
  return <ViewerContext value={value}>{children}</ViewerContext>;
};

export const useViewer = (): ViewerState => {
  const state = useContext(ViewerContext);
  if (!state) throw new Error("useViewer must be used inside <Viewer>");
  return state;
};

export const useLoadedView = (): ViewComponent => {
  const { view } = useViewer();
  if (!view) throw new Error("useLoadedView needs a loaded view");
  return view;
};

export const useNodeColor = (nodeId: string | undefined): string | undefined => {
  const { colorByNodeId } = useViewer();
  return nodeId ? colorByNodeId.get(nodeId) : undefined;
};

export const useIsDimmed = (nodeId: string | undefined): boolean => {
  const { colorByNodeId, hoveredNodeId } = useViewer();
  if (!hoveredNodeId || !nodeId) return false;
  return colorByNodeId.get(hoveredNodeId) !== colorByNodeId.get(nodeId);
};
