import { createContext, useContext, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { getColorByNodeId } from "@/lib/colors";
import { getDefaultComponent } from "@/lib/graph";
import { getPathMode, getRouteHref } from "@/lib/route";
import type { ViewMode } from "@/lib/view-mode";
import type { Example, ViewComponent, ViewFile } from "@/model";
import { ViewerStoreContext, createViewerStore, useViewerStore } from "@/store/viewer";

interface ViewerState {
  examples: Example[];
  name: string;
  mode: ViewMode;
  view: ViewFile;
  json: string;
  setMode: (mode: ViewMode) => void;
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
  const [store] = useState(() => createViewerStore(view));
  const colorByNodeId = getColorByNodeId(view);
  const setMode = (next: ViewMode) =>
    window.history.replaceState(null, "", getRouteHref(name, next));
  return (
    <ViewerContext value={{ examples, name, mode, view, json, setMode, colorByNodeId }}>
      <ViewerStoreContext value={store}>{children}</ViewerStoreContext>
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
  const activeName = useViewerStore((state) => state.activeName);
  return (
    view.components.find((component) => component.name === activeName) ?? getDefaultComponent(view)
  );
};
