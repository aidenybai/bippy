# diagram

React + StyleX + SVG diagram components on a minimal Next.js specimen board, using [aidenybai/tailwind-stylex](https://github.com/aidenybai/tailwind-stylex) for colors, fonts, and spacing.

```sh
pnpm --filter diagram dev
```

Open [localhost:3100](http://localhost:3100).

The board follows `millionco/million-ui`'s square-cell layout: 325px white cells, 16px gaps, small labels, and centered specimens on a gray background. No header, navigation, badges, or explanatory chrome. Larger compositions use the same cells with spans.

## Composition

The API follows cmdk/shadcn's compound-component pattern: scoped state, composable parts, and thin presets. Styling stays in StyleX.

```tsx
"use client";

import { Tree, type TreeNode, type DataflowEdge } from "diagram";

interface ComparisonProps {
  nodes: readonly TreeNode[];
  dataflowEdges: readonly DataflowEdge[];
}

export const Comparison = ({ nodes, dataflowEdges }: ComparisonProps) => (
  <Tree.Root nodes={nodes} dataflowEdges={dataflowEdges}>
    <Tree.View label="Parent tree" relationship="parent" width={360}>
      <Tree.Scopes />
      <Tree.Edges />
      <Tree.Items>
        {(node) => (node.componentId ? <Tree.Detail id={node.id} /> : <Tree.Item id={node.id} />)}
      </Tree.Items>
    </Tree.View>
    <Tree.View label="Owner tree" relationship="owner" width={260}>
      <Tree.Edges />
      <Tree.Items />
    </Tree.View>
  </Tree.Root>
);
```

- `Tree.Root` owns the shared model and interaction state without adding DOM. Use `activeId` / `onActiveIdChange` for controlled state, or `defaultActiveId` for an initial value. `onSelect` handles activation separately from hover/focus.
- `Tree.View` computes a parent or owner projection and its layout. Views under one root share the active ID; nested roots are independent.
- `Tree.Scopes`, `Tree.Edges`, and `Tree.Items` are separate SVG layers. Compose or omit them explicitly. `Tree.Items` accepts a render callback; its default renders components as `Tree.Item` and metadata as `Tree.Detail`.
- `Tree.Item` and `Tree.Detail` accept native SVG group props and React 19 refs. SVG children replace their label content; placement and hitboxes still come from the model. Consumer event handlers run before internal handlers and can cancel them with `preventDefault()`.

Parts expose `data-slot`; rows also expose `data-active` and `data-emphasis`. Named exports such as `TreeRoot` and `TreeItem` are available alongside the namespace API.

For positioned SVG compositions, use `Diagram.Root`, `Diagram.Canvas`, `Diagram.Node`, `Diagram.Detail`, `Diagram.Edge`, and `Diagram.Scope`. Canvas, node, edge, and scope parts forward native SVG props and refs. `TreeDiagram` and `TreeComparison` are presets built from the tree parts, not separate renderers.

Model indexing, highlighting, and geometry remain pure TypeScript modules. `tree-root.tsx` owns shared state; `tree-view.tsx` owns projection state; rendering layers consume their scoped contexts.

## Components

- `DiagramCanvas`: native-size SVG canvas. It does not scale text, nodes, or strokes to fit a card; the specimen scrolls when needed.
- `DiagramNode`: component, host, provider, boundary, suspense, special, portal, hook, value, callback, and store nodes. `isPortalTarget` adds a ring without changing node kind.
- `DiagramEdge`: structural, reference, context, portal, data, update, and subscription connections. Optional arrowheads, waypoints, and explicit label positions support directed flows.
- `DiagramScope`: labeled context or error-boundary region.
- `DiagramScene`: positioned nodes and ID-based edges.
- `TreeDiagram`: parent or owner layout, owner arcs, provider-hover context scopes, and boundary-hover catch regions.
- `TreeComparison`: linked parent/owner views with inline hook/prop rows and hover-driven dataflow.
- `DataflowDiagram`: directed hook, value, prop, callback, context, and external-store graphs.
- `VirtualTree`: fixed-row windowing, adaptive indentation, collapse/expand, and keyboard navigation.

Component rows share a 20px grid, 20px maximum indent, 10px labels, 3px node radius, 0.5px node outlines, and 1px connectors. Data details use 14px rows and muted 8px text, aligned with their component label rather than another tree level. The virtualized tree renders the same SVG node component rather than a separate HTML row design. Parent and owner compositions are derived from one model.

Hover and keyboard focus emphasize the relevant nodes and connections, fading unrelated elements to 20%. In linked trees, owner focus shows direct creations in the parent view and the ownership subtree in the owner view. Boundary focus shows catch regions, including nested boundary nodes but excluding their contents. Blue context scopes only appear while their provider is active. Pointer exit restores the diagram. Virtual rows have continuous full-height, full-width hitboxes: the label, node, whitespace, and expand control share one hover target. There are no selection boxes or persistent row backgrounds.

The supplied SVG's circular arcs, thin connectors, geometric text rendering, and stroke-masked labels are implemented in the shared primitives. There is no separate SVG references specimen. Shared drawing styles live in `drawing.stylex.ts`; shared geometry lives in `geometry.ts`.

```tsx
import { TreeDiagram, VirtualTree, type TreeNode } from "diagram";

const nodes: TreeNode[] = [
  { id: "app", label: "App" },
  { id: "frame", label: "Frame", parentId: "app", ownerId: "app" },
  { id: "div", label: "div", parentId: "frame", kind: "host" },
];

export const Example = () => (
  <>
    <TreeDiagram nodes={nodes} label="Parent tree" showOwners />
    <VirtualTree nodes={nodes} label="Component tree" height={400} />
  </>
);
```

IDs must be unique. Missing parents and parent cycles are rejected. Input order determines sibling order. `ownerId` is independent of `parentId`.

This private workspace package exports TypeScript source. Consumers must transpile it and compile its StyleX styles, including `tailwind-stylex`; see `next.config.ts`.

## Dataflow

Dataflow is embedded in the parent/owner comparison; there is no standalone dataflow specimen. Hooks, values, and props appear directly beneath their component in both projections. Set `componentId` on these metadata rows and attach them with `parentId`/`ownerId`; they are not additional React fibers. Pass ID-based `dataflowEdges` to `Tree.Root`, `TreeComparison`, or `TreeDiagram`.

The model is illustrative, not automatic runtime instrumentation. Hook and prop rows are neutral at rest. Hover or keyboard-focus a metadata row to reveal its dependency paths in one accent color across both views. Owner links appear when an owner is active; context/error scopes appear when their provider/boundary is active. Data details have no circles or tree branches. Only components and external-resource roots are drawn as nodes; props, hooks, and callable operations remain secondary text.

Hover follows incoming and outgoing dependency paths independently. It does not spread through every sibling hook merely because they share a component. Component focus preserves ownership emphasis; focusing a derived value reveals all its inputs. Cycles such as store subscription/notification loops terminate safely.

The example includes:

- `useState` + `useReducer` → `visibleTodos` → Feed/Post props → host content.
- Host callbacks → component callback props → `setQuery` or `dispatch`.
- `useSyncExternalStore` → snapshots → rendered count, including `getSnapshot`, effect subscription/cleanup, notifications, and external writes.
- Provider value → Stats' `useContext` → host styles.

Tree dataflow uses bounded curved links, independently routed for each projection. Only relevant paths appear, and opposing subscription/notification links use separate lanes. Arrows leave a clear gap before detail text. Node connections retain their 3px arrow clearance.

Callback edges describe invocation back to an updater, not a second prop-value transfer. Boundary scopes describe render-time containment, not error handling for event callbacks or external-store operations.

`DataflowDiagram` remains available for explicitly positioned graphs. It supports `waypoints`, `fromOffset`, `toOffset`, and `labelPosition` for custom routing.

## Themes

The icon-only sun/moon switch saves the chosen theme locally and initially follows the system preference. Diagrams are neutral at rest. Blue is the only accent, reserved for active nodes, connections, and scopes; shapes, labels, and line patterns distinguish node and edge kinds. Diagram colors, label masks, surfaces, and scopes use shared StyleX variables. `darkTheme` is available from `diagram/tokens` for consumers.

## Virtualization

The model is indexed without recursion. Only the viewport plus five overscan rows on either side is mounted. Indentation rebases against visible ancestry, keeps two levels of context, and fits into at most 42% of the viewport width. Absolute depth remains in `aria-level` and `data-depth`; it is not shown as a badge. Visible, mounted, and total counts are separate data attributes, not ambiguous footer stats.

Use ↑/↓ to navigate, ←/→ to collapse/expand or move to parent/child, Home/End to jump, and Enter/Space to select. The two 10,000-node specimens are synthetic fixtures, not a live React inspector.

## Checks

```sh
pnpm --filter diagram typecheck
pnpm --filter diagram test
pnpm --filter diagram build
pnpm --filter diagram exec playwright install chromium
pnpm --filter diagram test:browser
```

Browser tests start a dev server if port 3100 is free. Screenshots go to `test-results/`. The `/fixtures/compound` route tests controlled state, nested roots, custom SVG content, DOM props, refs, and event composition.

## Sources

- Board: `millionco/million-ui`, `32f775f`, `src/board/board.candidate.tsx`; translated from Tailwind to StyleX.
- Compound architecture: `pacocoursey/cmdk`, `cmdk/src/index.tsx`, and `shadcn-ui/ui`, `apps/v4/registry/new-york-v4/ui/command.tsx`.
- Adaptive indentation: `aidenybai-website/src/components/fiber-tree/fiber-tree-list.tsx`.
- React source inspected locally: `ReactInternalTypes.js`, `ReactFiber.js`, `ReactChildFiber.js`, `ReactFiberCommitHostEffects.js`, `ReactFiberThrow.js`, `ReactFiberHooks.js`, `ReactFiberNewContext.js`, `ReactContext.js`, `ReactJSXElement.js`, DevTools `Components/Tree.js`, and `ReactFizzConfigDOM.js`.
