import { describe, expect, it } from "vite-plus/test";
import {
  createStaticRenderer,
  type FiberSnapshot,
  renderOwnerTree,
  renderSnapshotTree,
} from "@bippy/parser";

const APP = `
import { Suspense } from "react";
declare const isOpen: boolean;
declare const rows: { id: number; label: string }[];
const Row = ({ label }: { label: string }) => <li>{label}</li>;
const Lazy = () => <em>late</em>;
export default function App() {
  return (
    <main>
      <h1>Title</h1>
      {isOpen && <aside>open</aside>}
      <ul>{rows.map((row) => <Row key={row.id} label={row.label} />)}</ul>
      <Suspense fallback={<p>loading</p>}><Lazy /></Suspense>
    </main>
  );
}`;

const render = (): FiberSnapshot =>
  createStaticRenderer({ rootDirectory: "/virtual", files: { "src/app.tsx": APP } }).renderExport(
    "src/app.tsx",
  ).snapshot;

describe("renderSnapshotTree", () => {
  it("draws the parent tree with branches, lists, text and fallbacks", () => {
    expect(renderSnapshotTree(render())).toBe(
      [
        "HostRoot",
        "└─ App",
        "   └─ main",
        "      ├─ h1",
        "      ├─ ? isOpen",
        "      │  ├─ then:",
        "      │  │  └─ aside",
        "      │  └─ else: ∅",
        "      ├─ ul",
        "      │  └─ * rows",
        "      │     └─ Row",
        "      │        └─ li",
        "      │           └─ … item of rows.label",
        "      └─ Suspense",
        "         ├─ Offscreen [mode=visible]",
        "         │  └─ Lazy",
        "         │     └─ em",
        "         └─ fallback:",
        "            └─ p",
      ].join("\n"),
    );
  });

  it("can annotate fibers with ids, hooks and locations", () => {
    const lines = renderSnapshotTree(render(), {
      showIds: true,
      showHooks: true,
      showLocations: true,
    }).split("\n");
    expect(lines[1]).toBe("└─ App #1");
    expect(lines[2]).toBe("   └─ main #2 @ src/app.tsx:9:5");
    expect(lines[3]).toBe("      ├─ h1 #3 @ src/app.tsx:10:7");
  });
});

describe("renderOwnerTree", () => {
  it("nests fibers under the component whose render created them", () => {
    expect(renderOwnerTree(render())).toBe(
      [
        "HostRoot",
        "├─ App",
        "│  ├─ main",
        "│  ├─ h1",
        "│  ├─ aside",
        "│  ├─ ul",
        "│  ├─ Row",
        "│  │  └─ li",
        "│  ├─ Suspense",
        "│  ├─ Lazy",
        "│  │  └─ em",
        "│  └─ p",
        "└─ Offscreen [mode=visible]",
      ].join("\n"),
    );
  });
});
