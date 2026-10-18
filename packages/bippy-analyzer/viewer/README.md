# Viewer

Shows one component's source with the analyzer's findings drawn over it.

```sh
pnpm --filter bippy-analyzer viewer
```

Open http://localhost:3200/. It starts on the `Dashboard` fixture. The query string picks what to show:

| Parameter   | Meaning                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| `tsconfig`  | The project to analyze (default: the symbolic-tree fixture)              |
| `file`      | Analyze only files whose path contains this text                         |
| `component` | The component to show                                                    |
| `json`      | Read an `analysis.json` written by `analyze --json` instead of analyzing |

Every state variable gets a color. In the source, its declaration, the calls that set it, the conditions that read it and the handlers that set it share that color. A dashed arrow runs from each setter call back to the declaration, and a solid arrow from the declaration to each condition that reads it. The right side lists the data, the states with their conditions and what they render, and what can happen, in the same colors. Hovering anything on either side isolates that variable.

The dev server runs the analyzer and serializes its output the same way `analyze --json` does, then builds the page from that JSON alone. `server/analyzer-json.ts` reads and resolves the output, `server/view-model.ts` turns it into what the page needs, and `server/code-graph.ts` finds where each identifier sits in the text with Babel.
