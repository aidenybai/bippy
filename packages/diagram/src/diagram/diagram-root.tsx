"use client";

import { NodeContext } from "./node-context";
import type { ReactNode } from "react";
import {
  DiagramInteractionContext,
  useDiagramInteractionState,
  type DiagramInteractionOptions,
} from "./interaction";

export interface DiagramRootProps extends Omit<DiagramInteractionOptions, "inherit"> {
  children: ReactNode;
}

export const DiagramRoot = ({ children, ...options }: DiagramRootProps) => {
  const interaction = useDiagramInteractionState(undefined, "parent", {
    ...options,
    inherit: false,
  });
  return (
    <NodeContext value={null}>
      <DiagramInteractionContext value={interaction}>{children}</DiagramInteractionContext>
    </NodeContext>
  );
};
