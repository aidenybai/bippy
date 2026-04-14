import "../index.js"; // KEEP THIS LINE ON TOP

import { describe, expect, it, vi } from "vitest";
import type { Fiber } from "../types.js";
import {
  HostPortalTag,
  getFiberKind,
  getNearestHostFiber,
  getNearestHostFibers,
  instrument,
  isCompositeFiber,
  isHostFiber,
  traverseFiber,
  traverseRenderedFibers,
} from "../index.js";
import React from "react";
import { createPortal } from "react-dom";
import { act, fireEvent, render } from "@testing-library/react";

const PortalChild = () => {
  return <span>portal content</span>;
};

const PortalExample = ({ container }: { container: HTMLElement }) => {
  return (
    <div>
      <p>main tree</p>
      {createPortal(<PortalChild />, container)}
    </div>
  );
};

describe("getFiberKind", () => {
  it('should return "host-portal" for a portal fiber', () => {
    const portalContainer = document.createElement("div");
    document.body.appendChild(portalContainer);

    let rootFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        rootFiber = fiberRoot.current;
      },
    });
    render(<PortalExample container={portalContainer} />);

    const portalFiber = traverseFiber(rootFiber, (fiber) => fiber.tag === HostPortalTag);
    expect(portalFiber).not.toBeNull();
    expect(getFiberKind(portalFiber!)).toBe("host-portal");

    document.body.removeChild(portalContainer);
  });

  it('should return "host-component" for a host fiber', () => {
    let rootFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        rootFiber = fiberRoot.current;
      },
    });
    render(<div>hello</div>);

    const divFiber = traverseFiber(rootFiber, isHostFiber);
    expect(divFiber).not.toBeNull();
    expect(getFiberKind(divFiber!)).toBe("host-component");
  });

  it('should return "function-component" for a function component fiber', () => {
    let rootFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        rootFiber = fiberRoot.current;
      },
    });
    render(<PortalChild />);

    const componentFiber = traverseFiber(rootFiber, (fiber) => fiber.type === PortalChild);
    expect(componentFiber).not.toBeNull();
    expect(getFiberKind(componentFiber!)).toBe("function-component");
  });
});

describe("traverseFiber with portals", () => {
  it("should traverse into portal children (descending)", () => {
    const portalContainer = document.createElement("div");
    document.body.appendChild(portalContainer);

    let rootFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        rootFiber = fiberRoot.current;
      },
    });
    render(<PortalExample container={portalContainer} />);

    const portalChildFiber = traverseFiber(rootFiber, (fiber) => fiber.type === PortalChild);
    expect(portalChildFiber).not.toBeNull();
    expect(portalChildFiber!.type).toBe(PortalChild);

    document.body.removeChild(portalContainer);
  });

  it("should traverse from portal child back to parent (ascending)", () => {
    const portalContainer = document.createElement("div");
    document.body.appendChild(portalContainer);

    let rootFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        rootFiber = fiberRoot.current;
      },
    });
    render(<PortalExample container={portalContainer} />);

    const portalChildFiber = traverseFiber(rootFiber, (fiber) => fiber.type === PortalChild);
    expect(portalChildFiber).not.toBeNull();

    const parentFiber = traverseFiber(
      portalChildFiber,
      (fiber) => fiber.type === PortalExample,
      true,
    );
    expect(parentFiber).not.toBeNull();
    expect(parentFiber!.type).toBe(PortalExample);

    document.body.removeChild(portalContainer);
  });

  it("should find host fibers inside a portal via getNearestHostFibers", () => {
    const portalContainer = document.createElement("div");
    document.body.appendChild(portalContainer);

    let rootFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        rootFiber = fiberRoot.current;
      },
    });
    render(<PortalExample container={portalContainer} />);

    const portalChildFiber = traverseFiber(rootFiber, (fiber) => fiber.type === PortalChild);
    expect(portalChildFiber).not.toBeNull();

    const hostFibers = getNearestHostFibers(portalChildFiber!);
    expect(hostFibers.length).toBeGreaterThan(0);
    expect(hostFibers[0].type).toBe("span");

    document.body.removeChild(portalContainer);
  });

  it("should find a host fiber from a portal child via getNearestHostFiber", () => {
    const portalContainer = document.createElement("div");
    document.body.appendChild(portalContainer);

    let rootFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        rootFiber = fiberRoot.current;
      },
    });
    render(<PortalExample container={portalContainer} />);

    const portalChildFiber = traverseFiber(rootFiber, (fiber) => fiber.type === PortalChild);
    expect(portalChildFiber).not.toBeNull();

    const hostFiber = getNearestHostFiber(portalChildFiber!);
    expect(hostFiber).not.toBeNull();
    expect(hostFiber!.type).toBe("span");

    document.body.removeChild(portalContainer);
  });
});

describe("traverseRenderedFibers with portals", () => {
  it("should report portal children during mount", () => {
    const portalContainer = document.createElement("div");
    document.body.appendChild(portalContainer);

    const renderedFibers: Fiber[] = [];
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        traverseRenderedFibers(fiberRoot, (fiber, phase) => {
          if (phase === "mount") {
            renderedFibers.push(fiber);
          }
        });
      },
    });
    render(<PortalExample container={portalContainer} />);

    const portalChildRendered = renderedFibers.some((fiber) => fiber.type === PortalChild);
    expect(portalChildRendered).toBe(true);

    const hasCompositeFibersInPortal = renderedFibers.some(
      (fiber) => isCompositeFiber(fiber) && fiber.type === PortalChild,
    );
    expect(hasCompositeFibersInPortal).toBe(true);

    document.body.removeChild(portalContainer);
  });

  it("should report portal children during update", () => {
    const portalContainer = document.createElement("div");
    document.body.appendChild(portalContainer);

    const UpdateablePortalExample = () => {
      const [count, setCount] = React.useState(0);
      return (
        <div>
          <button onClick={() => setCount((previous) => previous + 1)}>increment</button>
          {createPortal(<span>{count}</span>, portalContainer)}
        </div>
      );
    };

    const phases: string[] = [];
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        traverseRenderedFibers(fiberRoot, (_fiber, phase) => {
          phases.push(phase);
        });
      },
    });

    const { getByText } = render(<UpdateablePortalExample />);

    const mountPhases = [...phases];
    expect(mountPhases.some((phase) => phase === "mount")).toBe(true);

    phases.length = 0;
    act(() => {
      fireEvent.click(getByText("increment"));
    });

    expect(phases.some((phase) => phase === "update")).toBe(true);

    document.body.removeChild(portalContainer);
  });
});

describe("portal fiber properties", () => {
  it("should have the portal container as stateNode", () => {
    const portalContainer = document.createElement("div");
    document.body.appendChild(portalContainer);

    let rootFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        rootFiber = fiberRoot.current;
      },
    });
    render(<PortalExample container={portalContainer} />);

    const portalFiber = traverseFiber(rootFiber, (fiber) => fiber.tag === HostPortalTag);
    expect(portalFiber).not.toBeNull();
    expect(portalFiber!.stateNode.containerInfo).toBe(portalContainer);

    document.body.removeChild(portalContainer);
  });

  it("HostPortalTag should equal 4", () => {
    expect(HostPortalTag).toBe(4);
  });
});
