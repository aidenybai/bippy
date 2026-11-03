import { createContext, useContext, useEffect, type ReactNode } from "react";
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
  const index = buildGraphIndex(view);
  const colorByNodeId = getColorByNodeId(view);
  useEffect(() => setIndex(index), [index, setIndex]);
  const setMode = (next: ViewMode) =>
    window.history.replaceState(null, "", getRouteHref(name, next));
  return (
    <ViewerContext value={{ examples, name, mode, view, json, setMode, index, colorByNodeId }}>
      {children}
    </ViewerContext>
  );
};

export const useViewer = (): ViewerState => {
  const state = useContext(ViewerContext);
  if (!state) throw new Error("useViewer must be used inside <Viewer>");
  return state;
};

export const useActiveComponent = (): ViewComponent | null => {
  const { view } = useViewer();
  const activeName = useHoverStore((state) => state.activeName);
  return (
    view.components.find((component) => component.name === activeName) ?? getDefaultComponent(view)
  );
};

export const useHoveredNode = (): GraphNode | null => {
  const { index } = useViewer();
  const hoveredNodeId = useHoverStore((state) => state.hoveredNodeId);
  return hoveredNodeId !== null ? (index.nodes.get(hoveredNodeId) ?? null) : null;
};
