# Accessibility verification

## Verified automatically

The Chromium suite checks:

- axe WCAG 2 A/AA, 2.1 AA, and 2.2 AA rules in light and dark themes.
- Declared SVG text paints at 4.5:1 and meaningful strokes at 3:1 against the specimen surface, including active and muted states.
- Default tree targets of at least 24 × 24 CSS pixels.
- Tree roles, hierarchy attributes, names, descriptions, slot IDs, and refs.
- One tab stop, arrows, Home/End, typeahead, expansion, and separate activation callbacks.
- Focus recovery when items disappear, become disabled, or are hidden.
- Focus retention when virtual rows scroll offscreen, with a mounted active descendant.
- Touch activation without duplicate callbacks or disappearing inspection traces.
- Keyboard focus under Chromium forced-colors emulation and 200% CSS zoom.

The cross-engine configuration is `playwright-accessibility.config.ts`. A Firefox download timeout prevented the requested Firefox/WebKit installation; neither engine has been verified here. Forced-colors emulation is intentionally Chromium-only.

These checks are not a WCAG certification. axe does not cover all criteria, SVG paint checks do not assess every antialiased pixel, and CSS zoom is not a substitute for testing browser zoom, text scaling, and assistive technology.

## Manual checks still required

Run these with VoiceOver + Safari and NVDA + Firefox or Chrome. Include JAWS + Chrome/Edge if it is a supported environment.

1. Enter each diagram and tree. Confirm the name and keyboard instructions are announced, and each focused item announces its full label, level, sibling position, expansion state, and relevant relationships.
2. Move between parent and owner views. Confirm emphasis is linked but focus stays in the current view. Verify that metadata is described as component details, not extra React fibers.
3. Expand/collapse branches and inspect boundary/provider descriptions. Confirm nested boundary exclusions and context/dependency relationships are understandable without seeing the wires.
4. Navigate a virtual tree to End, manually scroll away, then resume keyboard navigation. Confirm focus stays stable and the reader never announces a missing or unrelated active descendant.
5. Change or remove focused content in `/fixtures/compound`. Check empty views, disabled items, conditional label/description slots, nested roots, and controlled activation. Focus must not move out of another widget.
6. Use browser zoom at 200% and 400%, OS text scaling, and narrow viewports. Diagrams may scroll as two-dimensional content, but focused labels and controls must remain reachable without overlap or lost information.
7. Test Windows High Contrast and keyboard-only navigation. Focus must remain visible without relying on blue alone.
8. Test iOS VoiceOver and Android TalkBack activation, touch scrolling, and cancellation. A tap must activate once; dragging to scroll must not activate a row.

Consumers must repeat these checks after changing labels, geometry, colors, focusability, or event behavior. Content slots are noninteractive SVG content; put additional controls outside the treeitem rather than introducing nested tab stops.
