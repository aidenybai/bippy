"use client";

import * as stylex from "@stylexjs/stylex";
import { colors } from "./tokens.stylex";
import { DiagramInteractionContext, useDiagramInteractionState } from "./interaction";
import { TreeDiagram, type TreeDiagramProps } from "./tree-diagram";

export interface TreeComparisonProps {
  nodes: TreeDiagramProps["nodes"];
  dataflowEdges?: TreeDiagramProps["dataflowEdges"];
  scopeId?: string;
  scopeLabel?: string;
  onSelect?: TreeDiagramProps["onSelect"];
}

const styles = stylex.create({
  root: { display: "flex", gap: 40 },
  title: { margin: 0, marginBottom: 12, fontSize: 12, fontWeight: 400, color: colors.muted },
});

export const TreeComparison = ({
  nodes,
  dataflowEdges,
  scopeId,
  scopeLabel,
  onSelect,
}: TreeComparisonProps) => {
  const interaction = useDiagramInteractionState();
  return (
    <DiagramInteractionContext value={interaction}>
      <div {...stylex.props(styles.root)}>
        <div data-tree-relationship="parent">
          <h3 {...stylex.props(styles.title)}>Parent tree</h3>
          <TreeDiagram
            nodes={nodes}
            label="Parent tree"
            dataflowEdges={dataflowEdges}
            width={460}
            showOwners
            scopeId={scopeId}
            scopeLabel={scopeLabel}
            onSelect={onSelect}
          />
        </div>
        <div data-tree-relationship="owner">
          <h3 {...stylex.props(styles.title)}>Owner tree</h3>
          <TreeDiagram
            nodes={nodes}
            label="Owner tree"
            dataflowEdges={dataflowEdges}
            width={260}
            relationship="owner"
            onSelect={onSelect}
          />
        </div>
      </div>
    </DiagramInteractionContext>
  );
};
