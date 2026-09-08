# diagram

Private Next.js / StyleX specimen board for reusable React tree and dataflow diagrams. Uses React 19 and `aidenybai/tailwind-stylex`.

```sh
pnpm --filter diagram dev
```

Open http://localhost:3100. The sidebar searches the component index; Ctrl/Cmd+K focuses it. Board and preview modes share the same specimens. Preview selection is addressable through `?component=parent-tree`; browser history and board anchors work normally.

## UI system

The sidebar, board/preview arrangement, and selected controls are adapted from `millionco/million-ui`. Only the pieces needed here are included:

- `components/ui/button.tsx`: Base UI button, default/ghost variants, regular and icon sizes.
- `components/ui/input.tsx`: Base UI input, regular and compact density.
- `components/ui/tooltip.tsx`: Base UI tooltip with persistent accessible descriptions, hover/focus behavior, and Escape dismissal.
- `components/ui/scroll-area.tsx`: Base UI viewport and scrollbars.
- `components/ui/tree.tsx`: the normal tree component and composable tree parts.

Controls use shadcn-style named exports, `data-slot`, native props/React 19 refs, and StyleX `css` overrides. There is no second control stylesheet or imported component registry. The board retains plain 325px specimens, 16px gaps, small titles, and bounded tree frames. The theme switch persists the selected mode and initially follows the system preference.

Board chrome uses million-ui's light/dark neutral values, including its local `--board-canvas` override, input fills and hairlines, button edges, scrollbar thumbs, and fixed dark tooltip palette. These are separate from the diagram's semantic colors. Keyboard outlines remain high-contrast rather than adopting the upstream faint focus treatment.

## Tree

Virtualization is built into the normal tree. There is no separate `VirtualTree` component or opt-in flag.

```tsx
import { Tree } from "@/components/ui/tree";
import type { TreeNode } from "diagram";

const nodes: TreeNode[] = [
  { id: "app", label: "App", componentType: "function" },
  { id: "frame", label: "Frame", componentType: "forward-ref", parentId: "app", ownerId: "app" },
  { id: "div", label: "div", parentId: "frame", kind: "host" },
];

export const Example = () => (
  <Tree nodes={nodes} label="Component tree" width={400} height={396} controls />
);
```

The local `@/*` alias points to `src/*`. Package consumers can import `diagram/ui/tree` instead. The package also exports `TreeDiagram` as the preset and the existing `Tree.*` compound namespace.

Small trees render in full. Above 100 expanded rows, the same `Tree.View` mounts the viewport window, five overscan rows on either side, and the current roving-focus row when it is outside that window. Native DOM focus stays on that item during manual scrolling. Keyboard navigation and search can reach the complete model, mounting destinations before focusing them. Structural connectors are windowed too.

Indentation adapts to the available width. Deep windows rebase against visible ancestry while `aria-level` and `data-depth` retain absolute depth. Long labels truncate without changing their accessible names. `height` bounds the view including its default controls; short trees shrink to their contents. `data-tree-viewport` identifies the scroll container and exposes separate total, visible, and mounted counts.

The two 10,000-node fixtures use this same component. They are synthetic models, not a live React inspector.

### Composable views

```tsx
import {
  TreeRoot,
  TreeView,
  TreeScopes,
  TreeEdges,
  TreeItems,
  TreeItem,
  TreeDetail,
} from "@/components/ui/tree";
import type { TreeNode, DataflowEdge } from "diagram";

interface ComparisonProps {
  nodes: readonly TreeNode[];
  dataflowEdges: readonly DataflowEdge[];
}

export const Comparison = ({ nodes, dataflowEdges }: ComparisonProps) => (
  <TreeRoot nodes={nodes} dataflowEdges={dataflowEdges}>
    <TreeView label="Parent tree" relationship="parent" controls />
    <TreeView label="Owner tree" relationship="owner" controls>
      <TreeScopes />
      <TreeEdges />
      <TreeItems>
        {(node) => (node.componentId ? <TreeDetail id={node.id} /> : <TreeItem id={node.id} />)}
      </TreeItems>
    </TreeView>
  </TreeRoot>
);
```

- `TreeRoot` owns shared model and activation without adding DOM. Use `activeId` / `onActiveIdChange` for controlled state or `defaultActiveId` for an initial value. `onSelect` is separate from hover/focus.
- `TreeView` owns projection, expansion, scrolling, windowing, and roving focus. Its ref and native props target the SVG. Omitting children supplies the default scopes, edges, and items.
- Views share activation, not DOM focus or expansion. Nested roots reset model, view, interaction, and label contexts.
- `TreeScopes`, `TreeEdges`, and `TreeItems` are independent layers. `TreeItems` invokes its callback for mounted rows; custom items must preserve their model ID.
- `TreeItem` and `TreeDetail` forward native SVG group props and React 19 refs. Consumer handlers run before internal handlers and can cancel them with `preventDefault()`.

IDs must be unique. Missing parents and parent cycles are rejected. Input order determines sibling order; `ownerId` is independent of `parentId`.

### Controls and disclosure

`controls` adds the default search and action row. `controls={<TreeControls />}` composes it explicitly within the view provider. `TreeComparison` includes controls by default; `controls={false}` omits them.

Search matches labels, annotations, and IDs across the complete model without filtering hierarchy. Enter expands ancestors, scrolls to the match, and focuses it when available. ↑/↓ and the previous/next buttons cycle matches without moving focus into the tree. Escape clears the query. The reveal action restores the last active node; expand/collapse-all affects only that view. Results are announced through a live status, and icon actions have tooltips.

Disclosure chevrons appear only while their row is hovered. Their 24px targets remain present. Disclosure clicks toggle without selecting; an item's `onClickCapture` can cancel them. Disclosures remain inside their native item and inherit its visibility and styling.

### Label and description slots

```tsx
<TreeItem id="app" textValue="App">
  <TreeLabel>App</TreeLabel>
  <TreeDescription>The application entry point.</TreeDescription>
</TreeItem>
```

Import `TreeLabel` and `TreeDescription` from `components/ui/tree`. The namespace equivalents are `Tree.Label` and `Tree.Description`; positioned diagrams provide `Diagram.Label` and `Diagram.Description`.

These slots render SVG text/descriptions with scoped placement, generated/custom IDs, native props, and refs. Conditional removal cleans up ARIA references. The model name remains the fallback; custom descriptions supplement model relationships. Use one label and one optional description per item, containing noninteractive SVG content rather than nested buttons or links.

Model labels remain authoritative for geometry. Keep them consistent with custom content; use `textValue` for nontext typeahead content and `aria-label` when graphics need a complete accessible name. `TreeItem.id` is a model ID, not a document-wide DOM ID.

## Drawing and dataflow

`Diagram.Root`, `Canvas`, `Node`, `Detail`, `Label`, `Description`, `Edge`, and `Scope` provide positioned SVG compositions. `DiagramScene` adds ID-based edges; `DataflowDiagram` remains available for explicit graphs with waypoints, port offsets, and label positions.

Shared geometry uses 24px rows/targets, up to 20px indentation, 3px node radius, 0.5px node outlines, and 1px connectors. Node labels, details, annotations, and edge labels all use 10px text. Details remain secondary through color and layout, without extra component glyphs or hierarchy branches. Numeric instance annotations are omitted; meaningful annotations such as `visible` remain.

Semantic colors complement—not replace—shapes and patterns:

- Teal: providers, external stores, context paths, and subscriptions.
- Rose: error boundaries and catch scopes.
- Amber: suspense.
- Violet: portals, wrapper glyphs, ownership/reference paths, and update calls.
- Blue: data paths and the default active-node/focus accent.

Unrelated elements remain readable neutral colors rather than fading. Keyboard focus has an underline. There are no persistent row backgrounds or selection boxes.

Callable labels use `ƒ`. Hooks and callbacks receive it automatically; `isCallable` marks known function-valued props and store methods without changing node kind or inventing update edges. `componentType` distinguishes known function components, classes, memo, and forward-ref wrappers. Classes use squares; wrappers use diamonds. Names alone never determine implementation. Symbols are hidden from assistive technology; names/typeahead remain unchanged and descriptions carry the distinctions.

Pass ID-based `dataflowEdges` to a tree root or preset. Hook/prop rows attach through `componentId` and parent/owner IDs; they are metadata, not extra React fibers. Incoming and outgoing tracing are independent and cycle-safe. Bounded lanes and surface-colored crossing halos separate overlapping paths. Flow labels occupy distinct gaps between rows, follow their curve at that height, and paint after the wires. Optional labels that cannot fit a gap or the viewport are omitted rather than colliding; the connections and textual relationships remain. Arrows keep 3px clearance from component glyphs and 4px from detail text.

Owner inspection shows direct creations in the parent projection and the ownership subtree in the owner projection. Boundary scopes include nested boundary nodes but exclude their handled descendants. Provider scopes appear only while the provider is active. Callback edges represent invocation back to an updater, not another prop-value transfer. Boundary regions describe render-time containment, not event-handler or external-store error handling.

## Accessibility and verification

All trees use `tree` / `treeitem` semantics, explicit hierarchy metadata, textual relationships, and one roving tab stop. Windowing pins the focused item rather than introducing a different focus model. Empty views become named focusable groups.

Arrows navigate and expand/collapse, Home/End jump, locale-aware typeahead searches labels, and Enter/Space activates or toggles a branch when no selection callback is supplied. Focus and activation are separate. Removed, disabled, or hidden mounted items receive focus repair without moving focus into another widget.

Base UI supplies the HTML controls, tooltips, and scrolling primitives. The custom SVG tree retains React Aria's press, focus-visibility, locale, and slot utilities; Base UI does not supply an SVG tree primitive.

Automated Chromium, Firefox, and WebKit checks cover keyboard/touch interaction, controlled state, slots, focus retention, windowing, sidebar navigation, tooltips, and axe rules. SVG paint checks cover both themes, including colored glyphs. Regression checks compare the board's neutral paints with million-ui and detect flow-label collisions with row text, glyphs, focus underlines, and other labels in both projections. Forced-colors emulation and the combined CSS-zoom check remain Chromium-only. This does not establish full WCAG conformance or screen-reader compatibility. See [manual checks and limits](docs/accessibility.md).

```sh
pnpm --filter diagram typecheck
pnpm --filter diagram test
pnpm --filter diagram build
pnpm --filter diagram exec playwright install chromium firefox webkit
pnpm --filter diagram test:browser
pnpm --filter diagram test:accessibility
```

Browser tests start a dev server if port 3100 is free. Screenshots go to `test-results/`; committed PR images live in `docs/screenshots/`. `/fixtures/compound` exercises controlled/shared/isolated state, native props, slots, refs, event cancellation, empty data, and focus recovery.

This package exports TypeScript source. Consumers must transpile it and compile its StyleX styles, including `tailwind-stylex`; see `next.config.ts`.

## Sources

- Sidebar, board layout, and selected Base UI/shadcn patterns: `millionco/million-ui` at `fd7308c`, `src/board/board.tsx` and `src/components/ui/{button,input,tooltip,scroll-area}.tsx`. Adapted to this package's scoped tokens; registry demos, inspection panels, git-history tooling, and unrelated controls are not copied.
- Base UI source inspected locally: button, input, tooltip, and scroll-area primitives in `mui/base-ui`.
- React Aria: tree/collection, press, focus, locale, and slot implementations in `adobe/react-spectrum`.
- Compound architecture: `pacocoursey/cmdk` and `shadcn-ui/ui` command components.
- React source inspected locally: fiber classification, hooks/context, throw/commit logic, DOM selection restoration, event enter/leave handling, and DevTools component trees in `facebook/react`.
