"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { getTreeHighlight, type TreeHighlight, type TreeHighlightIndex } from "./tree-highlight";

export interface DiagramInteraction extends TreeHighlight {
  highlightedEdgeIds?: ReadonlySet<string>;
  activeId: string | null;
  setHoveredId: (nodeId: string | null) => void;
  setFocusedId: (nodeId: string | null) => void;
  setIsKeyboardNavigation: (isKeyboardNavigation: boolean) => void;
}

export const DiagramInteractionContext = createContext<DiagramInteraction | null>(null);
export const useDiagramInteraction = () => useContext(DiagramInteractionContext);

export interface DiagramInteractionOptions {
  activeId?: string | null;
  defaultActiveId?: string | null;
  onActiveIdChange?: (nodeId: string | null) => void;
  inherit?: boolean;
}

interface DiagramInputState {
  hoveredId: string | null;
  focusedId: string | null;
  isKeyboardNavigation: boolean;
}

const getActiveId = (state: DiagramInputState) =>
  state.isKeyboardNavigation ? state.focusedId : state.hoveredId;

export const useDiagramInteractionState = (
  index?: TreeHighlightIndex,
  relationship: "parent" | "owner" = "parent",
  options: DiagramInteractionOptions = {},
): DiagramInteraction => {
  const parent = useDiagramInteraction();
  const inherited = options.inherit === false ? null : parent;
  const [input, setInput] = useState<DiagramInputState>(() => ({
    hoveredId: options.defaultActiveId ?? options.activeId ?? null,
    focusedId: null,
    isKeyboardNavigation: false,
  }));
  const inputRef = useRef(input);
  const updateInput = useCallback(
    (patch: Partial<DiagramInputState>) => {
      const previous = inputRef.current;
      const next = { ...previous, ...patch };
      if (
        previous.hoveredId === next.hoveredId &&
        previous.focusedId === next.focusedId &&
        previous.isKeyboardNavigation === next.isKeyboardNavigation
      )
        return;
      inputRef.current = next;
      setInput(next);
      if (getActiveId(previous) !== getActiveId(next))
        options.onActiveIdChange?.(getActiveId(next));
    },
    [options.onActiveIdChange],
  );
  const setHoveredId = useCallback(
    (nodeId: string | null) => updateInput({ hoveredId: nodeId }),
    [updateInput],
  );
  const setFocusedId = useCallback(
    (nodeId: string | null) => updateInput({ focusedId: nodeId }),
    [updateInput],
  );
  const setIsKeyboardNavigation = useCallback(
    (isKeyboardNavigation: boolean) => updateInput({ isKeyboardNavigation }),
    [updateInput],
  );
  const activeId =
    options.activeId !== undefined
      ? options.activeId
      : inherited
        ? inherited.activeId
        : getActiveId(input);
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
  }, [
    activeId,
    inherited,
    index,
    relationship,
    setHoveredId,
    setFocusedId,
    setIsKeyboardNavigation,
  ]);
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
  edgeId?: string,
) => {
  if (!interaction || interaction.activeId === null || interaction.mode === "boundary") return true;
  if (interaction.highlightedEdgeIds && edgeId) return interaction.highlightedEdgeIds.has(edgeId);
  if (interaction.mode === "owner" || interaction.mode === "flow")
    return (
      fromId !== undefined &&
      toId !== undefined &&
      getIsNodeHighlighted(interaction, fromId) &&
      getIsNodeHighlighted(interaction, toId)
    );
  return interaction.activeId === fromId || interaction.activeId === toId;
};
