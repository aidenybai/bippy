import "../src/index.js";

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import React from "react";
import { jsx } from "react/jsx-runtime";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { buildToolGroup, createTools, installFacade } from "../src/index.js";
import type { Facade, McpToolGroup, Tools, TreeNode } from "../src/index.js";

interface FancyInputProps {
  placeholder: string;
}

interface MemoBoxProps {
  label: string;
}

interface ThemeProviderProps {
  children: React.ReactNode;
}

interface TodoProps {
  text: string;
}

interface ToggleState {
  isOn: boolean;
  toggle: () => void;
}

let facade: Facade;
let tools: Tools;
let toolGroup: McpToolGroup;

const useToggle = (initialValue: boolean): ToggleState => {
  const [isOn, setIsOn] = React.useState(initialValue);
  const toggle = React.useCallback(() => setIsOn((currentValue) => !currentValue), []);
  return { isOn, toggle };
};

const Counter = () => {
  const [count, setCount] = React.useState(0);
  return (
    <div>
      <span>{`Count: ${count}`}</span>
      <button onClick={() => setCount((currentCount) => currentCount + 1)}>+1</button>
    </div>
  );
};

const Toggle = () => {
  const { isOn, toggle } = useToggle(false);
  return <button onClick={toggle}>{isOn ? "ON" : "OFF"}</button>;
};

const Clock = () => {
  const [currentTime, setCurrentTime] = React.useState(() => new Date().toLocaleTimeString());
  React.useEffect(() => {
    const interval = setInterval(() => setCurrentTime(new Date().toLocaleTimeString()), 1_000);
    return () => clearInterval(interval);
  }, []);
  return <div>{`Clock: ${currentTime}`}</div>;
};

const ThemeContext = React.createContext("light");

const ThemeProvider = ({ children }: ThemeProviderProps) => (
  <ThemeContext.Provider value="dark">{children}</ThemeContext.Provider>
);

const ThemedPanel = () => {
  const theme = React.useContext(ThemeContext);
  return (
    <section data-theme={theme}>
      <h2>{`Panel (theme: ${theme})`}</h2>
      <Counter />
      <Toggle />
      <Clock />
    </section>
  );
};

const Todo = ({ text }: TodoProps) => <li>{text}</li>;

const TodoList = () => {
  const items = [
    { id: "learn", text: "Learn the tools" },
    { id: "test", text: "Test the fixture" },
    { id: "ship", text: "Ship the package" },
  ];
  return (
    <ul>
      {items.map((item) => (
        <Todo key={item.id} text={item.text} />
      ))}
    </ul>
  );
};

const MemoBox = React.memo(({ label }: MemoBoxProps) => <div>{`Memo: ${label}`}</div>);
MemoBox.displayName = "MemoBox";

const FancyInput = React.forwardRef<HTMLInputElement, FancyInputProps>(
  ({ placeholder }, reference) => <input ref={reference} placeholder={placeholder} />,
);
FancyInput.displayName = "FancyInput";

const Hazard = () => <div>hazard</div>;

const Header = () => (
  <header>
    <h1>react-devtools-cdt-mcp fixture</h1>
  </header>
);

const App = () => (
  <main>
    <Header />
    <ThemeProvider>
      <ThemedPanel />
    </ThemeProvider>
    <TodoList />
    <MemoBox label="hello" />
    <FancyInput placeholder="type here" />
  </main>
);

const executeTool = (name: string, arguments_: Record<string, unknown> = {}): unknown => {
  const tool = toolGroup.tools.find((candidateTool) => candidateTool.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool.execute(arguments_);
};

const getTree = (): TreeNode[] => {
  const result = executeTool("react_get_component_tree");
  if (typeof result !== "object" || result === null) throw new Error("Missing tree result");
  const nodes = Reflect.get(result, "nodes");
  if (!Array.isArray(nodes)) throw new Error("Missing tree nodes");
  return nodes;
};

const getNode = (name: string): TreeNode => {
  const node = getTree().find((candidateNode) => candidateNode.name === name);
  if (!node) throw new Error(`Missing node: ${name}`);
  return node;
};

beforeEach(() => {
  facade = installFacade();
  tools = createTools(facade);
  toolGroup = buildToolGroup(tools);
});

afterEach(() => {
  cleanup();
  facade.dispose();
});

describe("upstream Chrome DevTools MCP fixture workflow", () => {
  it("executes discovery, inspection, ownership, source, DOM, search, and profiling", () => {
    const rendered = render(<App />);

    expect(toolGroup).toMatchObject({ name: "react" });
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
    for (const tool of toolGroup.tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }

    const tree = getTree();
    expect(tree.filter((node) => node.name === "Todo")).toHaveLength(3);
    expect(getNode("Counter").type).toBe("function");
    expect(getNode("TodoList").type).toBe("function");
    expect(getNode("ul").type).toBe("host");
    expect(getNode("main").type).toBe("host");
    expect(getNode("App").type).toBe("function");
    expect(tree.some((node) => node.type === "root")).toBe(true);
    expect(getNode("MemoBox").type).toBe("memo");
    expect(getNode("FancyInput").type).toBe("forwardRef");
    expect(getNode("input").type).toBe("host");

    const counter = getNode("Counter");
    expect(
      executeTool("react_get_component_by_uid", { includeHooks: true, uid: counter.uid }),
    ).toMatchObject({
      hooks: expect.arrayContaining([expect.objectContaining({ name: "State" })]),
      name: "Counter",
    });

    expect(executeTool("react_find_components", { name: "Todo", pageSize: 2 })).toMatchObject({
      page: 1,
      pageSize: 2,
      results: [
        expect.objectContaining({ name: "TodoList" }),
        expect.objectContaining({ name: "Todo" }),
      ],
      totalCount: 4,
      totalPages: 2,
    });

    const incrementButton = rendered.getByRole("button", { name: "+1" });
    expect(
      executeTool("react_get_component_by_dom_element", { element: incrementButton }),
    ).toMatchObject({
      name: "button",
      type: "host",
    });

    const todo = tree.find((node) => node.name === "Todo");
    if (!todo) throw new Error("Missing Todo");
    expect(executeTool("react_get_component_source", { uid: counter.uid })).toMatchObject({
      source: expect.objectContaining({
        fileName: expect.stringContaining("mcp-fixture-e2e.test.tsx"),
      }),
    });
    expect(executeTool("react_get_owner_stack_trace", { uid: todo.uid })).toHaveProperty("stack");
    expect(executeTool("react_get_parent_stack", { uid: todo.uid })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "TodoList" }),
        expect.objectContaining({ name: "main" }),
        expect.objectContaining({ name: "App" }),
      ]),
    );
    expect(executeTool("react_get_owner_stack", { uid: todo.uid })).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "TodoList" })]),
    );
    expect(executeTool("react_get_component_by_uid", { uid: "r999999" })).toEqual({
      error: 'Component not found: "r999999"',
    });

    expect(executeTool("react_start_profiling", { traceName: "fixture" })).toEqual({
      status: "started",
      traceName: "fixture",
    });
    act(() => fireEvent.click(incrementButton));
    expect(executeTool("react_stop_profiling")).toMatchObject({
      commits: 1,
      status: "stopped",
      traceName: "fixture",
    });
    expect(executeTool("react_get_trace_overview", { traceName: "fixture" })).toEqual([
      expect.objectContaining({ commit: 0, componentsChanged: expect.any(Number) }),
    ]);
    expect(
      executeTool("react_get_commit_report", { commitIndex: 0, traceName: "fixture" }),
    ).toMatchObject({
      components: expect.arrayContaining([expect.objectContaining({ name: "Counter" })]),
    });
  });

  it("inspects hostile props without escaping the tool result shape", () => {
    const hazardousProps: Record<string, unknown> = {
      schedule: new Map([["monday", new Date("2024-01-02T03:04:05.000Z")]]),
      tags: new Set(["urgent"]),
    };
    Object.defineProperty(hazardousProps, "boom", {
      enumerable: true,
      get: () => {
        throw new Error("getter exploded");
      },
    });
    render(jsx(Hazard, hazardousProps));

    const hazard = getNode("Hazard");
    expect(executeTool("react_get_component_by_uid", { uid: hazard.uid })).toEqual({
      name: "Hazard",
      props: {
        boom: "[Exception: getter exploded]",
        schedule: {
          entries: [["monday", "[Date 2024-01-02T03:04:05.000Z]"]],
          size: 1,
          type: "Map",
        },
        tags: { entries: ["urgent"], size: 1, type: "Set" },
      },
      type: "function",
      uid: hazard.uid,
    });
  });
});
