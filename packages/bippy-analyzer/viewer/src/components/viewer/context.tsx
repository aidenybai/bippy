import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getColorByNodeId } from "@/lib/colors";
import { buildGraphIndex, getDefaultComponent, type GraphIndex } from "@/lib/graph";
import { getRouteHref } from "@/lib/route";
import type { ViewMode } from "@/lib/view-mode";
import type { Example, GraphNode, ViewComponent, ViewFile } from "@/model";
import { useHoverStore } from "@/store/hover";

interface ViewerState {
  examples: Example[];
  name: string | null;
  mode: ViewMode;
  view: ViewFile | null;
  json: string | null;
  setMode: (mode: ViewMode) => void;
  index: GraphIndex | null;
  colorByNodeId: Map<string, string>;
}

const ViewerContext = createContext<ViewerState | null>(null);

interface ViewerProviderProps {
  examples: Example[];
  name: string | null;
  mode: ViewMode;
  view: ViewFile | null;
  json: string | null;
  children: ReactNode;
}

export const ViewerProvider = ({
  examples,
  name,
  mode,
  view,
  json,
  children,
}: ViewerProviderProps) => {
  const router = useRouter();
  const setIndex = useHoverStore((state) => state.setIndex);
  const index = useMemo(() => (view ? buildGraphIndex(view) : null), [view]);
  const colorByNodeId = useMemo(
    () => (view ? getColorByNodeId(view) : new Map<string, string>()),
    [view],
  );
  useEffect(() => setIndex(index), [index, setIndex]);
  const setMode = useCallback(
    (next: ViewMode) => router.replace(getRouteHref(name, next)),
    [router, name],
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
