// @ts-nocheck
// HACK: Exact upstream fixture shapes are intentionally preserved without local type rewriting.
import "../src/index.js";

import React from "react";
import * as ReactDOMClientModule from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { buildToolGroup, register } from "../src/mcp.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mountedRoots = new Set();
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
const act = React.act;
let facade;
let toolGroup;
let unregister;
let container;

const TOOL_NAMES = [
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
];
const getTool = (name) => {
  return toolGroup.tools.find((tool) => tool.name === name);
};
const discover = () => {
  let group = null;
  const event = new CustomEvent("devtoolstooldiscovery");
  event.respondWith = (responded) => {
    group = responded;
  };
  globalThis.dispatchEvent(event);
  return group;
};

describe("react-devtools-cdt-mcp", () => {
  beforeEach(() => {
    const registration = register();
    facade = registration.facade;
    unregister = registration.unregister;
    toolGroup = discover();
    container = document.createElement("div");
    document.body.append(container);
  });
  afterEach(() => {
    for (const root of mountedRoots) {
      try {
        act(() => root.unmount());
      } catch {}
    }
    mountedRoots.clear();
    unregister();
    container.remove();
    Reflect.deleteProperty(globalThis, "__dtmcp");
  });
  it("installs the DevTools hook on register", () => {
    expect(globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBe(facade.hook);
  });
  it("does not install any tool globals (chrome-devtools-mcp owns __dtmcp)", () => {
    expect(globalThis.__REACT_TOOLS__).toBeUndefined();
    expect(globalThis.__dtmcp).toBeUndefined();
  });
  it("root entry exports tools without registering", async () => {
    unregister();
    const originalAddEventListener = globalThis.addEventListener;
    const addEventListener = vi.fn(originalAddEventListener.bind(globalThis));
    globalThis.addEventListener = addEventListener;
    try {
      const api = await import("../src/index.js?root-entry");
      expect(typeof api.register).toBe("function");
      expect(typeof api.buildToolGroup).toBe("function");
      expect(addEventListener).not.toHaveBeenCalled();
    } finally {
      globalThis.addEventListener = originalAddEventListener;
    }
  });
  it("throws when the register entry is imported outside an event target", async () => {
    const originalAddEventListener = globalThis.addEventListener;
    const originalRemoveEventListener = globalThis.removeEventListener;
    unregister();
    try {
      globalThis.addEventListener = undefined;
      globalThis.removeEventListener = undefined;
      await expect(import("../src/register.js?outside-event-target")).rejects.toThrow(
        "react-devtools-headless/register must be imported in a browser-like environment",
      );
    } finally {
      globalThis.addEventListener = originalAddEventListener;
      globalThis.removeEventListener = originalRemoveEventListener;
    }
  });
  it("register entry installs the DevTools hook", async () => {
    const originalAddEventListener = globalThis.addEventListener;
    const originalRemoveEventListener = globalThis.removeEventListener;
    let autoListener = null;
    unregister();
    try {
      globalThis.addEventListener = (type, listener, options) => {
        if (type === "devtoolstooldiscovery") autoListener = listener;
        return originalAddEventListener.call(globalThis, type, listener, options);
      };
      await import("../src/register.js?automatic-registration");
      expect(globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__).toBeDefined();
    } finally {
      if (autoListener !== null) {
        originalRemoveEventListener.call(globalThis, "devtoolstooldiscovery", autoListener);
      }
      globalThis.addEventListener = originalAddEventListener;
      globalThis.removeEventListener = originalRemoveEventListener;
    }
  });
  it("returns the cached registration for repeated calls per target", () => {
    let listener = null;
    const target = {
      addEventListener: vi.fn((type, callback) => {
        expect(type).toBe("devtoolstooldiscovery");
        listener = callback;
      }),
      removeEventListener: vi.fn(),
    };
    const first = register(target);
    const second = register(target);
    expect(target.addEventListener).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(second.facade).toBe(first.facade);
    let firstGroup = null;
    let secondGroup = null;
    listener({
      respondWith: (group) => {
        firstGroup = group;
      },
    });
    listener({
      respondWith: (group) => {
        secondGroup = group;
      },
    });
    expect(secondGroup).toBe(firstGroup);
    first.unregister();
    expect(target.removeEventListener).toHaveBeenCalledTimes(1);
    expect(target.removeEventListener).toHaveBeenCalledWith("devtoolstooldiscovery", listener);
    second.unregister();
    expect(target.removeEventListener).toHaveBeenCalledTimes(1);
    const third = register(target);
    expect(third).not.toBe(first);
    expect(target.addEventListener).toHaveBeenCalledTimes(2);
    third.unregister();
  });
  it("does not write registration state to the target", () => {
    let listener = null;
    const existingHook = {
      inject: vi.fn(() => 0),
      onCommitFiberRoot: vi.fn(),
      onPostCommitFiberRoot: vi.fn(),
      renderers: new Map(),
    };
    const target = Object.preventExtensions({
      __REACT_DEVTOOLS_GLOBAL_HOOK__: existingHook,
      addEventListener: vi.fn((type, callback) => {
        expect(type).toBe("devtoolstooldiscovery");
        listener = callback;
      }),
      removeEventListener: vi.fn(),
    });
    const first = register(target);
    const second = register(target);
    expect(target.addEventListener).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(second.facade).toBe(first.facade);
    expect(Object.keys(target).sort()).toEqual([
      "__REACT_DEVTOOLS_GLOBAL_HOOK__",
      "addEventListener",
      "removeEventListener",
    ]);
    first.unregister();
    second.unregister();
    expect(target.removeEventListener).toHaveBeenCalledWith("devtoolstooldiscovery", listener);
  });
  it('builds a "react" tool group exposing every facade tool', () => {
    expect(toolGroup.name).toBe("react");
    expect(typeof toolGroup.description).toBe("string");
    expect(toolGroup.description.length).toBeGreaterThan(0);
    expect(toolGroup.tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
    toolGroup.tools.forEach((tool) => {
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.type).toBe("object");
      expect(typeof tool.execute).toBe("function");
    });
    expect(getTool("react_get_parent_stack").description).toEqual(
      expect.stringContaining("Rendered parent chain"),
    );
    expect(getTool("react_get_owner_stack").description).toEqual(
      expect.stringContaining("Owners describe"),
    );
  });
  it("declares JSON-Schema input with required params", () => {
    expect(getTool("react_get_component_tree").inputSchema).toEqual({
      type: "object",
      properties: {
        depth: {
          type: "number",
          description: expect.any(String),
        },
        rootUid: {
          type: "string",
          description: expect.any(String),
        },
      },
    });
    expect(getTool("react_get_component_by_uid").inputSchema).toEqual({
      type: "object",
      properties: {
        uid: {
          type: "string",
          description: expect.any(String),
        },
        includeHooks: {
          type: "boolean",
          description: expect.any(String),
        },
      },
      required: ["uid"],
    });
    expect(getTool("react_get_component_by_dom_element").inputSchema).toEqual({
      type: "object",
      properties: {
        element: {
          type: "object",
          "x-mcp-type": "HTMLElement",
          description: expect.any(String),
        },
      },
      required: ["element"],
    });
    expect(getTool("react_find_components").inputSchema).toEqual({
      type: "object",
      properties: {
        name: {
          type: "string",
          description: expect.any(String),
        },
        rootUid: {
          type: "string",
          description: expect.any(String),
        },
        page: {
          type: "number",
          description: expect.any(String),
        },
        pageSize: {
          type: "number",
          description: expect.any(String),
        },
      },
      required: ["name"],
    });
    expect(getTool("react_get_parent_stack").inputSchema).toEqual({
      type: "object",
      properties: {
        uid: {
          type: "string",
          description: expect.any(String),
        },
      },
      required: ["uid"],
    });
    expect(getTool("react_get_owner_stack").inputSchema).toEqual({
      type: "object",
      properties: {
        uid: {
          type: "string",
          description: expect.any(String),
        },
      },
      required: ["uid"],
    });
    expect(getTool("react_start_profiling").inputSchema).toEqual({
      type: "object",
      properties: {
        traceName: {
          type: "string",
          description: expect.any(String),
        },
      },
    });
    expect(getTool("react_get_commit_report").inputSchema).toEqual({
      type: "object",
      properties: {
        traceName: {
          type: "string",
          description: expect.any(String),
        },
        commitIndex: {
          type: "number",
          description: expect.any(String),
        },
      },
      required: ["traceName", "commitIndex"],
    });
    expect(getTool("react_stop_profiling").inputSchema).toEqual({
      type: "object",
      properties: {},
    });
  });
  it("react_get_component_tree returns the component tree", () => {
    const App = () => {
      return <div>hello</div>;
    };
    act(() => {
      ReactDOMClient.createRoot(container).render(<App />);
    });
    const result = getTool("react_get_component_tree").execute({});
    expect(result).toEqual({
      nodes: [
        {
          uid: expect.any(String),
          type: "root",
          name: "createRoot()",
          key: null,
          firstChild: expect.any(String),
          nextSibling: null,
        },
        {
          uid: expect.any(String),
          type: "function",
          name: "App",
          key: null,
          firstChild: expect.any(String),
          nextSibling: null,
        },
        {
          uid: expect.any(String),
          type: "host",
          name: "div",
          key: null,
          firstChild: null,
          nextSibling: null,
        },
      ],
    });
  });
  it("react_find_components maps args and returns paginated results", () => {
    const Card = () => {
      return <div>card</div>;
    };
    const App = () => {
      return (
        <div>
          <Card key="a" />
          <Card key="b" />
        </div>
      );
    };
    act(() => {
      ReactDOMClient.createRoot(container).render(<App />);
    });
    const result = getTool("react_find_components").execute({
      name: "Card",
    });
    expect(result).toEqual({
      page: 1,
      pageSize: 10,
      totalCount: 2,
      totalPages: 1,
      results: [
        {
          uid: expect.any(String),
          type: "function",
          name: "Card",
          key: "a",
          firstChild: expect.any(String),
          nextSibling: null,
        },
        {
          uid: expect.any(String),
          type: "function",
          name: "Card",
          key: "b",
          firstChild: expect.any(String),
          nextSibling: null,
        },
      ],
    });
  });
  it("react_get_component_by_uid returns props and hooks when requested", () => {
    const Counter = () => {
      const [count] = React.useState(3);
      return <div>{count}</div>;
    };
    act(() => {
      ReactDOMClient.createRoot(container).render(<Counter title="hi" />);
    });
    const result = getTool("react_get_component_tree").execute({});
    const tree = result.nodes;
    expect(tree).toEqual([
      {
        uid: expect.any(String),
        type: "root",
        name: "createRoot()",
        key: null,
        firstChild: expect.any(String),
        nextSibling: null,
      },
      {
        uid: expect.any(String),
        type: "function",
        name: "Counter",
        key: null,
        firstChild: expect.any(String),
        nextSibling: null,
      },
      {
        uid: expect.any(String),
        type: "host",
        name: "div",
        key: null,
        firstChild: null,
        nextSibling: null,
      },
    ]);
    const counter = tree.find((n) => n.name === "Counter");
    expect(counter.uid).toMatch(/^r\d+$/);
    const info = getTool("react_get_component_by_uid").execute({
      uid: counter.uid,
      includeHooks: true,
    });
    expect(info).toEqual({
      uid: expect.any(String),
      type: "function",
      name: "Counter",
      props: {
        title: "hi",
      },
      hooks: [
        {
          id: 0,
          name: "State",
          value: 3,
          subHooks: [],
        },
      ],
    });
    const infoWithoutHooks = getTool("react_get_component_by_uid").execute({
      uid: counter.uid,
    });
    expect(infoWithoutHooks).toEqual({
      uid: expect.any(String),
      type: "function",
      name: "Counter",
      props: {
        title: "hi",
      },
    });
  });
  it("react_get_parent_stack returns structural ancestors", () => {
    const Child = () => {
      return <span>leaf</span>;
    };
    const Owner = () => {
      return (
        <section>
          <Child />
        </section>
      );
    };
    act(() => {
      ReactDOMClient.createRoot(container).render(<Owner />);
    });
    const tree = getTool("react_get_component_tree").execute({}).nodes;
    const child = tree.find((n) => n.name === "Child");
    expect(
      getTool("react_get_parent_stack").execute({
        uid: child.uid,
      }),
    ).toEqual([
      {
        uid: expect.any(String),
        name: "section",
        type: "host",
      },
      {
        uid: expect.any(String),
        name: "Owner",
        type: "function",
      },
      {
        uid: expect.any(String),
        name: expect.any(String),
        type: "root",
      },
    ]);
  });
  it("react_get_component_by_dom_element returns the DOM element component", () => {
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
    const tree = getTool("react_get_component_tree").execute({}).nodes;
    const host = tree.find((n) => n.name === "button");
    const wrapper = tree.find((n) => n.name === "Wrapper");
    const result = getTool("react_get_component_by_dom_element").execute({
      element: button,
    });
    expect(result.uid).toBe(host.uid);
    expect(result.uid).not.toBe(wrapper.uid);
    expect(result).toMatchObject({
      type: "host",
      name: "button",
      props: {
        className: "action",
      },
    });
  });
  it("react_get_component_by_dom_element returns DOM-oriented errors", () => {
    expect(getTool("react_get_component_by_dom_element").execute({})).toEqual({
      error: "DOM element is required",
    });
    act(() => {
      ReactDOMClient.createRoot(container).render(<div className="host" />);
    });
    const unmanaged = document.createElement("span");
    expect(
      getTool("react_get_component_by_dom_element").execute({
        element: unmanaged,
      }),
    ).toEqual({
      error: "DOM element is not managed by React",
    });
  });
  it("returns tool errors as a raw payload", () => {
    const result = getTool("react_get_component_by_uid").execute({
      uid: "r9999",
    });
    expect(result).toEqual({
      error: 'Component not found: "r9999"',
    });
  });
  it("serializes Error tool payloads with causes", () => {
    const group = buildToolGroup({
      getComponentByUid: () => ({
        error: new Error("Failed to inspect hooks.", {
          cause: new Error("Cannot inspect hooks"),
        }),
      }),
    });
    const tool = group.tools.find((item) => item.name === "react_get_component_by_uid");
    expect(
      tool.execute({
        uid: expect.any(String),
        includeHooks: true,
      }),
    ).toEqual({
      error: "Failed to inspect hooks. Cause: Cannot inspect hooks",
    });
  });
  it("profiling tools record and report commits through the integration", () => {
    const Counter = ({ count }) => {
      return <div>{"Count: " + count}</div>;
    };
    const root = ReactDOMClient.createRoot(container);
    act(() => {
      root.render(<Counter count={0} />);
    });
    expect(
      getTool("react_start_profiling").execute({
        traceName: "trace",
      }),
    ).toEqual({
      status: "started",
      traceName: "trace",
    });
    act(() => {
      root.render(<Counter count={1} />);
    });
    expect(getTool("react_stop_profiling").execute({})).toEqual({
      status: "stopped",
      traceName: "trace",
      commits: 1,
    });
    const overview = getTool("react_get_trace_overview").execute({
      traceName: "trace",
    });
    expect(overview).toHaveLength(1);
    expect(overview[0].commit).toBe(0);
    const report = getTool("react_get_commit_report").execute({
      traceName: "trace",
      commitIndex: 0,
    });
    expect(
      report.components.map((c) => ({
        uid: c.uid,
        name: c.name,
        type: c.type,
      })),
    ).toEqual([
      {
        uid: expect.any(String),
        name: "createRoot()",
        type: "root",
      },
      {
        uid: expect.any(String),
        name: "Counter",
        type: "function",
      },
      {
        uid: expect.any(String),
        name: "div",
        type: "host",
      },
    ]);
  });
  it("responds synchronously to discovery with the react tool group", () => {
    const discovered = discover();
    expect(discovered).not.toBe(null);
    expect(discovered.name).toBe("react");
    expect(discovered.tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
  });
  it("builds the tool group lazily and memoizes it across discoveries", () => {
    expect(discover()).toBe(discover());
  });
  it("unregister removes the discovery listener", () => {
    unregister();
    expect(discover()).toBe(null);
  });
  it("tools are callable via window.__dtmcp.executeTool", async () => {
    const App = () => {
      return <div>hello</div>;
    };
    act(() => {
      ReactDOMClient.createRoot(container).render(<App />);
    });
    const event = new CustomEvent("devtoolstooldiscovery");
    event.respondWith = (group) => {
      globalThis.__dtmcp = {
        toolGroup: group,
        executeTool: async (toolName, args) => {
          const tool = group.tools.find((t) => t.name === toolName);
          return tool.execute(args);
        },
      };
    };
    window.dispatchEvent(event);
    const result = await globalThis.__dtmcp.executeTool("react_get_component_tree", {});
    expect(result).toEqual({
      nodes: [
        {
          uid: expect.any(String),
          type: "root",
          name: "createRoot()",
          key: null,
          firstChild: expect.any(String),
          nextSibling: null,
        },
        {
          uid: expect.any(String),
          type: "function",
          name: "App",
          key: null,
          firstChild: expect.any(String),
          nextSibling: null,
        },
        {
          uid: expect.any(String),
          type: "host",
          name: "div",
          key: null,
          firstChild: null,
          nextSibling: null,
        },
      ],
    });
  });
});
