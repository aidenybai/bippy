import { useLayoutEffect, useState, type RefObject } from "react";
import {
  createLineLookup,
  getBoundingBox,
  getLinesBox,
  getLocationBox,
  getLocationRows,
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

export interface TokenLayout {
  tokens: PlacedToken[];
  width: number;
  height: number;
}

const EMPTY_LAYOUT: TokenLayout = { tokens: [], width: 0, height: 0 };

const measure = (wrapper: HTMLElement, nodes: GraphNode[]): TokenLayout => {
  const host = wrapper.querySelector<HTMLElement>("diffs-container");
  if (!host) return EMPTY_LAYOUT;
  const lookup = createLineLookup(host, wrapper);
  return {
    tokens: nodes.flatMap((node) => {
      const isMultiLine = node.loc.start.line !== node.loc.end.line;
      const rows = isMultiLine ? [] : getLocationRows(lookup, node.loc);
      const box = isMultiLine ? getLinesBox(lookup, node.loc) : getBoundingBox(rows);
      const anchorBox = node.anchor ? getLocationBox(lookup, node.anchor) : null;
      return box && box.height > 0 ? [{ node, box, rows, anchorBox, isMultiLine }] : [];
    }),
    width: wrapper.clientWidth,
    height: wrapper.clientHeight,
  };
};

export const useTokenBoxes = (
  wrapperRef: RefObject<HTMLElement | null>,
  nodes: GraphNode[],
  renderCount: number,
): TokenLayout => {
  const [layout, setLayout] = useState<TokenLayout>(EMPTY_LAYOUT);
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const update = (): void => setLayout(measure(wrapper, nodes));
    update();
    document.fonts.ready.then(update);
    const observer = new ResizeObserver(update);
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [wrapperRef, nodes, renderCount]);
  return layout;
};
