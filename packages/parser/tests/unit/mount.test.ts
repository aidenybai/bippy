import { createStaticRenderer, describeValue, type MountPoint } from "@bippy/parser";
import { describe, expect, it } from "vite-plus/test";

const APP = `export const App = () => <main>hello</main>;`;

const findMounts = (source: string): MountPoint[] => {
  const renderer = createStaticRenderer({
    rootDirectory: "/virtual",
    files: { "src/main.tsx": source, "src/app.tsx": APP },
  });
  return renderer.findMountPoints("src/main.tsx");
};

const describeMounts = (source: string): string[] =>
  findMounts(source).map((mount) => `${mount.api}: ${describeValue(mount.element)}`);

describe("findMountPoints", () => {
  it("finds createRoot(el).render(element)", () => {
    expect(
      describeMounts(`import { createRoot } from "react-dom/client";
        import { App } from "./app";
        createRoot(document.getElementById("root")!).render(<App />);`),
    ).toEqual(["createRoot: <App>"]);
  });

  it("follows a root stored in a module binding and namespace imports", () => {
    expect(
      describeMounts(`import * as ReactDOM from "react-dom/client";
        import { StrictMode } from "react";
        import { App } from "./app";
        const root = ReactDOM.createRoot(document.getElementById("root")!);
        root.render(<StrictMode><App /></StrictMode>);`),
    ).toEqual(["createRoot: <StrictMode>"]);
  });

  it("finds hydrateRoot and the legacy ReactDOM.render", () => {
    expect(
      describeMounts(`import { hydrateRoot } from "react-dom/client";
        import ReactDOM from "react-dom";
        import { App } from "./app";
        hydrateRoot(document, <App />);
        ReactDOM.render(<App key="legacy" />, document.body);`),
    ).toEqual(["hydrateRoot: <App>", "render: <App>"]);
  });

  it("ignores unrelated render methods and modules without mounts", () => {
    expect(
      describeMounts(`import { App } from "./app";
        const renderer = { render: (value: unknown) => value };
        renderer.render(<App />);
        export const Other = () => <App />;`),
    ).toEqual([]);
  });

  it("records where the mount call is written", () => {
    const [mount] = findMounts(`import { createRoot } from "react-dom/client";
      import { App } from "./app";

      createRoot(document.body).render(<App />);`);
    expect(mount.location).toEqual({ filePath: "/virtual/src/main.tsx", line: 4, column: 7 });
  });
});
