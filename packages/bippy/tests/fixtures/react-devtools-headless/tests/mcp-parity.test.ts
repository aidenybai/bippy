import "../src/index.js";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { installFacade } from "../src/facade.js";
import { createTools } from "../src/index.js";
import { buildToolGroup, register } from "../src/mcp.js";
import type { McpTarget } from "../src/mcp.js";
import type { Tools } from "../src/types.js";

const registrations: Array<ReturnType<typeof register>> = [];

afterEach(() => {
  for (const registration of registrations.splice(0)) registration.unregister();
  vi.unstubAllGlobals();
});

describe("remaining upstream MCP conformance", () => {
  it("keeps root exports registration-free", () => {
    const target: Record<string, unknown> = {};
    const facade = installFacade(target);
    expect(target.__dtmcp).toBeUndefined();
    facade.dispose();
  });

  it("does not expose cached registration state on the target", () => {
    const eventTarget = new EventTarget();
    const target: McpTarget = {
      addEventListener: (event, listener) => eventTarget.addEventListener(event, listener),
      removeEventListener: (event, listener) => eventTarget.removeEventListener(event, listener),
    };
    registrations.push(register(target));
    expect(Reflect.ownKeys(target)).not.toContain("registration");
  });

  it("normalizes non-Error thrown payloads", () => {
    const facade = installFacade({});
    const tools: Tools = createTools(facade);
    Reflect.set(tools, "getComponentByUid", () => ({ error: { reason: "failure" } }));
    const tool = buildToolGroup(tools).tools.find(
      (candidate) => candidate.name === "react_get_component_by_uid",
    );
    expect(tool?.execute({ uid: "missing" })).toEqual({ error: "[object Object]" });
    facade.dispose();
  });

  it("returns the documented error shape when a tool throws", () => {
    const facade = installFacade({});
    const tools: Tools = createTools(facade);
    Reflect.set(tools, "getComponentByUid", () => {
      throw new Error("Failed to inspect props.", { cause: new Error("getter exploded") });
    });
    const tool = buildToolGroup(tools).tools.find(
      (candidate) => candidate.name === "react_get_component_by_uid",
    );
    expect(tool?.execute({ uid: "r1" })).toEqual({
      error: "Failed to inspect props. Cause: getter exploded",
    });
    facade.dispose();
  });

  it("supports external __dtmcp execution ownership", () => {
    const facade = installFacade({});
    const group = buildToolGroup(createTools(facade));
    const executeTool = (name: string, arguments_: Record<string, unknown>): unknown =>
      group.tools.find((tool) => tool.name === name)?.execute(arguments_);
    expect(executeTool("react_get_component_tree", {})).toEqual({
      error: "No mounted React roots found",
    });
    facade.dispose();
  });
});
