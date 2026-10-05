import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vite-plus/test";
import { enumerateStaticStates } from "../src/harness/compare-render.js";
import {
  renderIsolatedAssignments,
  type IsolatedAssignment,
} from "../src/render/isolated-execution.js";
import { createStaticRenderer } from "../src/render/static-renderer.js";
import { getConcretePatternText } from "./helpers/concrete-pattern-text.js";

const directory = mkdtempSync(join(tmpdir(), "bippy-isolated-execution-"));
const dependency = join(directory, "node_modules", "execution-flags");
mkdirSync(dependency, { recursive: true });
writeFileSync(join(directory, "package.json"), JSON.stringify({ type: "module" }));
writeFileSync(
  join(dependency, "package.json"),
  JSON.stringify({ name: "execution-flags", version: "0.0.0", types: "index.d.ts" }),
);
writeFileSync(join(dependency, "index.d.ts"), "export declare const flag: boolean;");
writeFileSync(
  join(directory, "app.tsx"),
  `
import { useEffect, useState } from "react";
import { flag } from "execution-flags";
let count = 0;
export default () => {
  const [value, setValue] = useState(0);
  count++;
  useEffect(() => { queueMicrotask(() => setValue(1)); }, []);
  return flag ? <main>{count}<b />{value}</main> : <aside>{count}<b />{value}</aside>;
};
`,
);
writeFileSync(
  join(directory, "entry.tsx"),
  `
import { createRoot } from "react-dom/client";
import App from "./app";
createRoot(document.createElement("div")).render(<App />);
`,
);
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const assignments: IsolatedAssignment[] = [true, false, true].map((flag, index) => ({
  id: `assignment-${index}`,
  bindings: [{ specifier: "execution-flags", exportName: "flag", value: flag }],
}));

it.each(["entry", "component"] satisfies Array<"entry" | "component">)(
  "reruns %s histories with fresh module state and real React updates",
  async (kind) => {
    const renderer = await createStaticRenderer({ rootDirectory: directory });
    const executions = await renderIsolatedAssignments(
      renderer,
      {
        kind,
        filePath: join(directory, kind === "entry" ? "entry.tsx" : "app.tsx"),
      },
      assignments,
    );
    expect(executions).toHaveLength(3);
    for (const [index, execution] of executions.entries()) {
      expect(execution.assignment).toBe(assignments[index]);
      expect(execution.isolation).toBe("modeled-state");
      expect(execution.result.diagnostics).toEqual([]);
      const states = enumerateStaticStates(execution.result);
      expect(states.unresolved).toBeNull();
      expect(states.omitted).toBeNull();
      expect(
        states.states.map((state) => getConcretePatternText(state.tree).join("")).sort(),
      ).toEqual(["10", "21"]);
      expect(JSON.stringify(execution.result.snapshot.roots)).toContain(
        index === 1 ? '"name":"aside"' : '"name":"main"',
      );
    }
  },
);

it("rejects excess or duplicate assignments before rendering", async () => {
  const renderer = await createStaticRenderer({ rootDirectory: directory });
  const target = { kind: "entry", filePath: join(directory, "entry.tsx") } satisfies Parameters<
    typeof renderIsolatedAssignments
  >[1];
  await expect(renderIsolatedAssignments(renderer, target, assignments, 2)).rejects.toThrow(
    "bound",
  );
  await expect(
    renderIsolatedAssignments(renderer, target, [assignments[0], assignments[0]]),
  ).rejects.toThrow("Duplicate assignment");
  await expect(
    renderIsolatedAssignments(renderer, target, [
      { id: "duplicate", bindings: [assignments[0].bindings[0], assignments[0].bindings[0]] },
    ]),
  ).rejects.toThrow("Duplicate input");
  const shared = renderer.derive({ externalValues: () => null });
  await expect(renderIsolatedAssignments(shared, target, assignments)).rejects.toThrow(
    "external value provider",
  );
});
