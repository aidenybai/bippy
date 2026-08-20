import type { ReactDevToolsTarget } from "bippy";
import { installFacade } from "./facade.js";
import { createTools } from "./index.js";
import type { Facade, Tools } from "./types.js";

export interface McpTool {
  description: string;
  execute: (arguments_: Record<string, unknown>) => unknown;
  inputSchema: Record<string, unknown>;
  name: string;
}

export interface McpToolGroup {
  description: string;
  name: string;
  tools: McpTool[];
}

export interface McpTarget extends ReactDevToolsTarget {
  addEventListener: (event: string, listener: EventListener) => void;
  removeEventListener: (event: string, listener: EventListener) => void;
}

export interface McpRegistration {
  facade: Facade;
  unregister: () => void;
}

interface ToolDefinition {
  call: (tools: Tools, arguments_: Record<string, unknown>) => unknown;
  description: string;
  inputSchema: Record<string, unknown>;
  name: string;
}

const getString = (arguments_: Record<string, unknown>, key: string): string | undefined => {
  const value = arguments_[key];
  return typeof value === "string" ? value : undefined;
};

const getNumber = (arguments_: Record<string, unknown>, key: string): number | undefined => {
  const value = arguments_[key];
  return typeof value === "number" ? value : undefined;
};

const getBoolean = (arguments_: Record<string, unknown>, key: string): boolean | undefined => {
  const value = arguments_[key];
  return typeof value === "boolean" ? value : undefined;
};

const objectSchema = (properties: Record<string, unknown>, required?: string[]) => ({
  properties,
  ...(required ? { required } : {}),
  type: "object",
});

const toolDefinitions: ToolDefinition[] = [
  {
    call: (tools, arguments_) => {
      const result = tools.getComponentTree(
        getNumber(arguments_, "depth"),
        getString(arguments_, "rootUid"),
      );
      return Array.isArray(result) ? { nodes: result } : result;
    },
    description: "Snapshot the mounted React component tree.",
    inputSchema: objectSchema({
      depth: { description: "Maximum tree depth.", type: "number" },
      rootUid: { description: "Optional subtree root uid.", type: "string" },
    }),
    name: "react_get_component_tree",
  },
  {
    call: (tools, arguments_) =>
      tools.getComponentByUid(
        getString(arguments_, "uid") ?? "",
        getBoolean(arguments_, "includeHooks"),
      ),
    description: "Inspect one React component by stable uid.",
    inputSchema: objectSchema(
      {
        includeHooks: { description: "Whether to inspect hooks.", type: "boolean" },
        uid: { description: "Component uid.", type: "string" },
      },
      ["uid"],
    ),
    name: "react_get_component_by_uid",
  },
  {
    call: (tools, arguments_) => {
      if (arguments_.element === null || arguments_.element === undefined) {
        return { error: "DOM element is required" };
      }
      const result = tools.getComponentByHostInstance(arguments_.element);
      return "error" in result && result.error === "Host instance is not managed by React"
        ? { error: "DOM element is not managed by React" }
        : result;
    },
    description: "Inspect the React host component for a DOM element.",
    inputSchema: objectSchema(
      {
        element: {
          description: "DOM element managed by React.",
          type: "object",
          "x-mcp-type": "HTMLElement",
        },
      },
      ["element"],
    ),
    name: "react_get_component_by_dom_element",
  },
  {
    call: (tools, arguments_) =>
      tools.findComponents(
        getString(arguments_, "name") ?? "",
        getString(arguments_, "rootUid"),
        getNumber(arguments_, "page"),
        getNumber(arguments_, "pageSize"),
      ),
    description: "Find React components by case-insensitive display-name substring.",
    inputSchema: objectSchema(
      {
        name: { description: "Component name query.", type: "string" },
        page: { description: "One-based page number.", type: "number" },
        pageSize: { description: "Results per page.", type: "number" },
        rootUid: { description: "Optional subtree root uid.", type: "string" },
      },
      ["name"],
    ),
    name: "react_find_components",
  },
  {
    call: (tools, arguments_) => tools.getComponentSource(getString(arguments_, "uid") ?? ""),
    description: "Get a component definition source location.",
    inputSchema: objectSchema({ uid: { description: "Component uid.", type: "string" } }, ["uid"]),
    name: "react_get_component_source",
  },
  {
    call: (tools, arguments_) => tools.getOwnerStackTrace(getString(arguments_, "uid") ?? ""),
    description: "Get a raw React owner stack trace.",
    inputSchema: objectSchema({ uid: { description: "Component uid.", type: "string" } }, ["uid"]),
    name: "react_get_owner_stack_trace",
  },
  {
    call: (tools, arguments_) => tools.getParentStack(getString(arguments_, "uid") ?? ""),
    description: "Get the Rendered parent chain from a component to its root.",
    inputSchema: objectSchema({ uid: { description: "Component uid.", type: "string" } }, ["uid"]),
    name: "react_get_parent_stack",
  },
  {
    call: (tools, arguments_) => tools.getOwnerStack(getString(arguments_, "uid") ?? ""),
    description: "Get JSX owners. Owners describe where components were created.",
    inputSchema: objectSchema({ uid: { description: "Component uid.", type: "string" } }, ["uid"]),
    name: "react_get_owner_stack",
  },
  {
    call: (tools, arguments_) => tools.startProfiling(getString(arguments_, "traceName")),
    description: "Start recording React commits.",
    inputSchema: objectSchema({
      traceName: { description: "Optional profiling trace name.", type: "string" },
    }),
    name: "react_start_profiling",
  },
  {
    call: (tools) => tools.stopProfiling(),
    description: "Stop the active React profiling trace.",
    inputSchema: objectSchema({}),
    name: "react_stop_profiling",
  },
  {
    call: (tools, arguments_) => tools.getTraceOverview(getString(arguments_, "traceName") ?? ""),
    description: "Get the per-commit overview for a React profiling trace.",
    inputSchema: objectSchema(
      { traceName: { description: "Profiling trace name.", type: "string" } },
      ["traceName"],
    ),
    name: "react_get_trace_overview",
  },
  {
    call: (tools, arguments_) =>
      tools.getCommitReport(
        getString(arguments_, "traceName") ?? "",
        getNumber(arguments_, "commitIndex") ?? -1,
      ),
    description: "Get a detailed React profiling commit report.",
    inputSchema: objectSchema(
      {
        commitIndex: { description: "Zero-based commit index.", type: "number" },
        traceName: { description: "Profiling trace name.", type: "string" },
      },
      ["traceName", "commitIndex"],
    ),
    name: "react_get_commit_report",
  },
];

const formatError = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  return error.cause ? `${error.message} Cause: ${formatError(error.cause)}` : error.message;
};

const normalizeToolResult = (result: unknown): unknown => {
  if (typeof result !== "object" || result === null || !("error" in result)) return result;
  const error = Reflect.get(result, "error");
  return typeof error === "string" ? result : { ...result, error: formatError(error) };
};

export const buildToolGroup = (tools: Tools): McpToolGroup => ({
  description: "Inspect and profile the running React app through Bippy-backed tools.",
  name: "react",
  tools: toolDefinitions.map((definition) => ({
    description: definition.description,
    execute: (arguments_) => normalizeToolResult(definition.call(tools, arguments_ ?? {})),
    inputSchema: definition.inputSchema,
    name: definition.name,
  })),
});

const registrations = new WeakMap<McpTarget, McpRegistration>();

export const register = (target: McpTarget = globalThis): McpRegistration => {
  if (
    typeof target?.addEventListener !== "function" ||
    typeof target.removeEventListener !== "function"
  ) {
    throw new Error(
      "react-devtools-headless/register must be imported in a browser-like environment",
    );
  }
  const existingRegistration = registrations.get(target);
  if (existingRegistration) return existingRegistration;
  const facade = installFacade(target);
  let toolGroup: McpToolGroup | null = null;
  const listener: EventListener = (event) => {
    const respondWith = Reflect.get(event, "respondWith");
    if (typeof respondWith !== "function") return;
    toolGroup ??= buildToolGroup(createTools(facade));
    Reflect.apply(respondWith, event, [toolGroup]);
  };
  target.addEventListener("devtoolstooldiscovery", listener);
  let isRegistered = true;
  const registration: McpRegistration = {
    facade,
    unregister: () => {
      if (!isRegistered) return;
      isRegistered = false;
      target.removeEventListener("devtoolstooldiscovery", listener);
      registrations.delete(target);
      facade.dispose();
    },
  };
  registrations.set(target, registration);
  return registration;
};
