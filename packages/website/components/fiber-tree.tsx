"use client";

import type { ReactNode } from "react";

import { FiberTreeRoot } from "./fiber-tree/fiber-tree-context";
import { FiberTreeInspector } from "./fiber-tree/fiber-tree-inspector";
import { FiberTreeList } from "./fiber-tree/fiber-tree-list";
import { FiberTreePicker } from "./fiber-tree/fiber-tree-picker";
import { FiberTreeSearch } from "./fiber-tree/fiber-tree-search";
import { fiberTreeClassNames, setFiberTreeDisplayName } from "./fiber-tree/fiber-tree-styles";

interface FiberTreePanelProps {
  children: ReactNode;
}

const FiberTreePanel = ({ children }: FiberTreePanelProps) => (
  <section className={fiberTreeClassNames.treeWrapper}>
    <div className={fiberTreeClassNames.tree}>{children}</div>
  </section>
);

const FiberTreeResizeHandle = () => <div className={fiberTreeClassNames.resizeBarWrapper} />;

setFiberTreeDisplayName(FiberTreePanel, "FiberTreePanel");
setFiberTreeDisplayName(FiberTreeResizeHandle, "FiberTreeResizeHandle");

export const FiberTree = Object.assign(FiberTreeRoot, {
  Inspector: FiberTreeInspector,
  List: FiberTreeList,
  Panel: FiberTreePanel,
  Picker: FiberTreePicker,
  ResizeHandle: FiberTreeResizeHandle,
  Search: FiberTreeSearch,
});

export const FiberTreeDemo = () => (
  <FiberTree>
    <FiberTree.Panel>
      <FiberTree.Search>
        <FiberTree.Picker />
      </FiberTree.Search>
      <FiberTree.List />
    </FiberTree.Panel>
    <FiberTree.ResizeHandle />
    <FiberTree.Inspector />
  </FiberTree>
);

setFiberTreeDisplayName(FiberTreeDemo, "FiberTreeDemo");
