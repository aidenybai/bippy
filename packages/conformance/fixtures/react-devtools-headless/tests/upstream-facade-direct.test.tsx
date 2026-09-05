// @ts-nocheck
// HACK: Exact upstream fixture shapes are intentionally preserved without local type rewriting.
import "../src/index.js";

import React from "react";
import * as ReactDOMClientModule from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createTools, installFacade as installFacadeImplementation } from "../src/index.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mountedRoots = new Set();
const installedFacades = new Set();
const ReactDOMClient = {
  createRoot: (target) => {
    const root = ReactDOMClientModule.createRoot(target);
    const originalUnmount = root.unmount.bind(root);
    root.unmount = () => {
      mountedRoots.delete(root);
      originalUnmount();
    };
    mountedRoots.add(root);
    return root;
  },
};
const installFacade = (target) => {
  const installedFacade = installFacadeImplementation(target);
  installedFacades.add(installedFacade);
  return installedFacade;
};
const act = React.act;
let facade;
let container;
const isDuration = (value) => {
  return value === null || (typeof value === "number" && value >= 0);
};
describe("react-devtools-facade", () => {
  beforeEach(() => {
    facade = installFacade();
    container = document.createElement("div");
  });
  afterEach(() => {
    for (const root of mountedRoots) {
      try {
        act(() => root.unmount());
      } catch {}
    }
    mountedRoots.clear();
    for (const installedFacade of installedFacades) installedFacade.dispose();
    installedFacades.clear();
    container = document.createElement("div");
  });
  it("installs __REACT_DEVTOOLS_GLOBAL_HOOK__ on globalThis", () => {
    expect(globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(facade.hook);
  });
  it("returns a Facade handle exposing the hook and tracked state", () => {
    expect(facade.hook).toBe(globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__);
    expect(facade.fiberRoots).toBeInstanceOf(Map);
    expect(facade.rendererInternals).toBeInstanceOf(Map);
    expect(facade.profilingState).toEqual({
      isActive: false,
      currentTraceName: null,
      traces: expect.any(Map),
      onCommit: null,
      onPostCommit: null,
    });
  });
  it("does not install any tool globals (the integrator decides those)", () => {
    expect(globalThis.__REACT_TOOLS__).toBeUndefined();
    expect(globalThis.__REACT_LLM_TOOLS__).toBeUndefined();
  });
  it("attaches to an existing hook instead of installing a second one", () => {
    const attached = installFacade();
    expect(attached.hook).toBe(facade.hook);
    expect(globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(facade.hook);
  });
  it("an attached facade back-fills roots already tracked by the hook", () => {
    const App = () => {
      return <div>hi</div>;
    };
    act(() => {
      ReactDOMClient.createRoot(container).render(<App />);
    });
    const attached = installFacade();
    const tree = createTools(attached).getComponentTree();
    expect(tree.find((n) => n.name === "App")).toBeDefined();
  });
  it("an attached facade tracks later commits and profiles them", () => {
    const Counter = ({ count }) => {
      return <div>{"n:" + count}</div>;
    };
    const root = ReactDOMClient.createRoot(container);
    act(() => {
      root.render(<Counter count={0} />);
    });
    const tools = createTools(installFacade());
    expect(tools.getComponentTree().find((n) => n.name === "Counter")).toBeDefined();
    tools.startProfiling("attached-trace");
    act(() => {
      root.render(<Counter count={1} />);
    });
    expect(tools.stopProfiling()).toEqual({
      status: "stopped",
      traceName: "attached-trace",
      commits: 1,
    });
  });
  it("installs onto an explicit target without touching globalThis", () => {
    const target = {};
    const localFacade = installFacade(target);
    expect(target.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(localFacade.hook);
    expect(localFacade.hook).not.toBe(facade.hook);
    expect(localFacade.fiberRoots).not.toBe(facade.fiberRoots);
    expect(globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(facade.hook);
  });
  it("records the renderer and its fiber root on mount", () => {
    const Greeting = () => {
      return <div>Hello</div>;
    };
    act(() => {
      ReactDOMClient.createRoot(container).render(<Greeting />);
    });
    expect(facade.rendererInternals.size).toBeGreaterThan(0);
    let totalRoots = 0;
    facade.fiberRoots.forEach((roots) => {
      totalRoots += roots.size;
    });
    expect(totalRoots).toBeGreaterThan(0);
  });
  it("removes unmounted roots from tracking", () => {
    const App = () => {
      return <div>hello</div>;
    };
    const root = ReactDOMClient.createRoot(container);
    act(() => {
      root.render(<App />);
    });
    const rendererID = Array.from(facade.hook.renderers.keys())[0];
    expect(facade.hook.getFiberRoots(rendererID).size).toBeGreaterThan(0);
    act(() => {
      root.unmount();
    });
    expect(facade.hook.getFiberRoots(rendererID).size).toBe(0);
  });
  describe("getComponentTree", () => {
    let getComponentTree;
    beforeEach(() => {
      getComponentTree = createTools(facade).getComponentTree;
    });
    it("returns error when nothing is rendered", () => {
      const result = getComponentTree();
      expect(result.error).toMatch(/No mounted React roots found/);
    });
    it("returns an array of component nodes", () => {
      const App = () => {
        return <div>hello</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const result = getComponentTree();
      expect(Array.isArray(result)).toBe(true);
      const app = result.find((n) => n.name === "App");
      const div = result.find((n) => n.name === "div");
      expect(app).toEqual({
        uid: expect.any(String),
        type: "function",
        name: "App",
        key: null,
        firstChild: div.uid,
        nextSibling: null,
      });
      expect(div).toEqual({
        uid: expect.any(String),
        type: "host",
        name: "div",
        key: null,
        firstChild: null,
        nextSibling: null,
      });
    });
    it("encodes firstChild and nextSibling relationships", () => {
      const Header = () => {
        return <h1>title</h1>;
      };
      const Footer = () => {
        return <footer>foot</footer>;
      };
      const App = () => {
        return (
          <div>
            <Header />
            <Footer />
          </div>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const nodes = getComponentTree();
      const app = nodes.find((n) => n.name === "App");
      const div = nodes.find((n) => n.name === "div");
      const header = nodes.find((n) => n.name === "Header");
      const footer = nodes.find((n) => n.name === "Footer");
      expect(app.firstChild).toBe(div.uid);
      expect(div.firstChild).toBe(header.uid);
      expect(header.nextSibling).toBe(footer.uid);
      expect(footer.nextSibling).toBe(null);
    });
    it("shows keys in the output", () => {
      const Item = () => {
        return <li>item</li>;
      };
      const List = () => {
        return (
          <ul>
            <Item key="a" />
            <Item key="b" />
          </ul>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<List />);
      });
      const items = getComponentTree().filter((n) => n.name === "Item");
      expect(items.map((i) => i.key)).toEqual(["a", "b"]);
    });
    it("limits depth with the depth parameter", () => {
      const Child = () => {
        return <span>leaf</span>;
      };
      const Parent = () => {
        return <Child />;
      };
      const App = () => {
        return <Parent />;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const names = (snapshot) => snapshot.map((n) => n.name);
      const shallow = getComponentTree(0);
      expect(shallow).toHaveLength(1);
      expect(shallow[0].type).toBe("root");
      const d1 = getComponentTree(1);
      expect(names(d1)).toContain("App");
      expect(names(d1)).not.toContain("Parent");
      const d2 = getComponentTree(2);
      expect(names(d2)).toContain("App");
      expect(names(d2)).toContain("Parent");
      expect(names(d2)).not.toContain("Child");
      const deep = getComponentTree(20);
      expect(names(deep)).toEqual(expect.arrayContaining(["App", "Parent", "Child"]));
    });
    it("starts from a specific node when rootUid is provided", () => {
      const Nav = () => {
        return <nav>nav</nav>;
      };
      const Header = () => {
        return <Nav />;
      };
      const Footer = () => {
        return <footer>foot</footer>;
      };
      const App = () => {
        return (
          <div>
            <Header />
            <Footer />
          </div>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const header = getComponentTree().find((n) => n.name === "Header");
      expect(header).toBeDefined();
      const sub = getComponentTree(20, header.uid);
      const names = sub.map((n) => n.name);
      expect(names).toContain("Header");
      expect(names).toContain("Nav");
      expect(names).not.toContain("App");
      expect(names).not.toContain("Footer");
    });
    it("returns error for non-existent rootUid", () => {
      const App = () => {
        return <div>hello</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const result = getComponentTree(20, "r9999");
      expect(result.error).toMatch(/Component not found/);
    });
    it("assigns stable uids across calls", () => {
      const App = () => {
        return <div>hello</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const first = getComponentTree();
      const second = getComponentTree();
      expect(first).toEqual(second);
    });
    it("shows class components with class type", () => {
      class MyComponent extends React.Component {
        render() {
          return <div>class</div>;
        }
      }
      act(() => {
        ReactDOMClient.createRoot(container).render(<MyComponent />);
      });
      const node = getComponentTree().find((n) => n.name === "MyComponent");
      expect(node.type).toBe("class");
    });
    it("shows host components with host type", () => {
      const App = () => {
        return <div>hello</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const node = getComponentTree().find((n) => n.name === "div");
      expect(node.type).toBe("host");
    });
    it("shows Memo components with memo type", () => {
      const Inner = () => {
        return <span>inner</span>;
      };
      const Memoized = React.memo(Inner);
      act(() => {
        ReactDOMClient.createRoot(container).render(<Memoized />);
      });
      const node = getComponentTree().find((n) => n.name === "Memo(Inner)");
      expect(node).toBeDefined();
      expect(node.type).toBe("memo");
    });
    it("shows ForwardRef components with forwardRef type", () => {
      const FancyButton = React.forwardRef((props, ref) => {
        return <button ref={ref}>{props.children}</button>;
      });
      FancyButton.displayName = "ForwardRef(FancyButton)";
      act(() => {
        ReactDOMClient.createRoot(container).render(<FancyButton>click</FancyButton>);
      });
      const node = getComponentTree().find((n) => n.name === "ForwardRef(FancyButton)");
      expect(node).toBeDefined();
      expect(node.type).toBe("forwardRef");
    });
    it("includes Fragment in the tree", () => {
      const A = () => {
        return <span>a</span>;
      };
      const B = () => {
        return <span>b</span>;
      };
      const App = () => {
        return (
          <div>
            <React.Fragment key="group">
              <A />
              <B />
            </React.Fragment>
          </div>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const nodes = getComponentTree();
      const fragment = nodes.find((n) => n.type === "fragment");
      const a = nodes.find((n) => n.name === "A");
      const b = nodes.find((n) => n.name === "B");
      expect(fragment).toEqual({
        uid: expect.any(String),
        type: "fragment",
        name: "Fragment",
        key: "group",
        firstChild: a.uid,
        nextSibling: null,
      });
      expect(a).toEqual({
        uid: expect.any(String),
        type: "function",
        name: "A",
        key: null,
        firstChild: expect.any(String),
        nextSibling: b.uid,
      });
      expect(b).toEqual({
        uid: expect.any(String),
        type: "function",
        name: "B",
        key: null,
        firstChild: expect.any(String),
        nextSibling: null,
      });
    });
    it("includes HostRoot with type root", () => {
      const App = () => {
        return <div>hello</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const nodes = getComponentTree();
      const root = nodes.find((n) => n.type === "root");
      const app = nodes.find((n) => n.name === "App");
      expect(root).toEqual({
        uid: expect.any(String),
        type: "root",
        name: "createRoot()",
        key: null,
        firstChild: app.uid,
        nextSibling: null,
      });
    });
    it("includes Suspense in the tree", () => {
      const App = () => {
        return (
          <React.Suspense fallback={<div>loading</div>}>
            <div>content</div>
          </React.Suspense>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const suspense = getComponentTree().find((n) => n.type === "suspense");
      expect(suspense).toEqual({
        uid: expect.any(String),
        type: "suspense",
        name: "Suspense",
        key: null,
        firstChild: expect.any(String),
        nextSibling: null,
      });
    });
    it("includes Context Provider in the tree", () => {
      const MyContext = React.createContext("default");
      const App = () => {
        return (
          <MyContext value="test">
            <div>child</div>
          </MyContext>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const provider = getComponentTree().find((n) => n.type === "context");
      expect(provider).toEqual({
        uid: expect.any(String),
        type: "context",
        name: "Context.Provider",
        key: null,
        firstChild: expect.any(String),
        nextSibling: null,
      });
    });
    it("uids survive re-renders via alternate fiber handling", () => {
      const Counter = ({ count }) => {
        return <div>{"Count: " + count}</div>;
      };
      const root = ReactDOMClient.createRoot(container);
      act(() => {
        root.render(<Counter count={0} />);
      });
      const counter1 = getComponentTree().find((n) => n.name === "Counter");
      expect(counter1).toBeDefined();
      act(() => {
        root.render(<Counter count={1} />);
      });
      const counter2 = getComponentTree().find((n) => n.name === "Counter");
      expect(counter2).toBeDefined();
      expect(counter2.uid).toBe(counter1.uid);
    });
    it("removes unmounted roots from the tree", () => {
      const App = () => {
        return <div>hello</div>;
      };
      const root = ReactDOMClient.createRoot(container);
      act(() => {
        root.render(<App />);
      });
      const before = getComponentTree();
      expect(before.find((n) => n.name === "App")).toBeDefined();
      act(() => {
        root.unmount();
      });
      const after = getComponentTree();
      expect(after.error).toMatch(/No mounted React roots found/);
    });
  });
  describe("findComponents", () => {
    let findComponents;
    let getComponentTree;
    beforeEach(() => {
      const tools = createTools(facade);
      findComponents = tools.findComponents;
      getComponentTree = tools.getComponentTree;
    });
    it("finds components by name (case-insensitive substring match)", () => {
      const Header = () => {
        return <h1>title</h1>;
      };
      const Footer = () => {
        return <footer>foot</footer>;
      };
      const App = () => {
        return (
          <div>
            <Header />
            <Footer />
          </div>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const result = findComponents("header");
      expect(result.totalCount).toBe(1);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].name).toBe("Header");
      expect(result.results[0].type).toBe("function");
      expect(result.results[0].uid).toMatch(/^r\d+$/);
    });
    it("returns all matches when multiple components match", () => {
      const Card = () => {
        return <div>card</div>;
      };
      const App = () => {
        return (
          <div>
            <Card key="a" />
            <Card key="b" />
            <Card key="c" />
          </div>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const result = findComponents("Card");
      expect(result.totalCount).toBe(3);
      expect(result.results.map((r) => r.key)).toEqual(["a", "b", "c"]);
    });
    it("returns empty results when no components match", () => {
      const App = () => {
        return <div>hello</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const result = findComponents("NonExistent");
      expect(result.totalCount).toBe(0);
      expect(result.results).toEqual([]);
      expect(result.page).toBe(1);
      expect(result.totalPages).toBe(1);
    });
    it("scopes search to subtree when rootUid is provided", () => {
      const Badge = () => {
        return <span>badge</span>;
      };
      const Sidebar = () => {
        return <Badge />;
      };
      const Main = () => {
        return <Badge />;
      };
      const App = () => {
        return (
          <div>
            <Sidebar />
            <Main />
          </div>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const sidebar = getComponentTree().find((n) => n.name === "Sidebar");
      expect(sidebar).toBeDefined();
      const result = findComponents("Badge", sidebar.uid);
      expect(result.totalCount).toBe(1);
      expect(result.results[0].name).toBe("Badge");
      const allResult = findComponents("Badge");
      expect(allResult.totalCount).toBe(2);
    });
    it("paginates results with default page size of 10", () => {
      const Item = () => {
        return <li>item</li>;
      };
      const App = () => {
        const items = [];
        for (let i = 0; i < 15; i++) {
          items.push(<Item key={String(i)} />);
        }
        return <ul>{items}</ul>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const page1 = findComponents("Item");
      expect(page1.totalCount).toBe(15);
      expect(page1.page).toBe(1);
      expect(page1.pageSize).toBe(10);
      expect(page1.totalPages).toBe(2);
      expect(page1.results).toHaveLength(10);
      const page2 = findComponents("Item", undefined, 2);
      expect(page2.page).toBe(2);
      expect(page2.results).toHaveLength(5);
    });
    it("supports custom page size", () => {
      const Item = () => {
        return <li>item</li>;
      };
      const App = () => {
        return (
          <ul>
            <Item key="0" />
            <Item key="1" />
            <Item key="2" />
            <Item key="3" />
            <Item key="4" />
          </ul>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const result = findComponents("Item", undefined, 1, 2);
      expect(result.totalCount).toBe(5);
      expect(result.pageSize).toBe(2);
      expect(result.totalPages).toBe(3);
      expect(result.results).toHaveLength(2);
      expect(result.results[0].key).toBe("0");
      expect(result.results[1].key).toBe("1");
      const page3 = findComponents("Item", undefined, 3, 2);
      expect(page3.results).toHaveLength(1);
      expect(page3.results[0].key).toBe("4");
    });
    it("clamps page number to valid range", () => {
      const App = () => {
        return <div>hello</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const low = findComponents("div", undefined, 0);
      expect(low.page).toBe(1);
      const high = findComponents("div", undefined, 999);
      expect(high.page).toBe(1);
    });
    it("results have same shape as tree snapshot nodes", () => {
      const Widget = () => {
        return <span>w</span>;
      };
      const App = () => {
        return <Widget />;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const result = findComponents("Widget");
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual({
        uid: expect.any(String),
        type: "function",
        name: "Widget",
        key: null,
        firstChild: expect.any(String),
        nextSibling: null,
      });
    });
    it("uids are consistent with getComponentTree", () => {
      const Target = () => {
        return <div>target</div>;
      };
      const App = () => {
        return <Target />;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const target = getComponentTree().find((n) => n.name === "Target");
      expect(target).toBeDefined();
      const result = findComponents("Target");
      expect(result.results[0].uid).toBe(target.uid);
    });
    it("matches host components by tag name", () => {
      const App = () => {
        return (
          <div>
            <span>a</span>
            <span>b</span>
          </div>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const result = findComponents("span");
      expect(result.totalCount).toBe(2);
      expect(result.results[0].type).toBe("host");
      expect(result.results[0].name).toBe("span");
    });
    it("does not match internal nodes with null displayName", () => {
      const App = () => {
        return (
          <React.Fragment>
            <div>hello</div>
          </React.Fragment>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const fragmentResult = findComponents("Fragment");
      expect(fragmentResult.totalCount).toBe(0);
    });
    it("finds Memo components by wrapped display name", () => {
      const Inner = () => {
        return <span>inner</span>;
      };
      const Memoized = React.memo(Inner);
      const App = () => {
        return <Memoized />;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const result = findComponents("Inner");
      expect(result.totalCount).toBe(1);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual({
        uid: expect.any(String),
        type: "memo",
        name: "Memo(Inner)",
        key: null,
        firstChild: expect.any(String),
        nextSibling: null,
      });
    });
    it("returns error for non-existent rootUid in scoped search", () => {
      const App = () => {
        return <div>hello</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const result = findComponents("App", "r9999");
      expect(result.error).toMatch(/Component not found/);
    });
  });
  describe("getComponentSource", () => {
    let getComponentSource;
    let getComponentTree;
    beforeEach(() => {
      const tools = createTools(facade);
      getComponentSource = tools.getComponentSource;
      getComponentTree = tools.getComponentTree;
    });
    it("returns {source: null} for a function component when the location is unavailable", () => {
      const Greeting = () => {
        return <div>Hello</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<Greeting />);
      });
      const greeting = getComponentTree().find((n) => n.name === "Greeting");
      expect(greeting).toBeDefined();
      expect(getComponentSource(greeting.uid)).toEqual({
        source: null,
      });
    });
    it("returns {source: null} for host components", () => {
      const App = () => {
        return <div>hello</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const div = getComponentTree().find((n) => n.name === "div");
      expect(div).toBeDefined();
      expect(getComponentSource(div.uid)).toEqual({
        source: null,
      });
    });
    it("returns error for non-existent uid", () => {
      const result = getComponentSource("r9999");
      expect(result.error).toMatch(/Component not found/);
    });
  });
  describe("getOwnerStackTrace", () => {
    let getOwnerStackTrace;
    let getComponentTree;
    beforeEach(() => {
      const tools = createTools(facade);
      getOwnerStackTrace = tools.getOwnerStackTrace;
      getComponentTree = tools.getComponentTree;
    });
    it("returns a stack string for a nested component", () => {
      const Child = () => {
        return <span>leaf</span>;
      };
      const Parent = () => {
        return <Child />;
      };
      const App = () => {
        return <Parent />;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const child = getComponentTree().find((n) => n.name === "Child");
      expect(child).toBeDefined();
      const result = getOwnerStackTrace(child.uid);
      expect(typeof result.stack).toBe("string");
      expect(result.stack).toContain("Parent");
      expect(result.stack).toContain("App");
    });
    it("returns a stack string for the root component", () => {
      const App = () => {
        return <div>hello</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const app = getComponentTree().find((n) => n.name === "App");
      const result = getOwnerStackTrace(app.uid);
      expect(typeof result.stack).toBe("string");
    });
    it("returns error for non-existent uid", () => {
      const result = getOwnerStackTrace("r9999");
      expect(result.error).toMatch(/Component not found/);
    });
  });
  describe("getParentStack", () => {
    let getParentStack;
    let getOwnerStack;
    let getComponentTree;
    beforeEach(() => {
      const tools = createTools(facade);
      getParentStack = tools.getParentStack;
      getOwnerStack = tools.getOwnerStack;
      getComponentTree = tools.getComponentTree;
    });
    it("returns structural parents from immediate parent to host root", () => {
      const Child = () => {
        return <span>leaf</span>;
      };
      const App = () => {
        return (
          <section>
            <Child />
          </section>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const child = getComponentTree().find((n) => n.name === "Child");
      expect(child).toBeDefined();
      const parents = getParentStack(child.uid);
      expect(parents).toEqual([
        {
          uid: expect.any(String),
          name: "section",
          type: "host",
        },
        {
          uid: expect.any(String),
          name: "App",
          type: "function",
        },
        {
          uid: expect.any(String),
          name: expect.any(String),
          type: "root",
        },
      ]);
    });
    it("distinguishes structural parents from JSX owners", () => {
      const Child = () => {
        return <span>leaf</span>;
      };
      const App = () => {
        return (
          <section>
            <Child />
          </section>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const child = getComponentTree().find((n) => n.name === "Child");
      const parents = getParentStack(child.uid);
      const owners = getOwnerStack(child.uid);
      expect(parents[0]).toMatchObject({
        name: "section",
        type: "host",
      });
      expect(owners[0]).toMatchObject({
        name: "App",
        type: "function",
      });
    });
    it("returns an empty array for the host root", () => {
      const App = () => {
        return <div>hello</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const root = getComponentTree().find((n) => n.type === "root");
      expect(getParentStack(root.uid)).toEqual([]);
    });
    it("returns error for non-existent uid", () => {
      const result = getParentStack("r9999");
      expect(result.error).toMatch(/Component not found/);
    });
  });
  describe("getOwnerStack", () => {
    let getOwnerStack;
    let getComponentTree;
    beforeEach(() => {
      const tools = createTools(facade);
      getOwnerStack = tools.getOwnerStack;
      getComponentTree = tools.getComponentTree;
    });
    it("returns owner list for a nested component", () => {
      const Child = () => {
        return <span>leaf</span>;
      };
      const Parent = () => {
        return <Child />;
      };
      const App = () => {
        return <Parent />;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const child = getComponentTree().find((n) => n.name === "Child");
      expect(child).toBeDefined();
      const owners = getOwnerStack(child.uid);
      expect(owners).toEqual([
        {
          uid: expect.any(String),
          name: "Parent",
          type: "function",
        },
        {
          uid: expect.any(String),
          name: "App",
          type: "function",
        },
      ]);
    });
    it("each entry has uid, name, and type", () => {
      const Child = () => {
        return <span>leaf</span>;
      };
      const App = () => {
        return <Child />;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const child = getComponentTree().find((n) => n.name === "Child");
      const owners = getOwnerStack(child.uid);
      expect(owners).toHaveLength(1);
      expect(owners[0].uid).toMatch(/^r\d+$/);
      expect(owners[0].name).toBe("App");
      expect(owners[0].type).toBe("function");
    });
    it("owner uids are consistent with getComponentTree", () => {
      const Child = () => {
        return <span>leaf</span>;
      };
      const App = () => {
        return <Child />;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const tree = getComponentTree();
      const child = tree.find((n) => n.name === "Child");
      const app = tree.find((n) => n.name === "App");
      const owners = getOwnerStack(child.uid);
      expect(owners[0].uid).toBe(app.uid);
    });
    it("returns empty array for root component with no owner", () => {
      const App = () => {
        return <div>hello</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const app = getComponentTree().find((n) => n.name === "App");
      const owners = getOwnerStack(app.uid);
      expect(owners).toEqual([]);
    });
    it("returns error for non-existent uid", () => {
      const result = getOwnerStack("r9999");
      expect(result.error).toMatch(/Component not found/);
    });
    it("is ordered from immediate owner to root ancestor", () => {
      const GrandChild = () => {
        return <span>gc</span>;
      };
      const Child = () => {
        return <GrandChild />;
      };
      const Parent = () => {
        return <Child />;
      };
      const App = () => {
        return <Parent />;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const gc = getComponentTree().find((n) => n.name === "GrandChild");
      const owners = getOwnerStack(gc.uid);
      expect(owners).toEqual([
        {
          uid: expect.any(String),
          name: "Child",
          type: "function",
        },
        {
          uid: expect.any(String),
          name: "Parent",
          type: "function",
        },
        {
          uid: expect.any(String),
          name: "App",
          type: "function",
        },
      ]);
    });
  });
  describe("getComponentByUid", () => {
    let getComponentTree;
    let getComponentByUid;
    beforeEach(() => {
      const tools = createTools(facade);
      getComponentTree = tools.getComponentTree;
      getComponentByUid = tools.getComponentByUid;
    });
    it("returns error for non-existent uid", () => {
      const result = getComponentByUid("r9999");
      expect(result.error).toMatch(/Component not found/);
    });
    it("returns info for a function component", () => {
      const Greeting = () => {
        return <div>Hello</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<Greeting />);
      });
      const greeting = getComponentTree().find((n) => n.name === "Greeting");
      expect(greeting).toBeDefined();
      const info = getComponentByUid(greeting.uid);
      expect(info.uid).toBe(greeting.uid);
      expect(info.type).toBe("function");
      expect(info.name).toBe("Greeting");
    });
    it("returns props (excluding children)", () => {
      const Button = () => {
        return <button>click</button>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<Button text="Click me" disabled={true} />);
      });
      const button = getComponentTree().find((n) => n.name === "Button");
      const info = getComponentByUid(button.uid);
      expect(info.props.text).toBe("Click me");
      expect(info.props.disabled).toBe(true);
      expect(info.props).not.toHaveProperty("children");
    });
    it("serializes function props as descriptive strings", () => {
      const Button = () => {
        return <button>click</button>;
      };
      const handleClick = () => {};
      act(() => {
        ReactDOMClient.createRoot(container).render(<Button onClick={handleClick} />);
      });
      const button = getComponentTree().find((n) => n.name === "Button");
      const info = getComponentByUid(button.uid);
      expect(info.props.onClick).toBe("[fn handleClick]");
    });
    it("returns key when present", () => {
      const Item = () => {
        return <li>item</li>;
      };
      const List = () => {
        return (
          <ul>
            <Item key="first" />
          </ul>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<List />);
      });
      const item = getComponentTree().find((n) => n.name === "Item");
      const info = getComponentByUid(item.uid);
      expect(info.key).toBe("first");
    });
    it("returns correct type for class components", () => {
      class MyClass extends React.Component {
        render() {
          return <div>class</div>;
        }
      }
      act(() => {
        ReactDOMClient.createRoot(container).render(<MyClass />);
      });
      const myClass = getComponentTree().find((n) => n.name === "MyClass");
      expect(myClass).toBeDefined();
      const info = getComponentByUid(myClass.uid);
      expect(info.type).toBe("class");
      expect(info.name).toBe("MyClass");
    });
    it("returns correct type for host components", () => {
      const App = () => {
        return <div className="app" id="root" />;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const div = getComponentTree().find((n) => n.name === "div");
      const info = getComponentByUid(div.uid);
      expect(info.type).toBe("host");
      expect(info.name).toBe("div");
      expect(info.props.className).toBe("app");
      expect(info.props.id).toBe("root");
    });
    it("uses uids consistent with getComponentTree", () => {
      const Header = () => {
        return <h1>title</h1>;
      };
      const Footer = () => {
        return <footer>foot</footer>;
      };
      const App = () => {
        return (
          <div>
            <Header />
            <Footer />
          </div>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const nodes = getComponentTree();
      nodes.forEach((node) => {
        const info = getComponentByUid(node.uid);
        expect(info.uid).toBe(node.uid);
      });
    });
    it("normalizes nested objects and arrays in props", () => {
      const Config = () => {
        return <div>config</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(
          <Config
            style={{
              color: "red",
              fontSize: 14,
            }}
            items={[1, 2, 3]}
          />,
        );
      });
      const config = getComponentTree().find((n) => n.name === "Config");
      const info = getComponentByUid(config.uid);
      expect(info.props.style).toEqual({
        color: "red",
        fontSize: 14,
      });
      expect(info.props.items).toEqual([1, 2, 3]);
    });
    it("normalizes symbol and undefined props", () => {
      const Widget = () => {
        return <div>w</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(
          <Widget sym={Symbol("test")} undef={undefined} />,
        );
      });
      const widget = getComponentTree().find((n) => n.name === "Widget");
      const info = getComponentByUid(widget.uid);
      expect(info.props.sym).toBe("[symbol]");
      expect(info.props.undef).toBe(null);
    });
    it("returns info for Memo component with correct type", () => {
      const Inner = () => {
        return <span>inner</span>;
      };
      const Memoized = React.memo(Inner);
      act(() => {
        ReactDOMClient.createRoot(container).render(<Memoized value={42} />);
      });
      const memo = getComponentTree().find((n) => n.type === "memo");
      expect(memo).toBeDefined();
      const info = getComponentByUid(memo.uid);
      expect(info.type).toBe("memo");
    });
    it("returns info for ForwardRef component with correct type", () => {
      const FancyInput = React.forwardRef((props, ref) => {
        return <input ref={ref} />;
      });
      act(() => {
        ReactDOMClient.createRoot(container).render(<FancyInput />);
      });
      const fwd = getComponentTree().find((n) => n.type === "forwardRef");
      expect(fwd).toBeDefined();
      const info = getComponentByUid(fwd.uid);
      expect(info.type).toBe("forwardRef");
    });
    it("returns no props when component has only children", () => {
      const Wrapper = () => {
        return <div>child</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<Wrapper />);
      });
      const wrapper = getComponentTree().find((n) => n.name === "Wrapper");
      const info = getComponentByUid(wrapper.uid);
      expect(info.props).toBeUndefined();
    });
    it("handles circular references in props without stack overflow", () => {
      const Widget = () => {
        return <div>widget</div>;
      };
      const circular = {
        a: 1,
      };
      circular.self = circular;
      act(() => {
        ReactDOMClient.createRoot(container).render(<Widget data={circular} />);
      });
      const widget = getComponentTree().find((n) => n.name === "Widget");
      const info = getComponentByUid(widget.uid);
      expect(info.props.data.a).toBe(1);
      expect(info.props.data.self).toBe("[circular]");
    });
    it("handles deeply nested objects in props without stack overflow", () => {
      const Widget = () => {
        return <div>widget</div>;
      };
      let deep = {
        value: "leaf",
      };
      for (let i = 0; i < 200; i++) {
        deep = {
          nested: deep,
        };
      }
      act(() => {
        ReactDOMClient.createRoot(container).render(<Widget data={deep} />);
      });
      const widget = getComponentTree().find((n) => n.name === "Widget");
      const info = getComponentByUid(widget.uid);
      expect(info.props.data).toBeDefined();
    });
    it("returns the full hooks tree for a function component", () => {
      const useCounter = () => {
        const [c] = React.useState(0);
        return c;
      };
      const Widget = () => {
        const [count] = React.useState(7);
        React.useEffect(() => {}, []);
        const [obj] = React.useState({
          color: "red",
        });
        useCounter();
        const ref = React.useRef(1);
        const memo = React.useMemo(() => 5, []);
        return (
          <div>
            {count}
            {obj.color}
            {ref.current}
            {memo}
          </div>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<Widget />);
      });
      const widget = getComponentTree().find((n) => n.name === "Widget");
      const info = getComponentByUid(widget.uid, true);
      expect(info.hooks).toEqual([
        {
          id: 0,
          name: "State",
          value: 7,
          subHooks: [],
        },
        {
          id: 1,
          name: "Effect",
          value: "[fn]",
          subHooks: [],
        },
        {
          id: 2,
          name: "State",
          value: {
            color: "red",
          },
          subHooks: [],
        },
        {
          id: null,
          name: "Counter",
          value: null,
          subHooks: [
            {
              id: 3,
              name: "State",
              value: 0,
              subHooks: [],
            },
          ],
        },
        {
          id: 4,
          name: "Ref",
          value: 1,
          subHooks: [],
        },
        {
          id: 5,
          name: "Memo",
          value: 5,
          subHooks: [],
        },
      ]);
    });
    it("does not inspect hooks by default", () => {
      const Widget = () => {
        React.useState(7);
        return <div>widget</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<Widget />);
      });
      const widget = getComponentTree().find((n) => n.name === "Widget");
      const info = getComponentByUid(widget.uid);
      expect(info.hooks).toBeUndefined();
    });
    it("returns an error when requested hook inspection fails", () => {
      let renderCount = 0;
      const Widget = () => {
        React.useState(7);
        renderCount++;
        if (renderCount > 1) throw new Error("Cannot inspect hooks");
        return <div>widget</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<Widget />);
      });
      const widget = getComponentTree().find((node) => node.name === "Widget");
      const info = getComponentByUid(widget.uid, true);
      expect(info.error).toBeInstanceOf(Error);
      expect(info.error.message).toBe("Failed to inspect hooks.");
      expect(info.error.cause).toEqual(new Error("Cannot inspect hooks"));
    });
    it("captures the useContext hook with its provided value", () => {
      const ThemeContext = React.createContext("light");
      const Themed = () => {
        const theme = React.useContext(ThemeContext);
        const [count] = React.useState(0);
        return (
          <div>
            {theme}
            {count}
          </div>
        );
      };
      const App = () => {
        return (
          <ThemeContext value="dark">
            <Themed />
          </ThemeContext>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const themed = getComponentTree().find((n) => n.name === "Themed");
      const info = getComponentByUid(themed.uid, true);
      expect(info.hooks).toEqual([
        {
          id: null,
          name: "Context",
          value: "dark",
          subHooks: [],
        },
        {
          id: 0,
          name: "State",
          value: 0,
          subHooks: [],
        },
      ]);
    });
    it("returns an empty hooks array for a function component with no hooks", () => {
      const Plain = () => {
        return <div>plain</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<Plain />);
      });
      const plain = getComponentTree().find((n) => n.name === "Plain");
      const info = getComponentByUid(plain.uid, true);
      expect(info.hooks).toEqual([]);
    });
    it("does not include hooks for class components", () => {
      class MyClass extends React.Component {
        render() {
          return <div>class</div>;
        }
      }
      act(() => {
        ReactDOMClient.createRoot(container).render(<MyClass />);
      });
      const myClass = getComponentTree().find((n) => n.name === "MyClass");
      const info = getComponentByUid(myClass.uid, true);
      expect(info.hooks).toBeUndefined();
    });
    it("does not include hooks for host components", () => {
      const App = () => {
        return <div>hello</div>;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const div = getComponentTree().find((n) => n.name === "div");
      const info = getComponentByUid(div.uid, true);
      expect(info.hooks).toBeUndefined();
    });
  });
  describe("getComponentByHostInstance", () => {
    let getComponentTree;
    let getComponentByUid;
    let getComponentByHostInstance;
    beforeEach(() => {
      const tools = createTools(facade);
      getComponentTree = tools.getComponentTree;
      getComponentByUid = tools.getComponentByUid;
      getComponentByHostInstance = tools.getComponentByHostInstance;
    });
    it("returns the host component for a DOM host element", () => {
      const Child = ({ label }) => {
        return <span className="leaf">{label}</span>;
      };
      const App = () => {
        return (
          <div>
            <Child label="leaf" />
          </div>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const span = container.querySelector("span.leaf");
      const host = getComponentTree().find((n) => n.name === "span");
      const result = getComponentByHostInstance(span);
      expect(result).toEqual(getComponentByUid(host.uid));
      expect(result).toMatchObject({
        uid: host.uid,
        type: "host",
        name: "span",
        props: {
          className: "leaf",
        },
      });
    });
    it("returns the host component rather than the tree owner", () => {
      const Wrapper = ({ children }) => {
        return <section className="wrap">{children}</section>;
      };
      const App = () => {
        return (
          <Wrapper>
            <button className="action">Run</button>
          </Wrapper>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const button = container.querySelector("button.action");
      const tree = getComponentTree();
      const host = tree.find((n) => n.name === "button");
      const wrapper = tree.find((n) => n.name === "Wrapper");
      const app = tree.find((n) => n.name === "App");
      const result = getComponentByHostInstance(button);
      expect(result.uid).toBe(host.uid);
      expect(result.uid).not.toBe(wrapper.uid);
      expect(result.uid).not.toBe(app.uid);
      expect(result).toMatchObject({
        type: "host",
        name: "button",
        props: {
          className: "action",
        },
      });
    });
    it("keeps uids stable across re-renders via alternate fibers", () => {
      const Counter = ({ count }) => {
        return <div className="counter">{"Count: " + count}</div>;
      };
      const root = ReactDOMClient.createRoot(container);
      act(() => {
        root.render(<Counter count={0} />);
      });
      const div = container.querySelector("div.counter");
      const first = getComponentByHostInstance(div);
      act(() => {
        root.render(<Counter count={1} />);
      });
      const second = getComponentByHostInstance(div);
      expect(second.uid).toBe(first.uid);
      expect(second.name).toBe("div");
      expect(second.type).toBe("host");
      expect(second.props.className).toBe("counter");
    });
    it("does not walk platform parent pointers for unmanaged nested nodes", () => {
      const App = () => {
        return <div className="host" />;
      };
      act(() => {
        ReactDOMClient.createRoot(container).render(<App />);
      });
      const host = container.querySelector("div.host");
      const unmanagedChild = document.createElement("i");
      host.appendChild(unmanagedChild);
      expect(getComponentByHostInstance(unmanagedChild)).toEqual({
        error: "Host instance is not managed by React",
      });
    });
    it("returns an error when no roots are mounted", () => {
      expect(getComponentByHostInstance({})).toEqual({
        error: "No mounted React roots found",
      });
    });
    it("returns an error for null or undefined references", () => {
      expect(getComponentByHostInstance(null)).toEqual({
        error: "Host instance is required",
      });
      expect(getComponentByHostInstance(undefined)).toEqual({
        error: "Host instance is required",
      });
    });
  });
  describe("profiler", () => {
    let startProfiling;
    let stopProfiling;
    let getTraceOverview;
    let getCommitReport;
    let getComponentTree;
    let getComponentByUid;
    beforeEach(() => {
      const tools = createTools(facade);
      startProfiling = tools.startProfiling;
      stopProfiling = tools.stopProfiling;
      getTraceOverview = tools.getTraceOverview;
      getCommitReport = tools.getCommitReport;
      getComponentTree = tools.getComponentTree;
      getComponentByUid = tools.getComponentByUid;
    });
    it("startProfiling returns the started status and trace name", () => {
      expect(startProfiling("my-trace")).toEqual({
        status: "started",
        traceName: "my-trace",
      });
      stopProfiling();
    });
    it("startProfiling auto-generates a trace name when none is provided", () => {
      const result = startProfiling();
      expect(result.status).toBe("started");
      expect(result.traceName).toMatch(/^trace-\d+$/);
      stopProfiling();
    });
    it("stopProfiling reports the trace name and commit count", () => {
      startProfiling("test-trace");
      expect(stopProfiling()).toEqual({
        status: "stopped",
        traceName: "test-trace",
        commits: 0,
      });
    });
    it("cannot start profiling twice", () => {
      startProfiling("first");
      expect(startProfiling("second")).toEqual({
        error: 'Already profiling trace "first"',
      });
      stopProfiling();
    });
    it("cannot stop when not profiling", () => {
      expect(stopProfiling()).toEqual({
        error: "Not currently profiling",
      });
    });
    it("records one commit per render and reports the count on stop", () => {
      const Counter = ({ count }) => {
        return <div>{"Count: " + count}</div>;
      };
      const root = ReactDOMClient.createRoot(container);
      act(() => {
        root.render(<Counter count={0} />);
      });
      startProfiling("render-trace");
      act(() => {
        root.render(<Counter count={1} />);
      });
      act(() => {
        root.render(<Counter count={2} />);
      });
      expect(stopProfiling()).toEqual({
        status: "stopped",
        traceName: "render-trace",
        commits: 2,
      });
    });
    it("getTraceOverview returns one row per commit", () => {
      const Child = () => {
        return <span>child</span>;
      };
      const Counter = ({ count }) => {
        return (
          <div>
            <Child />
            {count}
          </div>
        );
      };
      const root = ReactDOMClient.createRoot(container);
      act(() => {
        root.render(<Counter count={0} />);
      });
      startProfiling("overview-trace");
      act(() => {
        root.render(<Counter count={1} />);
      });
      act(() => {
        root.render(<Counter count={2} />);
      });
      stopProfiling();
      const overview = getTraceOverview("overview-trace");
      expect(overview).toHaveLength(2);
      let previousCommittedAt = 0;
      overview.forEach((row, i) => {
        expect(row.commit).toBe(i);
        expect(row.committedAt).toBeGreaterThanOrEqual(previousCommittedAt);
        previousCommittedAt = row.committedAt;
        expect(row.componentsChanged).toBe(getCommitReport("overview-trace", i).components.length);
        expect(isDuration(row.renderDuration)).toBe(true);
        expect(isDuration(row.layoutDuration)).toBe(true);
        expect(isDuration(row.passiveDuration)).toBe(true);
      });
    });
    it("getTraceOverview returns an error for an unknown trace", () => {
      expect(getTraceOverview("nope")).toEqual({
        error: 'Unknown trace "nope"',
      });
    });
    it("getTraceOverview returns an empty array for a trace with no commits", () => {
      startProfiling("empty-trace");
      stopProfiling();
      expect(getTraceOverview("empty-trace")).toEqual([]);
    });
    it("getCommitReport returns commit metadata and the full component set", () => {
      const Child = () => {
        return <span>child</span>;
      };
      const Counter = ({ count }) => {
        return (
          <div>
            <Child />
            {count}
          </div>
        );
      };
      const root = ReactDOMClient.createRoot(container);
      act(() => {
        root.render(<Counter count={0} />);
      });
      startProfiling("detail-trace");
      act(() => {
        root.render(<Counter count={1} />);
      });
      stopProfiling();
      const report = getCommitReport("detail-trace", 0);
      expect(report.priority).toBe("Normal");
      expect(report.committedAt).toBeGreaterThanOrEqual(0);
      expect(isDuration(report.renderDuration)).toBe(true);
      expect(isDuration(report.layoutDuration)).toBe(true);
      expect(isDuration(report.passiveDuration)).toBe(true);
      const byName = report.components
        .map((c) => ({
          name: c.name,
          type: c.type,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      expect(byName).toEqual([
        {
          name: "Child",
          type: "function",
        },
        {
          name: "Counter",
          type: "function",
        },
        {
          name: "createRoot()",
          type: "root",
        },
        {
          name: "div",
          type: "host",
        },
        {
          name: "span",
          type: "host",
        },
      ]);
      report.components.forEach((c) => {
        expect(c.uid).toMatch(/^r\d+$/);
        expect(isDuration(c.actualDuration)).toBe(true);
        expect(isDuration(c.selfDuration)).toBe(true);
      });
    });
    it("getCommitReport sorts components by actualDuration descending", () => {
      const Child = () => {
        return <span>child</span>;
      };
      const Counter = ({ count }) => {
        return (
          <div>
            <Child />
            {count}
          </div>
        );
      };
      const root = ReactDOMClient.createRoot(container);
      act(() => {
        root.render(<Counter count={0} />);
      });
      startProfiling("sort-trace");
      act(() => {
        root.render(<Counter count={1} />);
      });
      stopProfiling();
      const durations = getCommitReport("sort-trace", 0).components.map(
        (c) => c.actualDuration || 0,
      );
      for (let i = 1; i < durations.length; i++) {
        expect(durations[i]).toBeLessThanOrEqual(durations[i - 1]);
      }
    });
    it("getCommitReport committedAt matches getTraceOverview", () => {
      const Counter = ({ count }) => {
        return <div>{"Count: " + count}</div>;
      };
      const root = ReactDOMClient.createRoot(container);
      act(() => {
        root.render(<Counter count={0} />);
      });
      startProfiling("match-trace");
      act(() => {
        root.render(<Counter count={1} />);
      });
      stopProfiling();
      const overview = getTraceOverview("match-trace");
      const report = getCommitReport("match-trace", 0);
      expect(report.committedAt).toBe(overview[0].committedAt);
    });
    it("getCommitReport returns an error for an unknown trace", () => {
      expect(getCommitReport("nope", 0)).toEqual({
        error: 'Unknown trace "nope"',
      });
    });
    it("getCommitReport returns an error for an out-of-range commit index", () => {
      startProfiling("range-trace");
      stopProfiling();
      expect(getCommitReport("range-trace", 5)).toEqual({
        error: "Commit index out of range",
      });
      expect(getCommitReport("range-trace", -1)).toEqual({
        error: "Commit index out of range",
      });
    });
    it("does not record internal nodes like Fragment, Mode, or text", () => {
      const Child = () => {
        return <span>child</span>;
      };
      const App = () => {
        return (
          <React.StrictMode>
            <React.Fragment>
              <Child />
            </React.Fragment>
          </React.StrictMode>
        );
      };
      const root = ReactDOMClient.createRoot(container);
      act(() => {
        root.render(<App />);
      });
      startProfiling("internal-trace");
      act(() => {
        root.render(<App />);
      });
      stopProfiling();
      const names = getCommitReport("internal-trace", 0).components.map((c) => c.name);
      expect(names).not.toContain("Fragment");
      expect(names).not.toContain("StrictMode");
      names.forEach((name) => {
        expect(typeof name).toBe("string");
        expect(name).not.toBe("Unknown");
      });
    });
    it("uses uids consistent with the tree tools", () => {
      const Widget = () => {
        return <div>widget</div>;
      };
      const root = ReactDOMClient.createRoot(container);
      act(() => {
        root.render(<Widget />);
      });
      const widget = getComponentTree().find((n) => n.name === "Widget");
      startProfiling("uid-trace");
      act(() => {
        root.render(<Widget />);
      });
      stopProfiling();
      const report = getCommitReport("uid-trace", 0);
      const widgetEntry = report.components.find((c) => c.name === "Widget");
      expect(widgetEntry).toBeDefined();
      expect(widgetEntry.uid).toBe(widget.uid);
      expect(getComponentByUid(widget.uid).name).toBe("Widget");
    });
    it("records commits across multiple independent traces", () => {
      const Counter = ({ count }) => {
        return <div>{"Count: " + count}</div>;
      };
      const root = ReactDOMClient.createRoot(container);
      act(() => {
        root.render(<Counter count={0} />);
      });
      startProfiling("trace-a");
      act(() => {
        root.render(<Counter count={1} />);
      });
      stopProfiling();
      startProfiling("trace-b");
      act(() => {
        root.render(<Counter count={2} />);
      });
      act(() => {
        root.render(<Counter count={3} />);
      });
      stopProfiling();
      expect(getTraceOverview("trace-a")).toHaveLength(1);
      expect(getTraceOverview("trace-b")).toHaveLength(2);
    });
    it("the hook onPostCommitFiberRoot is a no-op when not profiling", () => {
      const hook = facade.hook;
      expect(typeof hook.onPostCommitFiberRoot).toBe("function");
      expect(() => {
        hook.onPostCommitFiberRoot(0, {
          passiveEffectDuration: 0,
        });
      }).not.toThrow();
    });
  });
  describe("multiple roots and renderers", () => {
    it("inject() registers a new renderer and initializes its internals", () => {
      const before = facade.hook.renderers.size;
      const id = facade.hook.inject({
        reconcilerVersion: "18.2.0",
        version: "18.2.0",
      });
      expect(typeof id).toBe("number");
      expect(facade.hook.renderers.size).toBe(before + 1);
      expect(facade.rendererInternals.has(id)).toBe(true);
    });
    it("getComponentTree aggregates components from multiple roots", () => {
      const AppA = () => {
        return <div>A</div>;
      };
      const AppB = () => {
        return <div>B</div>;
      };
      const containerB = document.createElement("div");
      act(() => {
        ReactDOMClient.createRoot(container).render(<AppA />);
        ReactDOMClient.createRoot(containerB).render(<AppB />);
      });
      const tree = createTools(facade).getComponentTree();
      expect(tree.filter((n) => n.type === "root")).toHaveLength(2);
      const appA = tree.find((n) => n.name === "AppA");
      const appB = tree.find((n) => n.name === "AppB");
      expect(appA).toEqual({
        uid: expect.any(String),
        type: "function",
        name: "AppA",
        key: null,
        firstChild: expect.any(String),
        nextSibling: null,
      });
      expect(appB).toEqual({
        uid: expect.any(String),
        type: "function",
        name: "AppB",
        key: null,
        firstChild: expect.any(String),
        nextSibling: null,
      });
    });
    it("findComponents finds matches across multiple roots", () => {
      const Shared = () => {
        return <span>shared</span>;
      };
      const RootA = () => {
        return <Shared />;
      };
      const RootB = () => {
        return <Shared />;
      };
      const containerB = document.createElement("div");
      act(() => {
        ReactDOMClient.createRoot(container).render(<RootA />);
        ReactDOMClient.createRoot(containerB).render(<RootB />);
      });
      const result = createTools(facade).findComponents("Shared");
      expect(result.totalCount).toBe(2);
      expect(result.results.map((r) => r.name)).toEqual(["Shared", "Shared"]);
      expect(result.results.every((resultNode) => /^r\d+$/.test(resultNode.uid))).toBe(true);
    });
    it("resolves uids from any root via getComponentByUid", () => {
      const Widget = () => {
        return <div>w</div>;
      };
      const RootA = () => {
        return <Widget />;
      };
      const RootB = () => {
        return <Widget />;
      };
      const containerB = document.createElement("div");
      act(() => {
        ReactDOMClient.createRoot(container).render(<RootA />);
        ReactDOMClient.createRoot(containerB).render(<RootB />);
      });
      const tools = createTools(facade);
      const widgets = tools.findComponents("Widget").results;
      expect(widgets).toHaveLength(2);
      widgets.forEach((w) => {
        expect(tools.getComponentByUid(w.uid).name).toBe("Widget");
      });
    });
    it("profiling records commits from all roots", () => {
      const CounterA = ({ count }) => {
        return <div>{"A:" + count}</div>;
      };
      const CounterB = ({ count }) => {
        return <div>{"B:" + count}</div>;
      };
      const containerB = document.createElement("div");
      const rootA = ReactDOMClient.createRoot(container);
      const rootB = ReactDOMClient.createRoot(containerB);
      act(() => {
        rootA.render(<CounterA count={0} />);
        rootB.render(<CounterB count={0} />);
      });
      const tools = createTools(facade);
      tools.startProfiling("multi-root-trace");
      act(() => {
        rootA.render(<CounterA count={1} />);
      });
      act(() => {
        rootB.render(<CounterB count={1} />);
      });
      expect(tools.stopProfiling()).toEqual({
        status: "stopped",
        traceName: "multi-root-trace",
        commits: 2,
      });
      const overview = tools.getTraceOverview("multi-root-trace");
      expect(overview).toHaveLength(2);
      const names0 = tools.getCommitReport("multi-root-trace", 0).components.map((c) => c.name);
      const names1 = tools.getCommitReport("multi-root-trace", 1).components.map((c) => c.name);
      expect(names0).toContain("CounterA");
      expect(names0).not.toContain("CounterB");
      expect(names1).toContain("CounterB");
      expect(names1).not.toContain("CounterA");
    });
  });
  describe("with the React DevTools extension hook already installed", () => {
    let localContainer;
    beforeEach(() => {
      localContainer = document.createElement("div");
      document.body.appendChild(localContainer);
    });
    afterEach(() => {
      localContainer.remove();
    });
    it("attaches to the extension hook and reads its component tree", () => {
      const extensionHook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      const Child = () => {
        return <span>c</span>;
      };
      const App = () => {
        return (
          <div>
            <Child />
          </div>
        );
      };
      act(() => {
        ReactDOMClient.createRoot(localContainer).render(<App />);
      });
      const localFacade = installFacade();
      expect(localFacade.hook).toBe(extensionHook);
      const tree = createTools(localFacade).getComponentTree();
      expect(tree.find((n) => n.name === "App")).toBeDefined();
      expect(tree.find((n) => n.name === "Child")).toBeDefined();
    });
  });
});
