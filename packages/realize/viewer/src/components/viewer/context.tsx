import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { getColorByNodeId } from "@/lib/colors";
import { buildGraphIndex, getDefaultComponent, type GraphIndex } from "@/lib/graph";
import { getPathMode, getRouteHref } from "@/lib/route";
import type { ViewMode } from "@/lib/view-mode";
import type { Example, GraphNode, ViewComponent, ViewFile } from "@/model";
import { useHoverStore } from "@/store/hover";

interface ViewerState {
  examples: Example[];
  name: string;
  mode: ViewMode;
  view: ViewFile;
  json: string;
  setMode: (mode: ViewMode) => void;
  index: GraphIndex;
  colorByNodeId: Map<string, string>;
}

const ViewerContext = createContext<ViewerState | null>(null);

interface ViewerProviderProps {
  examples: Example[];
  name: string;
  view: ViewFile;
  json: string;
  children: ReactNode;
}

export const ViewerProvider = ({ examples, name, view, json, children }: ViewerProviderProps) => {
  const mode = getPathMode(usePathname());
  const setIndex = useHoverStore((state) => state.setIndex);
  const index = useMemo(() => buildGraphIndex(view), [view]);
  const colorByNodeId = useMemo(() => getColorByNodeId(view), [view]);
  useEffect(() => setIndex(index), [index, setIndex]);
  const setMode = useCallback(
    (next: ViewMode) => window.history.replaceState(null, "", getRouteHref(name, next)),
    [name],
  );
  const value = useMemo<ViewerState>(
    () => ({ examples, name, mode, view, json, setMode, index, colorByNodeId }),
    [examples, name, mode, view, json, setMode, index, colorByNodeId],
  );
  return <ViewerContext value={value}>{children}</ViewerContext>;
};

export const useViewer = (): ViewerState => {
  const state = useContext(ViewerContext);
  if (!state) throw new Error("useViewer must be used inside <Viewer>");
  return state;
};

export const useActiveComponent = (): ViewComponent | null => {
  const { view } = useViewer();
  const activeName = useHoverStore((state) => state.activeName);
  return useMemo(() => {
    return (
      view.components.find((component) => component.name === activeName) ??
      getDefaultComponent(view)
    );
  }, [view, activeName]);
};

export const useHoveredNode = (): GraphNode | null => {
  const { index } = useViewer();
  const hoveredNodeId = useHoverStore((state) => state.hoveredNodeId);
  return hoveredNodeId !== null ? (index.nodes.get(hoveredNodeId) ?? null) : null;
};
