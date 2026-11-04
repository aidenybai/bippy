import { useLayoutEffect, useState, type RefObject } from "react";
import {
  createLineLookup,
  getBoundingBox,
  getLinesBox,
  getLocationBox,
  getRangeRows,
  type Box,
} from "@/lib/positions";
import type { GraphNode } from "@/model";

export interface PlacedToken {
  node: GraphNode;
  box: Box;
  rows: Box[];
  anchorBox: Box | null;
  isMultiLine: boolean;
}

const measure = (wrapper: HTMLElement, nodes: GraphNode[]): PlacedToken[] => {
  const host = wrapper.querySelector<HTMLElement>("diffs-container");
  if (!host) return [];
  const lookup = createLineLookup(host, wrapper);
  return nodes.flatMap((node) => {
    const isMultiLine = node.loc.start.line !== node.loc.end.line;
    const rows = getRangeRows(lookup, node.loc);
    const box = isMultiLine ? getLinesBox(lookup, node.loc) : getBoundingBox(rows);
    const anchorBox = node.anchor ? getLocationBox(lookup, node.anchor) : null;
    return box && box.height > 0 ? [{ node, box, rows, anchorBox, isMultiLine }] : [];
  });
};

export const useTokenBoxes = (
  wrapperRef: RefObject<HTMLElement | null>,
  nodes: GraphNode[],
  renderCount: number,
): PlacedToken[] => {
  const [tokens, setTokens] = useState<PlacedToken[]>([]);
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const update = (): void => setTokens(measure(wrapper, nodes));
    update();
    document.fonts.ready.then(update);
    const observer = new ResizeObserver(update);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [wrapperRef, nodes, renderCount]);
  return tokens;
};
