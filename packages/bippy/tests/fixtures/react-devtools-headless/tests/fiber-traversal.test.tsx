import "../src/index.js";

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { installFacade } from "../src/facade.js";
import { getFiberOwners } from "../src/fiber-traversal.js";
import type { Fiber, ServerComponentInfo } from "bippy";
import type { Facade } from "../src/types.js";

let facade: Facade;
let templateFiber: Fiber;

beforeEach(() => {
  facade = installFacade();
  const App = () => <div />;
  render(<App />);
  const root = facade.fiberRoots.values().next().value?.values().next().value;
  if (!root) throw new Error("Missing root");
  templateFiber = root.current;
});

afterEach(() => {
  cleanup();
  facade.dispose();
});

describe("Fiber owner traversal", () => {
  it("stops walking a cyclic server component owner chain", () => {
    const outerOwner: ServerComponentInfo = { name: "Outer" };
    const innerOwner: ServerComponentInfo = { name: "Inner", owner: outerOwner };
    outerOwner.owner = innerOwner;
    const fiber: Fiber = { ...templateFiber, _debugOwner: innerOwner };
    expect(getFiberOwners(fiber)).toEqual([]);
  });

  it("stops walking a cyclic Fiber owner chain", () => {
    const ownerFiber: Fiber = { ...templateFiber };
    ownerFiber._debugOwner = ownerFiber;
    const fiber: Fiber = { ...templateFiber, _debugOwner: ownerFiber };
    const owners = getFiberOwners(fiber);
    expect(owners).toHaveLength(1);
    expect(owners[0]).toBe(ownerFiber);
  });
});
