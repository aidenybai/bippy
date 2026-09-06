"use client";

import { createContext, useContext, useMemo, useState } from "react";
import { getTreeHighlight, type TreeHighlight, type TreeHighlightIndex } from "./tree-highlight";

export interface DiagramInteraction extends TreeHighlight {
  activeId: string | null;
  setHoveredId: (nodeId: string | null) => void;
  setFocusedId: (nodeId: string | null) => void;
  setIsKeyboardNavigation: (isKeyboardNavigation: boolean) => void;
}

export const DiagramInteractionContext = createContext<DiagramInteraction | null>(null);
export const useDiagramInteraction = () => useContext(DiagramInteractionContext);

export const useDiagramInteractionState = (
  index?: TreeHighlightIndex,
  relationship: "parent" | "owner" = "parent",
): DiagramInteraction => {
  const inherited = useDiagramInteraction();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [isKeyboardNavigation, setIsKeyboardNavigation] = useState(false);
  const activeId = inherited ? inherited.activeId : isKeyboardNavigation ? focusedId : hoveredId;
  return useMemo(() => {
    if (inherited && !index) return inherited;
    const highlight: TreeHighlight = index
      ? getTreeHighlight(index, activeId, relationship)
      : { mode: activeId === null ? "none" : "node", highlightedIds: null, catchRanges: [] };
    return {
      ...highlight,
      activeId,
      setHoveredId: inherited?.setHoveredId ?? setHoveredId,
      setFocusedId: inherited?.setFocusedId ?? setFocusedId,
      setIsKeyboardNavigation: inherited?.setIsKeyboardNavigation ?? setIsKeyboardNavigation,
    };
  }, [activeId, inherited, index, relationship]);
};

export const getIsNodeHighlighted = (interaction: DiagramInteraction | null, nodeId: string) =>
  !interaction ||
  interaction.activeId === null ||
  interaction.mode === "boundary" ||
  interaction.activeId === nodeId ||
  Boolean(interaction.highlightedIds?.has(nodeId));

export const getIsEdgeHighlighted = (
  interaction: DiagramInteraction | null,
  fromId?: string,
  toId?: string,
) => {
  if (!interaction || interaction.activeId === null || interaction.mode === "boundary") return true;
  if (interaction.mode === "owner")
    return (
      fromId !== undefined &&
      toId !== undefined &&
      getIsNodeHighlighted(interaction, fromId) &&
      getIsNodeHighlighted(interaction, toId)
    );
  return interaction.activeId === fromId || interaction.activeId === toId;
};
