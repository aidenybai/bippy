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
import type { GraphNode, ViewComponent, ViewFile } from "../model";
import { useHoverStore } from "../store/hover";
import { isViewMode, type ViewMode } from "../lib/view-mode";

export interface ViewerState {
  file: string | null;
  openFile: (file: string) => void;
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  view: ViewFile | null;
  viewError: string | null;
  isViewLoading: boolean;
  index: GraphIndex | null;
  colorByNodeId: Map<string, string>;
}

const ViewerContext = createContext<ViewerState | null>(null);

const readFile = (): string | null => new URLSearchParams(window.location.search).get("file");

const readMode = (): ViewMode => {
  const value = new URLSearchParams(window.location.search).get("view");
  return isViewMode(value) ? value : "code";
};

const writeLocation = (file: string | null, mode: ViewMode): void => {
  const url = new URL(window.location.href);
  if (file) url.searchParams.set("file", file);
  else url.searchParams.delete("file");
  if (mode !== "code") url.searchParams.set("view", mode);
  else url.searchParams.delete("view");
  window.history.replaceState(null, "", url);
};

export const ViewerProvider = ({ children }: { children: ReactNode }) => {
  const [file, setFile] = useState<string | null>(readFile);
  const [mode, setMode] = useState<ViewMode>(readMode);
  const viewQuery = useView(file);
  const view = viewQuery.data ?? null;
  const setIndex = useHoverStore((state) => state.setIndex);
  const index = useMemo(() => (view ? buildGraphIndex(view) : null), [view]);
  const colorByNodeId = useMemo(
    () => (view ? getColorByNodeId(view) : new Map<string, string>()),
    [view],
  );
  useEffect(() => writeLocation(file, mode), [file, mode]);
  useEffect(() => setIndex(index), [index, setIndex]);
  const openFile = useCallback((nextFile: string) => setFile(nextFile), []);
  const value = useMemo<ViewerState>(
    () => ({
      file,
      openFile,
      mode,
      setMode,
      view,
      viewError: viewQuery.error?.message ?? null,
      isViewLoading: viewQuery.isLoading,
      index,
      colorByNodeId,
    }),
    [file, openFile, mode, view, viewQuery.error, viewQuery.isLoading, index, colorByNodeId],
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

export const useLoadedComponent = (): ViewComponent => {
  const component = useActiveComponent();
  if (!component) throw new Error("useLoadedComponent needs an active component");
  return component;
};

export const useHoveredNode = (): GraphNode | null => {
  const { index } = useViewer();
  const hoveredNodeId = useHoverStore((state) => state.hoveredNodeId);
  return hoveredNodeId !== null ? (index?.nodes.get(hoveredNodeId) ?? null) : null;
};
