import { createContext, useContext, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { getColorByNodeId } from "@/lib/colors";
import { hasInspectorContent } from "@/lib/graph";
import { getPathMode, getRouteHref } from "@/lib/route";
import type { ViewMode } from "@/lib/view-mode";
import type { Example, ViewFile } from "@/model";
import { ViewerStoreContext, createViewerStore } from "@/store/viewer";

interface ViewerState {
  examples: Example[];
  name: string;
  mode: ViewMode;
  view: ViewFile;
  json: string;
  setMode: (mode: ViewMode) => void;
  colorByNodeId: Map<string, string>;
  hasInspector: boolean;
  canShowInspector: boolean;
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
  const hasInspector = hasInspectorContent(view);
  const canShowInspector = hasInspector && mode !== "json";
  const setMode = (next: ViewMode) =>
    window.history.replaceState(null, "", getRouteHref(name, next));
  return (
    <ViewerContext
      value={{
        examples,
        name,
        mode,
        view,
        json,
        setMode,
        colorByNodeId,
        hasInspector,
        canShowInspector,
      }}
    >
      <ViewerStoreContext value={store}>{children}</ViewerStoreContext>
    </ViewerContext>
  );
};

export const useViewer = (): ViewerState => {
  const state = useContext(ViewerContext);
  if (!state) throw new Error("useViewer must be used inside <Viewer>");
  return state;
};
