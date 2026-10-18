# Viewer

Shows a component's source with the analyzer's findings drawn over it.

```sh
pnpm --filter bippy-analyzer viewer
```

Open http://localhost:3200/, paste the path of a component file into the box at the top and press Enter. The viewer finds the nearest `tsconfig.json` above the file, analyzes that file and draws every component in it. The legend on the right follows the component under the pointer: hover a line or a token and it switches, and it stays on the last one you touched. It starts on the component with the most states. The query string carries the file as `?file=<path>`.

Every state variable gets a color. In the source, its declaration, the calls that set it, the conditions that read it and the handlers that set it share that color. A dashed arrow curves from each setter call up to the declaration, and a solid arrow from the declaration down to each condition that reads it. Hovering anything lights its whole causal chain and dims the rest. The right side uses MDP terms: the state variables, the states with their conditions and what they render, and the actions, each with the variables it sets and the transitions `S1 → S2` it causes, in the same colors. Hovering anything on either side isolates that variable.

The code is rendered by `@pierre/diffs`. The overlay measures each token inside its shadow root, by the `data-line` cell for the line and a text range for the columns, so it follows wrapping and resizing.

The dev server runs the analyzer and serializes its output the same way `analyze --json` does, then builds the page from that JSON alone. `server/analyzer-json.ts` reads and resolves the output, `server/view-model.ts` turns it into what the page needs, and `server/code-graph.ts` finds where each identifier sits in the text with Babel. The client is a `Viewer` compound component, `Viewer.Toolbar`, `Viewer.Source`, `Viewer.Legend` and `Viewer.Status`, over a context that holds the file, the active component, the colors and the hovered token, with TanStack Query for the data.
