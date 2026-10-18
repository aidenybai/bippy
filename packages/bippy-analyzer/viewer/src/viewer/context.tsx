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
import { findNode, getColorByNodeId, getComponentName, getDefaultComponent } from "../lib/analysis";
import type { GraphNode, ViewComponent, ViewFile } from "../model";

export interface ViewerState {
  file: string | null;
  openFile: (file: string) => void;
  view: ViewFile | null;
  viewError: string | null;
  isViewLoading: boolean;
  activeComponent: ViewComponent | null;
  activate: (name: string) => void;
  colorByNodeId: Map<string, string>;
  hoveredNodeId: string | null;
  hoveredNode: GraphNode | null;
  hover: (nodeId: string | null) => void;
}

const ViewerContext = createContext<ViewerState | null>(null);

const readFile = (): string | null => new URLSearchParams(window.location.search).get("file");

const writeFile = (file: string | null): void => {
  const url = new URL(window.location.href);
  if (file) url.searchParams.set("file", file);
  else url.searchParams.delete("file");
  window.history.replaceState(null, "", url);
};

const useActiveComponent = (
  view: ViewFile | null,
): [ViewComponent | null, (name: string | null) => void] => {
  const [activeName, setActiveName] = useState<string | null>(null);
  const activeComponent = useMemo(() => {
    if (!view) return null;
    return (
      view.components.find((component) => component.name === activeName) ??
      getDefaultComponent(view)
    );
  }, [view, activeName]);
  return [activeComponent, setActiveName];
};

export const ViewerProvider = ({ children }: { children: ReactNode }) => {
  const [file, setFile] = useState<string | null>(readFile);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const viewQuery = useView(file);
  const view = viewQuery.data ?? null;
  const [activeComponent, setActiveName] = useActiveComponent(view);
  useEffect(() => writeFile(file), [file]);
  const openFile = useCallback(
    (nextFile: string) => {
      setFile(nextFile);
      setActiveName(null);
      setHoveredNodeId(null);
    },
    [setActiveName],
  );
  const hover = useCallback(
    (nodeId: string | null) => {
      setHoveredNodeId(nodeId);
      if (nodeId !== null) setActiveName(getComponentName(nodeId));
    },
    [setActiveName],
  );
  const colorByNodeId = useMemo(
    () => (view ? getColorByNodeId(view) : new Map<string, string>()),
    [view],
  );
  const hoveredNode = useMemo(
    () => (view ? findNode(view, hoveredNodeId) : null),
    [view, hoveredNodeId],
  );
  const value = useMemo<ViewerState>(
    () => ({
      file,
      openFile,
      view,
      viewError: viewQuery.error?.message ?? null,
      isViewLoading: viewQuery.isLoading,
      activeComponent,
      activate: setActiveName,
      colorByNodeId,
      hoveredNodeId,
      hoveredNode,
      hover,
    }),
    [
      file,
      openFile,
      view,
      viewQuery.error,
      viewQuery.isLoading,
      activeComponent,
      setActiveName,
      colorByNodeId,
      hoveredNodeId,
      hoveredNode,
      hover,
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

export const useLoadedComponent = (): ViewComponent => {
  const { activeComponent } = useViewer();
  if (!activeComponent) throw new Error("useLoadedComponent needs an active component");
  return activeComponent;
};

export const useNodeColor = (nodeId: string | undefined): string | undefined => {
  const { colorByNodeId } = useViewer();
  return nodeId ? colorByNodeId.get(nodeId) : undefined;
};

export const useIsDimmed = (nodeId: string | undefined): boolean => {
  const { colorByNodeId, hoveredNodeId } = useViewer();
  if (!hoveredNodeId || !nodeId) return false;
  return (
    getComponentName(hoveredNodeId) !== getComponentName(nodeId) ||
    colorByNodeId.get(hoveredNodeId) !== colorByNodeId.get(nodeId)
  );
};

export const useIsInactive = (nodeId: string): boolean => {
  const { activeComponent } = useViewer();
  return activeComponent !== null && getComponentName(nodeId) !== activeComponent.name;
};
