import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { getColorByNodeId } from "../lib/analysis";
import type { GraphNode, ViewComponent } from "../model";

export interface ViewerState {
  component: ViewComponent;
  colorByNodeId: Map<string, string>;
  hoveredNodeId: string | null;
  hoveredNode: GraphNode | null;
  hover: (nodeId: string | null) => void;
}

const ViewerContext = createContext<ViewerState | null>(null);

export const ViewerProvider = ({
  component,
  children,
}: {
  component: ViewComponent;
  children: ReactNode;
}) => {
  const [hoveredNodeId, hover] = useState<string | null>(null);
  const colorByNodeId = useMemo(() => getColorByNodeId(component), [component]);
  const hoveredNode = useMemo(
    () => component.graph.nodes.find((node) => node.id === hoveredNodeId) ?? null,
    [component, hoveredNodeId],
  );
  const value = useMemo(
    () => ({ component, colorByNodeId, hoveredNodeId, hoveredNode, hover }),
    [component, colorByNodeId, hoveredNodeId, hoveredNode],
  );
  return <ViewerContext value={value}>{children}</ViewerContext>;
};

export const useViewer = (): ViewerState => {
  const state = useContext(ViewerContext);
  if (!state) throw new Error("useViewer must be used inside <Viewer>");
  return state;
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
