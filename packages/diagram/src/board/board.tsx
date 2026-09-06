"use client";

import * as stylex from "@stylexjs/stylex";
import { fonts, fontSizes, spacing } from "tailwind-stylex/tokens.stylex";
import { DiagramCanvas, DiagramNode, type DiagramEdgeProps } from "../diagram/primitives";
import { DiagramScene } from "../diagram/diagram-scene";
import { TreeDiagram } from "../diagram/tree-diagram";
import { TreeComparison } from "../diagram/tree-comparison";
import { VirtualTree } from "../diagram/virtual-tree";
import { diagramMetrics } from "../diagram/geometry";
import { colors } from "../diagram/tokens.stylex";
import type { TreeNode } from "../diagram/tree-model";
import { branchingNodes, deepNodes, relationshipEdges, relationshipNodes } from "./fixtures";
import { Specimen } from "./specimen";
import { treeDataflowNodes, treeDataflowEdges } from "./tree-dataflow-fixture";

interface NodeSpecimen {
  name: string;
  node: TreeNode;
}

interface EdgeSpecimen {
  name: string;
  kind: NonNullable<DiagramEdgeProps["kind"]>;
  source: TreeNode;
  target: TreeNode;
}

const nodeSpecimens: NodeSpecimen[] = [
  { name: "Component", node: { id: "node-component", label: "Component" } },
  { name: "Host", node: { id: "node-host", label: "div", kind: "host" } },
  { name: "Provider", node: { id: "node-provider", label: "Theme.Provider", kind: "provider" } },
  { name: "Boundary", node: { id: "node-boundary", label: "ErrorBoundary", kind: "boundary" } },
  { name: "Suspense", node: { id: "node-special", label: "Suspense", kind: "suspense" } },
  { name: "Portal", node: { id: "node-portal", label: "Portal", kind: "portal" } },
];

const edgeSpecimens: EdgeSpecimen[] = [
  {
    name: "Parent",
    kind: "parent",
    source: { id: "source", label: "Parent" },
    target: { id: "target", label: "Child", kind: "host" },
  },
  {
    name: "Owner",
    kind: "owner",
    source: { id: "source", label: "Owner" },
    target: { id: "target", label: "Child", kind: "host" },
  },
  {
    name: "Reference",
    kind: "reference",
    source: { id: "source", label: "use", kind: "host" },
    target: { id: "target", label: "defs", kind: "host" },
  },
  {
    name: "Context",
    kind: "context",
    source: { id: "source", label: "Provider", kind: "provider" },
    target: { id: "target", label: "Child" },
  },
  {
    name: "Portal target",
    kind: "portal",
    source: { id: "source", label: "Ref" },
    target: { id: "target", label: "defs", kind: "host", isPortalTarget: true },
  },
];

const scopeNodes: TreeNode[] = [
  { id: "scope-provider", label: "Provider", kind: "provider" },
  { id: "scope-first", label: "Child", parentId: "scope-provider" },
  { id: "scope-second", label: "Child", parentId: "scope-provider" },
];

const styles = stylex.create({
  page: {
    minHeight: "100vh",
    padding: spacing[6],
    boxSizing: "border-box",
    backgroundColor: colors.canvas,
    color: colors.text,
    fontFamily: fonts.sans,
    WebkitFontSmoothing: "antialiased",
  },
  grid: {
    maxWidth: 1007,
    marginInline: "auto",
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(auto-fit, 325px)",
      "@media (max-width: 372px)": "minmax(0, 325px)",
    },
    justifyContent: "center",
    gap: spacing[4],
    gridAutoFlow: "dense",
  },
  columnLabel: { fill: colors.muted, fontFamily: fonts.sans, fontSize: fontSizes.xs },
  divider: { stroke: colors.border, strokeWidth: 1, strokeDasharray: "3 2" },
  virtual: { width: { default: 293, "@media (max-width: 372px)": "calc(100vw - 80px)" } },
});

export const Board = () => (
  <main {...stylex.props(styles.page)} aria-label="Diagram component board">
    <div {...stylex.props(styles.grid)}>
      {nodeSpecimens.map(({ name, node }) => (
        <Specimen key={node.id} id={node.id} name={name}>
          <DiagramCanvas width={225} height={diagramMetrics.rowHeight} label={`${name} node`}>
            <DiagramNode
              node={node}
              x={
                (225 -
                  node.label.length * diagramMetrics.fontSize * 0.61 -
                  diagramMetrics.labelOffset) /
                2
              }
              y={diagramMetrics.rowHeight / 2}
            />
          </DiagramCanvas>
        </Specimen>
      ))}
      {edgeSpecimens.map(({ name, kind, source, target }) => (
        <Specimen key={kind} id={`edge-${kind}`} name={name}>
          <DiagramScene
            width={225}
            height={diagramMetrics.rowHeight * 3}
            label={`${name} relationship`}
            nodes={[
              {
                ...source,
                x: diagramMetrics.indent * (kind === "portal" ? 2 : 3),
                y: diagramMetrics.rowHeight * (kind === "portal" ? 2 : 1),
              },
              {
                ...target,
                x: diagramMetrics.indent * (kind === "portal" ? 8 : 4),
                y: diagramMetrics.rowHeight * 2,
              },
            ]}
            edges={[
              {
                id: kind,
                from: source.id,
                to: target.id,
                kind,
                bend: diagramMetrics.rowHeight * 2,
              },
            ]}
          />
        </Specimen>
      ))}
      <Specimen id="scope" name="Scope">
        <TreeDiagram
          nodes={scopeNodes}
          label="Context scope"
          width={225}
          scopeId="scope-provider"
          scopeLabel="Theme"
        />
      </Specimen>
      <Specimen id="relationships" name="Parent / Owner / DOM" size="full">
        <DiagramScene
          label="Parent, owner, and DOM trees"
          width={960}
          height={40 + diagramMetrics.rowHeight * 8 + diagramMetrics.rowHeight / 2}
          nodes={relationshipNodes}
          edges={relationshipEdges}
          scopes={[
            {
              x: 48 + diagramMetrics.indent - 12,
              y: 40 + diagramMetrics.rowHeight / 2,
              width: 235,
              height: diagramMetrics.rowHeight * 7,
              label: "DefsContext",
            },
          ]}
        >
          <text x={48} y={12} {...stylex.props(styles.columnLabel)}>
            Parent tree
          </text>
          <text x={360} y={12} {...stylex.props(styles.columnLabel)}>
            Owner tree
          </text>
          <text x={672} y={12} {...stylex.props(styles.columnLabel)}>
            DOM tree
          </text>
          <path
            d={`M324 0V${40 + diagramMetrics.rowHeight * 8}M636 0V${40 + diagramMetrics.rowHeight * 8}`}
            {...stylex.props(styles.divider)}
          />
        </DiagramScene>
      </Specimen>
      <Specimen id="parent-tree" name="Parent / owner" size="full">
        <TreeComparison
          nodes={treeDataflowNodes}
          dataflowEdges={treeDataflowEdges}
          scopeId="theme"
          scopeLabel="ThemeContext"
        />
      </Specimen>
      <Specimen id="deep-tree" name="Virtualized / Deep">
        <div {...stylex.props(styles.virtual)}>
          <VirtualTree nodes={deepNodes} label="Deep tree" height={diagramMetrics.rowHeight * 11} />
        </div>
      </Specimen>
      <Specimen id="branching-tree" name="Virtualized / Branching">
        <div {...stylex.props(styles.virtual)}>
          <VirtualTree
            nodes={branchingNodes}
            label="Branching tree"
            height={diagramMetrics.rowHeight * 11}
          />
        </div>
      </Specimen>
    </div>
  </main>
);
