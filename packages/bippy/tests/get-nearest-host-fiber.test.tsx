import "../src/index.js"; // HACK: Bippy must initialize before imports that load React.

import { render } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vite-plus/test";
import { getNearestHostFiber, getNearestHostFibers, instrument } from "../src/index.js";
import type { Fiber } from "../src/index.js";
import { createFiber } from "./create-fiber.js";
import { latestReactWorkTags } from "./react-work-tags.js";
import { requireFiber } from "./require-fiber.js";

export const Example = () => {
  return <div>Hello</div>;
};

interface ExampleWithChildrenPropProps {
  children: React.ReactNode;
}

export const ExampleWithChildrenProp = ({ children }: ExampleWithChildrenPropProps) => {
  return <div>{children}</div>;
};

export const ExampleWithMultipleChildElements = () => {
  return (
    <>
      <div>Hello</div>
      <div>Hello</div>
    </>
  );
};

export const ExampleWithUnmount = () => {
  const [shouldUnmount, setShouldUnmount] = React.useState(true);
  React.useEffect(() => {
    setShouldUnmount(false);
  }, []);
  return shouldUnmount ? <div>Hello</div> : null;
};

describe("getNearestHostFiber", () => {
  it("should return the nearest host fiber", () => {
    let maybeFiber: Fiber | null = null;
    let maybeHostFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        const componentFiber = fiberRoot.current.child;
        if (!componentFiber) throw new Error("React DOM did not render the component fiber");
        maybeFiber = componentFiber;
        maybeHostFiber = componentFiber.child;
      },
    });
    render(<Example />);
    expect(getNearestHostFiber(requireFiber(maybeFiber, "React DOM did not render a Fiber"))).toBe(
      requireFiber(maybeFiber, "React DOM did not render a Fiber").child,
    );
    expect(maybeHostFiber).toBe(
      getNearestHostFiber(requireFiber(maybeFiber, "React DOM did not render a Fiber")),
    );
  });

  it("should return null for unmounted fiber", () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ExampleWithUnmount />);
    expect(getNearestHostFiber(requireFiber(maybeFiber, "React DOM did not render a Fiber"))).toBe(
      null,
    );
  });
});

export const ExampleWithCompositeChildren = () => {
  return (
    <>
      <Example />
      <Example />
    </>
  );
};

describe("getNearestHostFibers", () => {
  it("should return all host fibers", () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ExampleWithMultipleChildElements />);
    expect(
      getNearestHostFibers(requireFiber(maybeFiber, "React DOM did not render a Fiber")),
    ).toHaveLength(2);
  });

  it("should return the fiber itself when it is a host fiber", () => {
    let maybeHostFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        const componentFiber = fiberRoot.current.child;
        if (!componentFiber) throw new Error("React DOM did not render the component fiber");
        maybeHostFiber = componentFiber.child;
      },
    });
    render(<Example />);
    const hostFibers = getNearestHostFibers(
      requireFiber(maybeHostFiber, "React DOM did not render a host Fiber"),
    );
    expect(hostFibers).toHaveLength(1);
    expect(hostFibers[0]).toBe(maybeHostFiber);
  });

  it("should traverse through composite children", () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ExampleWithCompositeChildren />);
    expect(
      getNearestHostFibers(requireFiber(maybeFiber, "React DOM did not render a Fiber")),
    ).toHaveLength(2);
  });

  it("should return an empty array for a childless composite fiber", () => {
    const childlessCompositeFiber = createFiber({
      child: null,
      sibling: null,
      tag: latestReactWorkTags.FunctionComponent,
      type: () => null,
    });
    expect(getNearestHostFibers(childlessCompositeFiber)).toHaveLength(0);
  });

  it("should skip childless composite fibers while traversing", () => {
    const hostFiber = createFiber({
      child: null,
      sibling: null,
      tag: latestReactWorkTags.HostComponent,
      type: "div",
    });
    const childlessCompositeFiber = createFiber({
      child: null,
      sibling: hostFiber,
      tag: latestReactWorkTags.FunctionComponent,
      type: () => null,
    });
    const rootCompositeFiber = createFiber({
      child: childlessCompositeFiber,
      sibling: null,
      tag: latestReactWorkTags.FunctionComponent,
      type: () => null,
    });
    expect(getNearestHostFibers(rootCompositeFiber)).toEqual([hostFiber]);
  });
});
