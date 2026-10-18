import { useLayoutEffect, useState, type RefObject } from "react";
import { getLinesBox, getLocationBox, type Box } from "../lib/positions";
import type { GraphNode } from "../model";

export interface PlacedToken {
  node: GraphNode;
  box: Box;
  isMultiLine: boolean;
}

export interface TokenLayout {
  tokens: PlacedToken[];
  width: number;
  height: number;
}

const EMPTY_LAYOUT: TokenLayout = { tokens: [], width: 0, height: 0 };

const measure = (container: HTMLElement, nodes: GraphNode[]): TokenLayout => ({
  tokens: nodes.flatMap((node) => {
    const isMultiLine = node.loc.start.line !== node.loc.end.line;
    const box = isMultiLine
      ? getLinesBox(container, node.loc)
      : getLocationBox(container, node.loc);
    return box && box.height > 0 ? [{ node, box, isMultiLine }] : [];
  }),
  width: container.clientWidth,
  height: container.clientHeight,
});

export const useTokenBoxes = (
  containerRef: RefObject<HTMLElement | null>,
  nodes: GraphNode[],
  isReady: boolean,
): TokenLayout => {
  const [layout, setLayout] = useState<TokenLayout>(EMPTY_LAYOUT);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !isReady) return;
    const update = (): void => setLayout(measure(container, nodes));
    update();
    document.fonts.ready.then(update);
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, nodes, isReady]);
  return layout;
};
