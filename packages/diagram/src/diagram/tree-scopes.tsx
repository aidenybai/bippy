"use client";

import type { ComponentPropsWithRef } from "react";
import { DiagramScope } from "./primitives";
import { useTreeView } from "./tree-context";

export interface TreeScopesProps extends Omit<ComponentPropsWithRef<"g">, "children"> {}

export const TreeScopes = (props: TreeScopesProps) => {
  const {
    positions,
    offsets,
    rows,
    interaction,
    activeNode,
    width,
    relationship,
    scopeIndex,
    scopeId,
    scopeLabel,
  } = useTreeView();
  return (
    <g data-slot="tree-scopes" {...props} aria-hidden="true">
      {scopeIndex !== undefined && (
        <DiagramScope
          x={positions[scopeIndex].x - 12}
          y={offsets[scopeIndex]}
          width={width - positions[scopeIndex].x + 4}
          height={offsets[rows[scopeIndex].subtreeEnd] - offsets[scopeIndex]}
          label={scopeLabel}
          nodeId={scopeId}
        />
      )}
      {relationship === "parent" &&
        interaction.catchRanges.map((range, index) => (
          <DiagramScope
            key={range.start}
            kind="boundary"
            x={positions[range.start].x - 12}
            y={offsets[range.start]}
            width={width - positions[range.start].x + 4}
            height={offsets[range.end] - offsets[range.start]}
            label={
              index === 0
                ? `catches: ${activeNode?.label ?? ""} ${activeNode?.annotation ?? ""}`
                : ""
            }
          />
        ))}
    </g>
  );
};
