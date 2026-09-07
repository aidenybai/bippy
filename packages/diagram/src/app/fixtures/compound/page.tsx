"use client";

import { useRef, useState } from "react";
import { Diagram, Tree, type TreeNode, type DataflowEdge } from "../../../index";

const nodes: TreeNode[] = [
  { id: "app", label: "App" },
  {
    id: "count",
    label: "useState",
    annotation: "count",
    kind: "hook",
    parentId: "app",
    ownerId: "app",
    componentId: "app",
  },
  { id: "child", label: "Child", parentId: "app", ownerId: "app" },
];
const edges: DataflowEdge[] = [{ id: "count-child", from: "count", to: "child", kind: "data" }];

const CompoundFixture = () => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [clickedId, setClickedId] = useState("");
  const [isBlockedSelected, setIsBlockedSelected] = useState(false);
  const [areRefsReady, setAreRefsReady] = useState(false);
  const canvasRef = useRef<SVGSVGElement>(null);
  const itemRef = useRef<SVGGElement>(null);
  const edgeRef = useRef<SVGGElement>(null);
  return (
    <main>
      <button onClick={() => setActiveId("count")}>Activate count</button>
      <button onClick={() => setActiveId(null)}>Clear active</button>
      <button
        onClick={() =>
          setAreRefsReady(
            canvasRef.current?.getAttribute("data-slot") === "tree-view" &&
              itemRef.current?.getAttribute("data-slot") === "tree-item" &&
              edgeRef.current?.getAttribute("data-slot") === "diagram-edge",
          )
        }
      >
        Inspect refs
      </button>
      <output data-testid="active">{activeId ?? "none"}</output>
      <output data-testid="selected">{selectedId}</output>
      <output data-testid="clicked">{clickedId}</output>
      <output data-testid="refs">{String(areRefsReady)}</output>
      <output data-testid="blocked">{String(isBlockedSelected)}</output>
      <Tree.Root
        nodes={nodes}
        dataflowEdges={edges}
        activeId={activeId}
        onActiveIdChange={setActiveId}
        onSelect={setSelectedId}
      >
        <Tree.View label="Compound parent" ref={canvasRef} className="consumer-view" width={240}>
          <Tree.Scopes />
          <Tree.Edges />
          <Tree.Items>
            {(node) =>
              node.componentId ? (
                <Tree.Detail id={node.id} data-custom="detail">
                  <text data-testid="custom-label" dy="0.32em" fontSize={8} fill="currentColor">
                    state
                  </text>
                </Tree.Detail>
              ) : (
                <Tree.Item
                  id={node.id}
                  ref={node.id === "child" ? itemRef : undefined}
                  className="consumer-item"
                  data-custom="item"
                  onClick={() => setClickedId(node.id)}
                />
              )
            }
          </Tree.Items>
        </Tree.View>
        <Tree.View label="Compound owner" relationship="owner" width={240}>
          <Tree.Edges />
          <Tree.Items />
        </Tree.View>
        <Diagram.Root defaultActiveId="isolated-first">
          <Diagram.Canvas label="Isolated diagram" width={240} height={100}>
            <Diagram.Edge
              ref={edgeRef}
              from={{ x: 20, y: 20 }}
              to={{ x: 20, y: 50 }}
              fromId="isolated-first"
              toId="isolated-second"
            />
            <Diagram.Node node={{ id: "isolated-first", label: "First" }} x={20} y={20} />
            <Diagram.Node node={{ id: "isolated-second", label: "Second" }} x={20} y={50} />
            <Diagram.Node
              node={{ id: "blocked", label: "Blocked" }}
              x={20}
              y={80}
              onPointerEnter={(event) => event.preventDefault()}
              onPointerMove={(event) => event.preventDefault()}
              onClick={(event) => event.preventDefault()}
              onSelect={() => setIsBlockedSelected(true)}
            />
          </Diagram.Canvas>
        </Diagram.Root>
      </Tree.Root>
    </main>
  );
};

export default CompoundFixture;
