"use client";

import { DiagramRoot } from "./diagram-root";
import {
  DiagramCanvas,
  DiagramNode,
  DiagramEdge,
  DiagramScope,
  type DiagramNodeProps,
} from "./primitives";

export interface DiagramDetailProps extends Omit<DiagramNodeProps, "variant"> {}
export const DiagramDetail = (props: DiagramDetailProps) => (
  <DiagramNode {...props} variant="detail" />
);

export const Diagram = {
  Root: DiagramRoot,
  Canvas: DiagramCanvas,
  Node: DiagramNode,
  Detail: DiagramDetail,
  Edge: DiagramEdge,
  Scope: DiagramScope,
};
export { DiagramRoot };
export type { DiagramRootProps } from "./diagram-root";
