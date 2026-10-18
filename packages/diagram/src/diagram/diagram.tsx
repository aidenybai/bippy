"use client";

import { DiagramLabel, DiagramDescription } from "./node-slots";
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
  Label: DiagramLabel,
  Description: DiagramDescription,
};
export { DiagramRoot, DiagramLabel, DiagramDescription };
export type { DiagramLabelProps, DiagramDescriptionProps } from "./node-slots";
export type { DiagramRootProps } from "./diagram-root";
