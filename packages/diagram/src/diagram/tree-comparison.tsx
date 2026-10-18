"use client";

import * as stylex from "@stylexjs/stylex";
import { colors } from "./tokens.stylex";
import { Tree, type TreeRootProps } from "./tree";

export interface TreeComparisonProps extends Omit<TreeRootProps, "children"> {
  controls?: boolean;
  scopeId?: string;
  scopeLabel?: string;
}

const styles = stylex.create({
  root: { display: "flex", gap: 40 },
  title: { margin: 0, marginBottom: 12, fontSize: 12, fontWeight: 400, color: colors.muted },
});

export const TreeComparison = ({
  scopeId,
  scopeLabel,
  controls = false,
  ...props
}: TreeComparisonProps) => (
  <Tree.Root {...props}>
    <div {...stylex.props(styles.root)}>
      <div data-tree-relationship="parent">
        <h3 {...stylex.props(styles.title)}>Parent tree</h3>
        <Tree.View
          label="Parent tree"
          controls={controls}
          width={460}
          showOwners
          scopeId={scopeId}
          scopeLabel={scopeLabel}
        >
          <Tree.Scopes />
          <Tree.Edges />
          <Tree.Items />
        </Tree.View>
      </div>
      <div data-tree-relationship="owner">
        <h3 {...stylex.props(styles.title)}>Owner tree</h3>
        <Tree.View label="Owner tree" width={260} relationship="owner" controls={controls}>
          <Tree.Edges />
          <Tree.Items />
        </Tree.View>
      </div>
    </div>
  </Tree.Root>
);
