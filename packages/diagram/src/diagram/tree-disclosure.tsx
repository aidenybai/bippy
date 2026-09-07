"use client";

import * as stylex from "@stylexjs/stylex";
import { useRef, type MouseEvent } from "react";
import { colors } from "./tokens.stylex";

export interface TreeDisclosureProps {
  nodeId: string;
  x: number;
  y: number;
  height: number;
  isExpanded: boolean;
  onToggle: (event: MouseEvent<SVGGElement>, isFocusDriven: boolean) => void;
}

const styles = stylex.create({
  toggle: { cursor: "pointer", color: colors.muted },
  chevron: { opacity: { default: 0, [stylex.when.ancestor(":hover")]: 1 } },
});

export const TreeDisclosure = ({
  nodeId,
  x,
  y,
  height,
  isExpanded,
  onToggle,
}: TreeDisclosureProps) => {
  const pointerType = useRef("mouse");
  return (
    <g
      data-tree-toggle=""
      data-disclosure-for={nodeId}
      onPointerDown={(event) => {
        pointerType.current = event.pointerType;
        event.stopPropagation();
      }}
      data-expanded={isExpanded}
      aria-hidden="true"
      transform={`translate(${x} ${y})`}
      {...stylex.props(styles.toggle)}
      onClick={(event) => {
        event.stopPropagation();
        if (!event.defaultPrevented)
          onToggle(event, event.detail === 0 || pointerType.current !== "mouse");
      }}
    >
      <rect x={-12} y={-height / 2} width={24} height={height} fill="transparent" />
      <path
        {...stylex.props(styles.chevron)}
        d={isExpanded ? "M-4 -2 0 2 4-2" : "M-2 -4 2 0-2 4"}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
      />
    </g>
  );
};
