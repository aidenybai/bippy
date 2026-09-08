"use client";

import * as stylex from "@stylexjs/stylex";
import { Tree } from "../../../components/ui/tree";
import { TreeComparison } from "../../../diagram/tree-comparison";
import { deepNodes } from "../../../board/fixtures";
import { treeDataflowNodes, treeDataflowEdges } from "../../../board/tree-dataflow-fixture";

const styles = stylex.create({
  main: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 32,
    padding: 32,
  },
});

const TreeControlsFixture = () => (
  <main {...stylex.props(styles.main)}>
    <section id="parent-tree">
      <TreeComparison
        nodes={treeDataflowNodes}
        dataflowEdges={treeDataflowEdges}
        controls
        scopeId="theme"
        scopeLabel="ThemeContext"
      />
    </section>
    <section id="deep-tree">
      <Tree nodes={deepNodes} label="Deep tree" width={293} height={264} controls />
    </section>
  </main>
);

export default TreeControlsFixture;
