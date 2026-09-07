"use client";

import { useRef, useState } from "react";
import { Diagram, Tree, TreeDiagram, type TreeNode, type DataflowEdge } from "../../../index";

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
  const [activationCount, setActivationCount] = useState(0);
  const [clickedId, setClickedId] = useState("");
  const [isBlockedSelected, setIsBlockedSelected] = useState(false);
  const [areRefsReady, setAreRefsReady] = useState(false);
  const [isLabelVisible, setIsLabelVisible] = useState(true);
  const [isDescriptionVisible, setIsDescriptionVisible] = useState(true);
  const [isChildVisible, setIsChildVisible] = useState(true);
  const [isEmpty, setIsEmpty] = useState(false);
  const [isChildDisabled, setIsChildDisabled] = useState(false);
  const [virtualSelectedId, setVirtualSelectedId] = useState("");
  const labelRef = useRef<SVGTextElement>(null);
  const descriptionRef = useRef<SVGDescElement>(null);
  const canvasRef = useRef<SVGSVGElement>(null);
  const itemRef = useRef<SVGGElement>(null);
  const edgeRef = useRef<SVGGElement>(null);
  return (
    <main>
      <button onClick={() => setActiveId("count")}>Activate count</button>
      <button onClick={() => setActiveId(null)}>Clear active</button>
      <button onClick={() => setIsLabelVisible((value) => !value)}>Toggle label slot</button>
      <button onClick={() => setIsDescriptionVisible((value) => !value)}>
        Toggle description slot
      </button>
      <button onClick={() => setIsChildVisible((value) => !value)}>Toggle child</button>
      <button onClick={() => setIsEmpty((value) => !value)}>Toggle empty</button>
      <button onClick={() => setIsChildDisabled((value) => !value)}>Toggle disabled child</button>
      <button
        onClick={() =>
          setAreRefsReady(
            canvasRef.current?.getAttribute("data-slot") === "tree-view" &&
              itemRef.current?.getAttribute("data-slot") === "tree-item" &&
              edgeRef.current?.getAttribute("data-slot") === "diagram-edge" &&
              labelRef.current?.getAttribute("data-slot") === "tree-label" &&
              descriptionRef.current?.getAttribute("data-slot") === "tree-description",
          )
        }
      >
        Inspect refs
      </button>
      <output data-testid="active">{activeId ?? "none"}</output>
      <output data-testid="selected">{selectedId}</output>
      <output data-testid="activation-count">{activationCount}</output>
      <output data-testid="clicked">{clickedId}</output>
      <output data-testid="refs">{String(areRefsReady)}</output>
      <output data-testid="blocked">{String(isBlockedSelected)}</output>
      <output data-testid="virtual-selected">{virtualSelectedId}</output>
      <Tree.Root
        nodes={isEmpty ? [] : isChildVisible ? nodes : nodes.filter((node) => node.id !== "child")}
        dataflowEdges={!isEmpty && isChildVisible ? edges : []}
        activeId={activeId}
        onActiveIdChange={setActiveId}
        onSelect={(nodeId) => {
          setSelectedId(nodeId);
          setActivationCount((count) => count + 1);
        }}
      >
        <Tree.View label="Compound parent" ref={canvasRef} className="consumer-view" width={240}>
          <Tree.Scopes />
          <Tree.Edges />
          <Tree.Items>
            {(node) =>
              node.componentId ? (
                <Tree.Detail id={node.id} data-custom="detail">
                  {isLabelVisible && (
                    <Tree.Label ref={labelRef} id="custom-count-label" data-testid="custom-label">
                      state
                    </Tree.Label>
                  )}
                  {isDescriptionVisible && (
                    <Tree.Description ref={descriptionRef} id="custom-count-description">
                      Custom count explanation.
                    </Tree.Description>
                  )}
                </Tree.Detail>
              ) : (
                <Tree.Item
                  id={node.id}
                  ref={node.id === "child" ? itemRef : undefined}
                  className="consumer-item"
                  data-custom="item"
                  aria-disabled={(node.id === "child" && isChildDisabled) || undefined}
                  onClick={() => setClickedId(node.id)}
                  onKeyDown={(event) => {
                    if (event.key === "F2") {
                      event.preventDefault();
                      setActiveId("count");
                    }
                    if (event.key === "Delete" && node.id === "child") {
                      event.preventDefault();
                      setIsChildVisible(false);
                    }
                  }}
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
      <TreeDiagram
        nodes={isEmpty ? [] : nodes}
        label="Compound virtual"
        height={100}
        onSelect={setVirtualSelectedId}
      />
    </main>
  );
};

export default CompoundFixture;
