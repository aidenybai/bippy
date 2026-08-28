import "../src/index.js"; // KEEP THIS LINE ON TOP

import { expect, it } from "vite-plus/test";
import React from "react";

import { act, render, unmountComponentAtNode } from "../src/nil/index.js";
import type { NilContainer, NilNode } from "../src/nil/index.js";

it("renders host elements into the container", async () => {
  let container: NilContainer | undefined;
  await act(() => {
    container = render(<group name="scene" />);
  });

  expect(container?.head).toMatchObject({
    type: "group",
    props: { name: "scene" },
    children: [],
  });
});

it("renders function components and text children", async () => {
  const App = () => (
    <parent>
      <child>hello</child>
    </parent>
  );

  let container: NilContainer | undefined;
  await act(() => {
    container = render(<App />);
  });

  const parentNode = container?.head;
  expect(parentNode?.type).toBe("parent");
  expect(parentNode?.children[0]?.type).toBe("child");
  expect(parentNode?.children[0]?.children[0]?.props).toMatchObject({ text: "hello" });
});

it("updates state with hooks and re-renders", async () => {
  let increment: (() => void) | undefined;
  const Counter = () => {
    const [count, setCount] = React.useState(0);
    increment = () => setCount((previousCount: number) => previousCount + 1);
    return <counter value={count} />;
  };

  let container: NilContainer | undefined;
  await act(() => {
    container = render(<Counter />);
  });
  expect(container?.head?.props.value).toBe(0);

  await act(() => {
    increment?.();
  });
  expect(container?.head?.props.value).toBe(1);
});

it("runs effects and cleanups across unmount", async () => {
  const lifecycle: string[] = [];
  const Effectful = () => {
    React.useEffect(() => {
      lifecycle.push("mount");
      return () => {
        lifecycle.push("cleanup");
      };
    }, []);
    return <leaf />;
  };

  let container: NilContainer | undefined;
  await act(() => {
    container = render(<Effectful />);
  });
  expect(lifecycle).toEqual(["mount"]);

  await act(() => {
    if (container) unmountComponentAtNode(container);
  });
  expect(lifecycle).toEqual(["mount", "cleanup"]);
  expect(container?.head).toBe(null);
});

it("reconciles keyed children", async () => {
  const List = ({ items }: { items: string[] }) => (
    <list>
      {items.map((item) => (
        <item key={item} name={item} />
      ))}
    </list>
  );

  let container: NilContainer | undefined;
  await act(() => {
    container = render(<List items={["a", "b", "c"]} />);
  });
  const getNames = (): unknown[] =>
    (container?.head?.children ?? []).map((childNode: NilNode) => childNode.props.name);
  expect(getNames()).toEqual(["a", "b", "c"]);

  await act(() => {
    render(<List items={["c", "a"]} />, container);
  });
  expect(getNames()).toEqual(["c", "a"]);
});

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      group: Record<string, unknown>;
      parent: Record<string, unknown>;
      child: Record<string, unknown>;
      counter: Record<string, unknown>;
      leaf: Record<string, unknown>;
      list: Record<string, unknown>;
      item: Record<string, unknown>;
    }
  }
}
