# diagram

React + StyleX + SVG diagram components on a minimal Next.js specimen board, using [aidenybai/tailwind-stylex](https://github.com/aidenybai/tailwind-stylex) for colors, fonts, and spacing.

```sh
pnpm --filter diagram dev
```

Open [localhost:3100](http://localhost:3100).

The board follows `millionco/million-ui`'s square-cell layout: 325px white cells, 16px gaps, small labels, and centered specimens on a gray background. No header, navigation, badges, or explanatory chrome. Larger compositions use the same cells with spans.

## Components

- `DiagramCanvas`: native-size SVG canvas. It does not scale text, nodes, or strokes to fit a card; the specimen scrolls when needed.
- `DiagramNode`: component, host, provider, boundary, special, and portal nodes. `tone` is independent of node kind; a blue SVG element is still a hollow host node. `isPortalTarget` adds a ring without changing node kind.
- `DiagramEdge`: parent, owner, reference, context, and portal connections. Labels can use an explicit `labelPosition` to avoid nearby nodes.
- `DiagramScope`: labeled context region.
- `DiagramScene`: positioned nodes and ID-based edges.
- `TreeDiagram`: preorder layout from parent IDs, with optional owner arcs and context scope.
- `VirtualTree`: fixed-row windowing, adaptive indentation, collapse/expand, and keyboard navigation.

All diagrams use the same compact 20px row grid, 20px maximum indent, 10px labels, 3px node radius, 0.5px node outlines, and 1px connectors. The virtualized tree renders the same SVG node component rather than a separate HTML row design. Parent and owner compositions are derived from one model.

Hovering or keyboard-focusing a node keeps it and its connections at full opacity and fades other elements to 20%. Pointer exit restores the diagram. Virtual rows have continuous full-height, full-width hitboxes: the label, node, whitespace, and expand control share one hover target. There are no selection boxes or persistent row backgrounds.

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

Browser tests start a dev server if port 3100 is free. Screenshots go to `test-results/`.

## Sources

- Board: `millionco/million-ui`, `32f775f`, `src/board/board.candidate.tsx`; translated from Tailwind to StyleX.
- Adaptive indentation: `aidenybai-website/src/components/fiber-tree/fiber-tree-list.tsx`.
- React source inspected locally: `ReactInternalTypes.js`, `ReactFiber.js`, `ReactChildFiber.js`, `ReactFiberCommitHostEffects.js`, DevTools `Components/Tree.js`, and `ReactFizzConfigDOM.js`.
