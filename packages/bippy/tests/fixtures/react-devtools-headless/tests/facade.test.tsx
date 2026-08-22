import "../src/index.js";

import { act, cleanup, render, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  buildToolGroup,
  createReactDevTools,
  createTools,
  installFacade,
  register,
} from "../src/index.js";
import { traverseFiber } from "bippy";
import { getFiberTypeName } from "../src/fiber-metadata.js";
import type { Fiber, ReactDebugInfo, ReactDevToolsTarget } from "bippy";
import type { Facade, McpTarget, Tools, TreeNode } from "../src/index.js";

interface EditableState {
  old: string;
  remove?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

interface ConfigProps {
  array?: unknown[];
  big?: bigint;
  callback?: () => void;
  circular?: unknown;
  element?: React.ReactNode;
  count?: number;
  label?: string;
  nested?: unknown;
  symbol?: symbol;
  value?: number;
}

let facade: Facade;
let tools: Tools;

const getTree = (): TreeNode[] => {
  const tree = tools.getComponentTree();
  if (!Array.isArray(tree)) throw tree.error;
  return tree;
};

const getNode = (name: string): TreeNode => {
  const node = getTree().find((candidateNode) => candidateNode.name === name);
  if (!node) throw new Error(`Missing ${name}`);
  return node;
};

const getError = (value: unknown): string | Error => {
  if (typeof value !== "object" || value === null) throw new Error("Expected a tool error");
  const error = Reflect.get(value, "error");
  if (typeof error === "string" || error instanceof Error) return error;
  throw new Error("Expected a tool error");
};

beforeEach(() => {
  facade = installFacade();
  tools = createTools(facade);
});

afterEach(() => {
  cleanup();
  facade.dispose();
});

describe("facade lifecycle", () => {
  it("creates a disposable React DevTools API", () => {
    const reactDevtools = createReactDevTools();
    const listener = vi.fn();
    const unsubscribe = reactDevtools.subscribe(listener);
    const App = () => <div>app</div>;
    render(<App />);

    expect(reactDevtools.getComponentTree()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "App" })]),
    );
    expect(reactDevtools.getRevision()).toBeGreaterThan(0);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    reactDevtools.dispose();
  });

  it("uses the Bippy hook without installing tool globals", () => {
    expect(facade.hook).toBe(globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__);
    expect(facade.fiberRoots).toBeInstanceOf(Map);
    expect(facade.rendererInternals).toBeInstanceOf(Map);
    expect(Reflect.get(globalThis, "__REACT_TOOLS__")).toBeUndefined();
  });

  it("installs an independent hook on an explicit target", () => {
    const target: ReactDevToolsTarget = {};
    const localFacade = installFacade(target);
    expect(target.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(localFacade.hook);
    expect(localFacade.hook).not.toBe(facade.hook);
    expect(localFacade.fiberRoots).not.toBe(facade.fiberRoots);
    localFacade.dispose();
  });

  it("instruments an explicit target independently", () => {
    const App = () => <div>app</div>;
    render(<App />);
    const root = facade.fiberRoots.values().next().value?.values().next().value;
    const renderer = facade.hook.renderers.values().next().value;
    if (!root || !renderer) throw new Error("Missing renderer state");
    const target: ReactDevToolsTarget = {};
    const localFacade = installFacade(target);
    const rendererId = localFacade.hook.inject(renderer);
    expect(localFacade.rendererInternals.get(rendererId)).toBe(renderer);
    const globalRevision = facade.getRevision();
    localFacade.hook.onCommitFiberRoot(rendererId, root, undefined, false);
    const localTree = createTools(localFacade).getComponentTree();
    expect(Array.isArray(localTree)).toBe(true);
    if (Array.isArray(localTree)) {
      expect(localTree.some((node) => node.name === "App")).toBe(true);
    }
    expect(facade.getRevision()).toBe(globalRevision);
    localFacade.dispose();
  });

  it("publishes revisions for renderer commits", () => {
    const listener = vi.fn();
    const unsubscribe = facade.subscribe(listener);
    const App = ({ count = 0 }: ConfigProps) => <div>{count}</div>;
    const rendered = render(<App count={0} />);
    expect(facade.getRevision()).toBeGreaterThan(0);
    expect(listener).toHaveBeenCalled();
    const callsAfterMount = listener.mock.calls.length;
    rendered.rerender(<App count={1} />);
    expect(listener.mock.calls.length).toBeGreaterThan(callsAfterMount);
    unsubscribe();
    const callsAfterUnsubscribe = listener.mock.calls.length;
    rendered.rerender(<App count={2} />);
    expect(listener).toHaveBeenCalledTimes(callsAfterUnsubscribe);
  });

  it("tracks, backfills, and removes mounted roots", () => {
    const App = () => <div>app</div>;
    const rendered = render(<App />);
    expect(getNode("App")).toBeDefined();
    expect(facade.rendererInternals.size).toBeGreaterThan(0);

    const attachedFacade = installFacade();
    const attachedTree = createTools(attachedFacade).getComponentTree();
    expect(Array.isArray(attachedTree)).toBe(true);
    if (Array.isArray(attachedTree)) {
      expect(attachedTree.some((node) => node.name === "App")).toBe(true);
    }

    rendered.unmount();
    expect(getError(tools.getComponentTree())).toBe("No mounted React roots found");
    attachedFacade.dispose();
  });
});

describe("component tree", () => {
  it("returns an error without mounted roots", () => {
    expect(getError(tools.getComponentTree())).toBe("No mounted React roots found");
  });

  it("encodes child and sibling relationships", () => {
    const Header = () => <h1>header</h1>;
    const Footer = () => <footer>footer</footer>;
    const App = () => (
      <main>
        <Header />
        <Footer />
      </main>
    );
    render(<App />);

    const root = getTree().find((node) => node.type === "root");
    const app = getNode("App");
    const main = getNode("main");
    const header = getNode("Header");
    const footer = getNode("Footer");
    expect(root?.firstChild).toBe(app.uid);
    expect(app.firstChild).toBe(main.uid);
    expect(main.firstChild).toBe(header.uid);
    expect(header.nextSibling).toBe(footer.uid);
    expect(footer.nextSibling).toBeNull();
  });

  it("supports keys, depth limits, and subtree roots", () => {
    const Child = () => <span>child</span>;
    const Parent = () => <Child />;
    const App = () => (
      <section>
        <Parent key="parent" />
      </section>
    );
    render(<App />);

    const parent = getNode("Parent");
    expect(parent.key).toBe("parent");
    const shallow = tools.getComponentTree(1);
    expect(Array.isArray(shallow)).toBe(true);
    if (Array.isArray(shallow)) {
      expect(shallow.some((node) => node.name === "App")).toBe(true);
      expect(shallow.some((node) => node.name === "Parent")).toBe(false);
    }
    const subtree = tools.getComponentTree(20, parent.uid);
    expect(Array.isArray(subtree)).toBe(true);
    if (Array.isArray(subtree)) {
      expect(subtree.map((node) => node.name)).toEqual(["Parent", "Child", "span"]);
    }
    expect(String(getError(tools.getComponentTree(20, "r-missing")))).toContain(
      "Component not found",
    );
  });

  it("classifies React Fiber kinds and preserves uids across renders", () => {
    class ClassComponent extends React.Component {
      render() {
        return <div>class</div>;
      }
    }
    const Forward = React.forwardRef<HTMLButtonElement>((_props, reference) => (
      <button ref={reference}>forward</button>
    ));
    Forward.displayName = "Forward";
    const MemoInner = () => <span>memo</span>;
    const Memo = React.memo(MemoInner);
    const Context = React.createContext("default");
    const App = ({ count = 0 }: ConfigProps) => (
      <Context value="provided">
        <ClassComponent />
        <Forward />
        <Memo />
        <React.Suspense fallback={<i>loading</i>}>
          <strong>{count}</strong>
        </React.Suspense>
      </Context>
    );
    const rendered = render(<App count={0} />);

    expect(getNode("ClassComponent").type).toBe("class");
    expect(getNode("Forward").type).toBe("forwardRef");
    expect(getNode("Memo(MemoInner)").type).toBe("memo");
    expect(getTree().some((node) => node.type === "context")).toBe(true);
    expect(getTree().some((node) => node.type === "suspense")).toBe(true);
    expect(getNode("strong").type).toBe("host");
    const appUid = getNode("App").uid;

    rendered.rerender(<App count={1} />);
    expect(getNode("App").uid).toBe(appUid);
  });

  it("aggregates independent roots with globally unique uids", () => {
    const First = () => <div>first</div>;
    const Second = () => <div>second</div>;
    const firstRender = render(<First />);
    const secondRender = render(<Second />);
    const tree = getTree();
    expect(tree.filter((node) => node.type === "root")).toHaveLength(2);
    expect(getNode("First").uid).not.toBe(getNode("Second").uid);
    firstRender.unmount();
    secondRender.unmount();
  });
});

describe("component search", () => {
  it("matches names case-insensitively across roots", () => {
    const Card = () => <article>card</article>;
    const App = () => (
      <div>
        <Card key="a" />
        <Card key="b" />
      </div>
    );
    render(<App />);
    render(<Card key="c" />);

    const result = tools.findComponents("cArD");
    if ("error" in result) throw result.error;
    expect(result.totalCount).toBe(3);
    expect(result.results.map((node) => node.key)).toEqual(["a", "b", "c"]);
  });

  it("scopes to a subtree and paginates", () => {
    const Item = ({ value = 0 }: ConfigProps) => <li>{value}</li>;
    const List = () => (
      <ul>
        {Array.from({ length: 15 }, (_, itemIndex) => (
          <Item key={itemIndex} value={itemIndex} />
        ))}
      </ul>
    );
    const App = () => (
      <div>
        <List />
        <Item value={99} />
      </div>
    );
    render(<App />);

    const list = getNode("List");
    const firstPage = tools.findComponents("Item", list.uid, 1, 10);
    const secondPage = tools.findComponents("Item", list.uid, 2, 10);
    if ("error" in firstPage) throw firstPage.error;
    if ("error" in secondPage) throw secondPage.error;
    expect(firstPage.totalCount).toBe(15);
    expect(firstPage.totalPages).toBe(2);
    expect(firstPage.results).toHaveLength(10);
    expect(secondPage.results).toHaveLength(5);
    expect(tools.findComponents("missing")).toMatchObject({ totalCount: 0, results: [] });
  });
});

describe("component inspection", () => {
  it("normalizes props without children", () => {
    const circular: Record<string, unknown> = { value: 1 };
    circular.self = circular;
    const callback = () => {};
    const Widget = (_props: ConfigProps) => <div>widget</div>;
    render(
      <Widget
        array={[1, undefined]}
        big={10n}
        callback={callback}
        element={<span>element</span>}
        circular={circular}
        nested={{ first: { second: { third: { fourth: true } } } }}
        symbol={Symbol("value")}
      />,
    );

    const info = tools.getComponentByUid(getNode("Widget").uid);
    if ("error" in info) throw info.error;
    expect(info.props).toEqual({
      array: [1, null],
      big: "10n",
      callback: "[fn callback]",
      element: "[React element]",
      circular: { self: "[circular]", value: 1 },
      nested: { first: { second: { third: "[max depth]" } } },
      symbol: "[symbol]",
    });
  });

  it("inspects built-in and custom hooks through Bippy", () => {
    const useCounter = () => {
      const [count] = React.useState(3);
      return count;
    };
    const Widget = () => {
      const [label] = React.useState("label");
      const count = useCounter();
      const reference = React.useRef(count);
      return <div>{`${label}:${reference.current}`}</div>;
    };
    render(<Widget />);

    const info = tools.getComponentByUid(getNode("Widget").uid, true);
    if ("error" in info) throw info.error;
    expect(info.hooks).toEqual([
      { id: 0, name: "State", subHooks: [], value: "label" },
      {
        id: null,
        name: "Counter",
        subHooks: [{ id: 1, name: "State", subHooks: [], value: 3 }],
        value: null,
      },
      { id: 2, name: "Ref", subHooks: [], value: 3 },
    ]);
  });

  it("normalizes hook inspection failures", () => {
    let renderCount = 0;
    const Widget = () => {
      React.useState(0);
      renderCount++;
      if (renderCount > 1) throw new Error("inspection failed");
      return <div>widget</div>;
    };
    render(<Widget />);
    const info = tools.getComponentByUid(getNode("Widget").uid, true);
    expect(info).toMatchObject({ error: expect.any(Error) });
    if (!("error" in info) || !(info.error instanceof Error)) {
      throw new Error("Expected an inspection error");
    }
    expect(info.error.message).toBe("Failed to inspect hooks.");
  });

  it("does not inspect hooks for class or host fibers", () => {
    class ClassComponent extends React.Component {
      render() {
        return <div>class</div>;
      }
    }
    render(<ClassComponent />);
    const classInfo = tools.getComponentByUid(getNode("ClassComponent").uid, true);
    const hostInfo = tools.getComponentByUid(getNode("div").uid, true);
    expect("error" in classInfo ? classInfo : classInfo.hooks).not.toBeDefined();
    expect("error" in hostInfo ? hostInfo : hostInfo.hooks).not.toBeDefined();
  });

  it("resolves managed host instances and rejects unmanaged nodes", () => {
    const App = () => <button className="action">run</button>;
    const rendered = render(<App />);
    const button = rendered.container.querySelector("button");
    if (!button) throw new Error("Missing button");
    const hostNode = getNode("button");
    expect(tools.getComponentByHostInstance(button)).toMatchObject({
      name: "button",
      type: "host",
      uid: hostNode.uid,
    });
    const unmanagedNode = document.createElement("i");
    button.append(unmanagedNode);
    expect(tools.getComponentByHostInstance(unmanagedNode)).toEqual({
      error: "Host instance is not managed by React",
    });
    expect(tools.getComponentByHostInstance(null)).toEqual({
      error: "Host instance is required",
    });
  });

  it("reports structured parents and owners", () => {
    const Child = () => <span>child</span>;
    const Parent = () => (
      <section>
        <Child />
      </section>
    );
    const App = () => <Parent />;
    render(<App />);

    const child = getNode("Child");
    const parents = tools.getParentStack(child.uid);
    const owners = tools.getOwnerStack(child.uid);
    if (!Array.isArray(parents)) throw parents.error;
    if (!Array.isArray(owners)) throw owners.error;
    expect(parents.map((entry) => entry.name)).toEqual([
      "section",
      "Parent",
      "App",
      expect.any(String),
    ]);
    expect(owners.map((entry) => entry.name)).toEqual(["Parent", "App"]);
    const stack = tools.getOwnerStackTrace(child.uid);
    if ("error" in stack) throw stack.error;
    expect(stack.stack).toContain("Parent");
  });

  it("attributes React async debug metadata to Suspense", () => {
    const App = () => (
      <React.Suspense fallback={<div>loading</div>}>
        <span>ready</span>
      </React.Suspense>
    );
    render(<App />);
    const root = facade.fiberRoots.values().next().value?.values().next().value;
    if (!root) throw new Error("Missing Fiber root");
    const boundary = traverseFiber(root.current, (fiber) => getFiberTypeName(fiber) === "suspense");
    if (!boundary) throw new Error("Missing Suspense Fiber");
    const sourceFiber: Fiber = boundary.child?.child ?? boundary;
    const promise = Object.assign(Promise.resolve({ items: 3 }), {
      status: "fulfilled",
      value: { items: 3 },
    });
    const asyncInfo: ReactDebugInfo = {
      awaited: {
        byteSize: 128,
        end: 20,
        env: "Server",
        name: "fetch products",
        start: 10,
        value: promise,
      },
      env: "Client",
    };
    sourceFiber._debugInfo = [asyncInfo];

    const suspenseNode = getTree().find((node) => node.type === "suspense");
    if (!suspenseNode) throw new Error("Missing Suspense node");
    const info = tools.getComponentByUid(suspenseNode.uid);
    if ("error" in info) throw info.error;
    expect(info.suspense).toMatchObject({
      environments: ["Server"],
      isSuspended: false,
      range: [10, 20],
      suspendedBy: [
        {
          byteSize: 128,
          description: { items: 3 },
          end: 20,
          environment: "Server",
          name: "fetch products",
          start: 10,
        },
      ],
      unknownSuspenders: false,
    });
    expect(info.suspense?.suspendedBy[0].sourceUid).toMatch(/^r\d+$/);
    expect(tools.getSuspenseTree()).toEqual([
      expect.objectContaining({
        children: [],
        hasUniqueSuspenders: true,
        parentUid: null,
        uid: suspenseNode.uid,
      }),
    ]);
    expect(tools.getSuspenseTimeline()).toEqual([
      { endTime: 1_000_020, environment: "Server", uid: suspenseNode.uid },
    ]);
  });

  it("includes nested fallback throttling in Suspense ranges", () => {
    const App = () => (
      <React.Suspense fallback={<div>outer</div>}>
        <span>parent content</span>
        <React.Suspense fallback={<div>inner</div>}>
          <span>child content</span>
        </React.Suspense>
      </React.Suspense>
    );
    render(<App />);
    const root = facade.fiberRoots.values().next().value?.values().next().value;
    if (!root) throw new Error("Missing Fiber root");
    const boundaries: Fiber[] = [];
    traverseFiber(root.current, (fiber) => {
      if (getFiberTypeName(fiber) === "suspense") boundaries.push(fiber);
    });
    const [parentBoundary, childBoundary] = boundaries;
    const parentSource = parentBoundary?.child?.child;
    const childSource = childBoundary?.child?.child;
    if (!parentSource || !childSource) throw new Error("Missing Suspense content");
    parentSource._debugInfo = [{ awaited: { end: 100, name: "parent", start: 50 } }];
    childSource._debugInfo = [{ awaited: { end: 200, name: "child", start: 150 } }];
    const suspenseNodes = getTree().filter((node) => node.type === "suspense");
    const childInfo = tools.getComponentByUid(suspenseNodes[1]?.uid ?? "missing");
    if ("error" in childInfo) throw childInfo.error;
    expect(childInfo.suspense?.range).toEqual([100, 400]);
  });

  it("returns source or a null source without leaking Fiber internals", () => {
    const App = () => <div>app</div>;
    render(<App />);
    const source = tools.getComponentSource(getNode("App").uid);
    if ("error" in source) throw source.error;
    expect(source.source === null || source.source.fileName.length > 0).toBe(true);
    expect(String(getError(tools.getComponentSource("r-missing")))).toContain(
      "Component not found",
    );
  });
});

describe("renderer actions", () => {
  it("overrides, deletes, and renames props through renderer internals", async () => {
    const Widget = ({ label = "initial", nested = {} }: ConfigProps) => (
      <div>{`${label}:${JSON.stringify(nested)}`}</div>
    );
    const rendered = render(<Widget label="before" nested={{ old: true, remove: true }} />);
    const uid = getNode("Widget").uid;

    act(() => {
      expect(tools.overrideProps(uid, ["label"], "after")).toEqual({ success: true });
    });
    await waitFor(() => expect(rendered.container.textContent).toContain("after"));

    act(() => {
      expect(tools.renameProps(uid, ["nested", "old"], ["nested", "renamed"])).toEqual({
        success: true,
      });
    });
    await waitFor(() => expect(rendered.container.textContent).toContain("renamed"));

    act(() => {
      expect(tools.deleteProps(uid, ["nested", "remove"])).toEqual({ success: true });
    });
    await waitFor(() => expect(rendered.container.textContent).not.toContain("remove"));
  });

  it("edits array and host component props", async () => {
    const Widget = ({ array = [] }: ConfigProps) => <div>{JSON.stringify(array)}</div>;
    const rendered = render(
      <>
        <Widget array={[1, 2, 3]} />
        <input data-foo="test" readOnly value="initial" />
      </>,
    );
    const widgetUid = getNode("Widget").uid;
    act(() => {
      expect(tools.overrideProps(widgetUid, ["array", 1], "updated")).toEqual({ success: true });
    });
    await waitFor(() => expect(rendered.container.textContent).toContain('[1,"updated",3]'));
    act(() => {
      expect(tools.overrideProps(widgetUid, ["array", 3], "appended")).toEqual({ success: true });
    });
    await waitFor(() => expect(rendered.container.textContent).toContain("appended"));
    act(() => {
      expect(tools.deleteProps(widgetUid, ["array", 1])).toEqual({ success: true });
    });
    await waitFor(() => expect(rendered.container.textContent).toContain('[1,3,"appended"]'));

    const inputUid = getNode("input").uid;
    act(() => {
      expect(tools.renameProps(inputUid, ["data-foo"], ["data-bar"])).toEqual({ success: true });
    });
    const input = rendered.container.querySelector("input");
    await waitFor(() => expect(input?.dataset.bar).toBe("test"));
    expect(input?.dataset.foo).toBeUndefined();
  });

  it("edits class props and state through renderer actions", async () => {
    class Editable extends React.Component<ConfigProps, EditableState> {
      state: EditableState = { old: "before", remove: true };

      render() {
        return <div>{`${this.props.label}:${JSON.stringify(this.state)}`}</div>;
      }
    }
    const rendered = render(<Editable label="prop-before" />);
    const uid = getNode("Editable").uid;
    act(() => {
      expect(tools.overrideProps(uid, ["label"], "prop-after")).toEqual({ success: true });
    });
    await waitFor(() => expect(rendered.container.textContent).toContain("prop-after"));
    act(() => {
      expect(tools.overrideState(uid, ["old"], "state-after")).toEqual({ success: true });
    });
    await waitFor(() => expect(rendered.container.textContent).toContain("state-after"));
    act(() => {
      expect(tools.renameState(uid, ["old"], ["renamed"])).toEqual({ success: true });
    });
    await waitFor(() => expect(rendered.container.textContent).toContain("renamed"));
    act(() => {
      expect(tools.deleteState(uid, ["remove"])).toEqual({ success: true });
    });
    await waitFor(() => expect(rendered.container.textContent).not.toContain("remove"));
    expect(tools.getComponentByUid(uid)).toMatchObject({
      state: { renamed: "state-after" },
    });
  });

  it("edits class context values", async () => {
    const Context = React.createContext({ nested: { old: "before", remove: true } });
    class Consumer extends React.Component {
      static contextType = Context;
      declare context: React.ContextType<typeof Context>;

      render() {
        return <div>{JSON.stringify(this.context)}</div>;
      }
    }
    const rendered = render(
      <Context.Provider value={{ nested: { old: "before", remove: true } }}>
        <Consumer />
      </Context.Provider>,
    );
    const uid = getNode("Consumer").uid;
    act(() => {
      expect(tools.overrideContext(uid, ["nested", "old"], "after")).toEqual({ success: true });
    });
    await waitFor(() => expect(rendered.container.textContent).toContain("after"));
    act(() => {
      expect(tools.renameContext(uid, ["nested", "old"], ["nested", "renamed"])).toEqual({
        success: true,
      });
    });
    await waitFor(() => expect(rendered.container.textContent).toContain("renamed"));
    act(() => {
      expect(tools.deleteContext(uid, ["nested", "remove"])).toEqual({ success: true });
    });
    await waitFor(() => expect(rendered.container.textContent).not.toContain("remove"));
  });

  it("rejects class-only state edits for function components", () => {
    const FunctionComponent = () => <div>function</div>;
    render(<FunctionComponent />);
    expect(tools.overrideState(getNode("FunctionComponent").uid, [], {})).toEqual({
      error: "Renderer does not support state overrides",
    });
  });

  it("overrides hook state through renderer internals", async () => {
    const Counter = () => {
      const [count] = React.useState(0);
      return <div>{`count:${count}`}</div>;
    };
    const rendered = render(<Counter />);
    const uid = getNode("Counter").uid;
    act(() => {
      expect(tools.overrideHookState(uid, 0, [], 7)).toEqual({ success: true });
    });
    await waitFor(() => expect(rendered.container.textContent).toBe("count:7"));
  });

  it("deletes and renames nested hook state through renderer internals", async () => {
    const State = () => {
      const [state] = React.useState({ old: true, remove: true });
      return <div>{JSON.stringify(state)}</div>;
    };
    const rendered = render(<State />);
    const uid = getNode("State").uid;
    act(() => {
      expect(tools.renameHookState(uid, 0, ["old"], ["renamed"])).toEqual({
        success: true,
      });
    });
    await waitFor(() => expect(rendered.container.textContent).toContain("renamed"));
    act(() => {
      expect(tools.deleteHookState(uid, 0, ["remove"])).toEqual({ success: true });
    });
    await waitFor(() => expect(rendered.container.textContent).not.toContain("remove"));
  });

  it("returns every host instance below a component", () => {
    const App = () => (
      <section>
        <span>one</span>
        <button>two</button>
      </section>
    );
    render(<App />);
    const instances = tools.getHostInstances(getNode("App").uid);
    if (!Array.isArray(instances)) throw instances.error;
    expect(
      instances.map((instance) => (instance instanceof Element ? instance.tagName : null)),
    ).toEqual(["SECTION", "SPAN", "BUTTON"]);
  });

  it("forces and releases a Suspense fallback", async () => {
    const App = () => (
      <React.Suspense fallback={<div>loading</div>}>
        <span>ready</span>
      </React.Suspense>
    );
    const rendered = render(<App />);
    const suspense = getTree().find((node) => node.type === "suspense");
    if (!suspense) throw new Error("Missing Suspense boundary");

    act(() => {
      expect(tools.setSuspenseMilestone([suspense.uid])).toEqual({ success: true });
    });
    await waitFor(() => expect(rendered.queryByText("loading")).not.toBeNull());

    act(() => {
      expect(tools.setSuspenseMilestone([])).toEqual({ success: true });
    });
    await waitFor(() => expect(rendered.queryByText("loading")).toBeNull());
  });

  it("forces a component error into the nearest boundary", async () => {
    class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
      state: ErrorBoundaryState = { hasError: false };

      static getDerivedStateFromError(): ErrorBoundaryState {
        return { hasError: true };
      }

      render() {
        return this.state.hasError ? <div>errored</div> : this.props.children;
      }
    }
    const Target = () => <span>safe</span>;
    const rendered = render(
      <ErrorBoundary>
        <Target />
      </ErrorBoundary>,
    );
    const boundaryUid = getNode("ErrorBoundary").uid;
    act(() => {
      expect(tools.setError(boundaryUid, true)).toEqual({ success: true });
    });
    await waitFor(() => expect(rendered.container.textContent).toBe("errored"));
    act(() => {
      expect(tools.setError(boundaryUid, false)).toEqual({ success: true });
    });
    await waitFor(() => expect(rendered.container.textContent).toBe("safe"));
  });

  it("returns actionable errors for unknown components", () => {
    expect(tools.overrideProps("r-missing", [], null)).toEqual({
      error: 'Component not found: "r-missing"',
    });
    expect(tools.setSuspense("r-missing", true)).toEqual({
      error: 'Component not found: "r-missing"',
    });
  });
});

describe("Chrome DevTools MCP adapter", () => {
  it("builds and executes the complete upstream tool group", () => {
    const App = ({ count = 0 }: ConfigProps) => <div>{`app:${count}`}</div>;
    const rendered = render(<App count={0} />);
    const toolGroup = buildToolGroup(tools);
    expect(toolGroup.name).toBe("react");
    expect(toolGroup.tools.map((tool) => tool.name)).toEqual([
      "react_get_component_tree",
      "react_get_component_by_uid",
      "react_get_component_by_dom_element",
      "react_find_components",
      "react_get_component_source",
      "react_get_owner_stack_trace",
      "react_get_parent_stack",
      "react_get_owner_stack",
      "react_start_profiling",
      "react_stop_profiling",
      "react_get_trace_overview",
      "react_get_commit_report",
    ]);
    const execute = (name: string, arguments_: Record<string, unknown> = {}): unknown => {
      const tool = toolGroup.tools.find((candidateTool) => candidateTool.name === name);
      if (!tool) throw new Error(`Missing ${name}`);
      return tool.execute(arguments_);
    };
    const treeResult = execute("react_get_component_tree");
    expect(treeResult).toMatchObject({
      nodes: expect.arrayContaining([expect.objectContaining({ name: "App" })]),
    });
    const appUid = getNode("App").uid;
    const hostElement = rendered.container.querySelector("div");
    expect(execute("react_get_component_by_uid", { uid: appUid })).toMatchObject({
      name: "App",
    });
    expect(execute("react_get_component_by_dom_element", { element: hostElement })).toMatchObject({
      name: "div",
    });
    expect(execute("react_find_components", { name: "App" })).toMatchObject({ totalCount: 1 });
    expect(execute("react_get_component_source", { uid: appUid })).toHaveProperty("source");
    expect(execute("react_get_owner_stack_trace", { uid: appUid })).toHaveProperty("stack");
    expect(execute("react_get_parent_stack", { uid: appUid })).toBeInstanceOf(Array);
    expect(execute("react_get_owner_stack", { uid: appUid })).toBeInstanceOf(Array);
    expect(execute("react_start_profiling", { traceName: "mcp" })).toEqual({
      status: "started",
      traceName: "mcp",
    });
    rendered.rerender(<App count={1} />);
    expect(execute("react_stop_profiling")).toMatchObject({ commits: 1 });
    expect(execute("react_get_trace_overview", { traceName: "mcp" })).toHaveLength(1);
    expect(execute("react_get_commit_report", { commitIndex: 0, traceName: "mcp" })).toHaveProperty(
      "components",
    );
  });

  it("supports the side-effect registration entry", async () => {
    await import("../src/register.js");
    const registration = register();
    const respondWith = vi.fn();
    globalThis.dispatchEvent(Object.assign(new Event("devtoolstooldiscovery"), { respondWith }));
    expect(respondWith).toHaveBeenCalledOnce();
    registration.unregister();
  });

  it("registers lazily with the discovery protocol and unregisters idempotently", () => {
    const registration = register();
    const respondWith = vi.fn();
    const discoveryEvent = Object.assign(new Event("devtoolstooldiscovery"), { respondWith });
    globalThis.dispatchEvent(discoveryEvent);
    expect(respondWith).toHaveBeenCalledOnce();
    expect(respondWith.mock.lastCall?.[0]).toMatchObject({ name: "react" });
    registration.unregister();
    registration.unregister();
    globalThis.dispatchEvent(discoveryEvent);
    expect(respondWith).toHaveBeenCalledOnce();
  });
  it("declares required JSON schemas for every MCP tool", () => {
    const toolGroup = buildToolGroup(tools);
    const requiredByTool = new Map([
      ["react_get_component_by_uid", ["uid"]],
      ["react_get_component_by_dom_element", ["element"]],
      ["react_find_components", ["name"]],
      ["react_get_component_source", ["uid"]],
      ["react_get_owner_stack_trace", ["uid"]],
      ["react_get_parent_stack", ["uid"]],
      ["react_get_owner_stack", ["uid"]],
      ["react_get_trace_overview", ["traceName"]],
      ["react_get_commit_report", ["traceName", "commitIndex"]],
    ]);
    for (const tool of toolGroup.tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toMatchObject({ properties: expect.any(Object), type: "object" });
      const required = requiredByTool.get(tool.name);
      if (required) expect(tool.inputSchema.required).toEqual(required);
    }
  });

  it("normalizes Error payloads and preserves string tool errors", () => {
    const cause = new Error("inner");
    const errorTools: Tools = {
      ...tools,
      getComponentByUid: () => ({ error: new Error("outer", { cause }) }),
      getComponentSource: () => ({ error: "raw error" }),
    };
    const toolGroup = buildToolGroup(errorTools);
    const execute = (name: string): unknown => {
      const tool = toolGroup.tools.find((candidateTool) => candidateTool.name === name);
      if (!tool) throw new Error(`Missing ${name}`);
      return tool.execute({ uid: "r0" });
    };
    expect(execute("react_get_component_by_uid")).toEqual({
      error: "outer Cause: inner",
    });
    expect(execute("react_get_component_source")).toEqual({ error: "raw error" });
  });

  it("caches registration per target without exposing registration state", () => {
    const eventTarget = new EventTarget();
    const target: McpTarget = {
      addEventListener: (event, listener) => eventTarget.addEventListener(event, listener),
      removeEventListener: (event, listener) => eventTarget.removeEventListener(event, listener),
    };
    const firstRegistration = register(target);
    const secondRegistration = register(target);
    expect(secondRegistration).toBe(firstRegistration);
    expect(Object.keys(target)).toEqual([
      "addEventListener",
      "removeEventListener",
      "__REACT_DEVTOOLS_GLOBAL_HOOK__",
    ]);
    firstRegistration.unregister();
  });

  it("ignores malformed discovery events and memoizes the tool group", () => {
    const eventTarget = new EventTarget();
    const target: McpTarget = {
      addEventListener: (event, listener) => eventTarget.addEventListener(event, listener),
      removeEventListener: (event, listener) => eventTarget.removeEventListener(event, listener),
    };
    const registration = register(target);
    eventTarget.dispatchEvent(new Event("devtoolstooldiscovery"));
    const firstRespondWith = vi.fn();
    const secondRespondWith = vi.fn();
    eventTarget.dispatchEvent(
      Object.assign(new Event("devtoolstooldiscovery"), { respondWith: firstRespondWith }),
    );
    eventTarget.dispatchEvent(
      Object.assign(new Event("devtoolstooldiscovery"), { respondWith: secondRespondWith }),
    );
    expect(firstRespondWith.mock.lastCall?.[0]).toBe(secondRespondWith.mock.lastCall?.[0]);
    registration.unregister();
    eventTarget.dispatchEvent(
      Object.assign(new Event("devtoolstooldiscovery"), { respondWith: secondRespondWith }),
    );
    expect(secondRespondWith).toHaveBeenCalledOnce();
  });
});

describe("profiler", () => {
  it("handles session lifecycle and errors", () => {
    expect(tools.startProfiling("trace")).toEqual({ status: "started", traceName: "trace" });
    expect(tools.startProfiling("second")).toEqual({
      error: 'Already profiling trace "trace"',
    });
    expect(tools.stopProfiling()).toEqual({ commits: 0, status: "stopped", traceName: "trace" });
    expect(tools.stopProfiling()).toEqual({ error: "Not currently profiling" });
    expect(tools.getTraceOverview("missing")).toEqual({ error: 'Unknown trace "missing"' });
  });

  it("records commits with stable component uids", () => {
    const Counter = ({ count = 0 }: ConfigProps) => <div>{count}</div>;
    const rendered = render(<Counter count={0} />);
    const counterUid = getNode("Counter").uid;
    tools.startProfiling("updates");
    rendered.rerender(<Counter count={1} />);
    rendered.rerender(<Counter count={2} />);
    expect(tools.stopProfiling()).toEqual({
      commits: 2,
      status: "stopped",
      traceName: "updates",
    });

    const overview = tools.getTraceOverview("updates");
    if (!Array.isArray(overview)) throw overview.error;
    expect(overview).toHaveLength(2);
    const report = tools.getCommitReport("updates", 0);
    if ("error" in report) throw report.error;
    expect(report.components.some((component) => component.uid === counterUid)).toBe(true);
    expect(report.components.map((component) => component.actualDuration ?? 0)).toEqual(
      report.components
        .map((component) => component.actualDuration ?? 0)
        .sort((leftDuration, rightDuration) => rightDuration - leftDuration),
    );
    expect(tools.getCommitReport("updates", 99)).toEqual({
      error: "Commit index out of range",
    });
  });

  it("normalizes legacy scheduler priorities", () => {
    const App = () => <div />;
    render(<App />);
    const [rendererId, roots] = facade.fiberRoots.entries().next().value ?? [];
    const root = roots?.values().next().value;
    if (rendererId === undefined || !root) throw new Error("Missing root");
    tools.startProfiling("legacy-priority");
    facade.hook.onCommitFiberRoot(rendererId, root, 99, false);
    tools.stopProfiling();
    expect(tools.getCommitReport("legacy-priority", 0)).toMatchObject({ priority: "Sync" });
  });

  it("records commits from multiple roots", () => {
    const First = ({ count = 0 }: ConfigProps) => <div>{count}</div>;
    const Second = ({ count = 0 }: ConfigProps) => <span>{count}</span>;
    const firstRender = render(<First count={0} />);
    const secondRender = render(<Second count={0} />);
    tools.startProfiling("roots");
    firstRender.rerender(<First count={1} />);
    secondRender.rerender(<Second count={1} />);
    tools.stopProfiling();
    const firstReport = tools.getCommitReport("roots", 0);
    const secondReport = tools.getCommitReport("roots", 1);
    if ("error" in firstReport) throw firstReport.error;
    if ("error" in secondReport) throw secondReport.error;
    expect(firstReport.components.some((component) => component.name === "First")).toBe(true);
    expect(secondReport.components.some((component) => component.name === "Second")).toBe(true);
  });
});
