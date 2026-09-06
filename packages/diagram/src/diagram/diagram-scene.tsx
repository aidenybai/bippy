"use client";

import {
  DiagramCanvas,
  DiagramEdge,
  DiagramNode,
  DiagramScope,
  type DiagramEdgeProps,
  type DiagramScopeProps,
  type Point,
} from "./primitives";
import type { TreeNode } from "./tree-model";
import type { ReactNode } from "react";

export interface SceneNode extends TreeNode, Point {}

export interface SceneEdge {
  id: string;
  from: string;
  to: string;
  kind?: DiagramEdgeProps["kind"];
  label?: string;
  bend?: number;
  side?: DiagramEdgeProps["side"];
  labelPosition?: Point;
  waypoints?: readonly Point[];
  shape?: DiagramEdgeProps["shape"];
  directed?: boolean;
  fromOffset?: Point;
  toOffset?: Point;
}

export interface DiagramSceneProps {
  label: string;
  width: number;
  height: number;
  nodes: readonly SceneNode[];
  edges: readonly SceneEdge[];
  scopes?: readonly DiagramScopeProps[];
  onSelect?: (id: string) => void;
  children?: ReactNode;
}

export const DiagramScene = ({
  label,
  width,
  height,
  nodes,
  edges,
  scopes = [],
  onSelect,
  children,
}: DiagramSceneProps) => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return (
    <DiagramCanvas width={width} height={height} label={label}>
      {scopes.map((scope) => (
        <DiagramScope key={`${scope.label}-${scope.x}`} {...scope} />
      ))}
      {children}
      {edges.map((edge) => {
        const from = nodeById.get(edge.from);
        const to = nodeById.get(edge.to);
        if (!from || !to) throw new Error(`Missing endpoint for edge ${edge.id}`);
        return (
          <DiagramEdge
            key={edge.id}
            {...edge}
            from={
              edge.fromOffset
                ? { x: from.x + edge.fromOffset.x, y: from.y + edge.fromOffset.y }
                : from
            }
            to={edge.toOffset ? { x: to.x + edge.toOffset.x, y: to.y + edge.toOffset.y } : to}
            fromId={edge.from}
            toId={edge.to}
          />
        );
      })}
      {nodes.map((node) => (
        <DiagramNode key={node.id} node={node} x={node.x} y={node.y} onSelect={onSelect} />
      ))}
    </DiagramCanvas>
  );
};
