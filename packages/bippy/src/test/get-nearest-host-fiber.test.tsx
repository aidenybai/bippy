import "../index.js"; // KEEP THIS LINE ON TOP

import { render } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { Fiber, getNearestHostFiber, getNearestHostFibers, instrument } from "../index.js";

export const Example = () => {
  return <div>Hello</div>;
};

export const ExampleWithChildrenProp = ({ children }: { children: React.ReactNode }) => {
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
        maybeFiber = fiberRoot.current.child;
        maybeHostFiber = fiberRoot.current.child.child;
      },
    });
    render(<Example />);
    expect(getNearestHostFiber(maybeFiber as unknown as Fiber)).toBe(
      (maybeFiber as unknown as Fiber).child,
    );
    expect(maybeHostFiber).toBe(getNearestHostFiber(maybeFiber as unknown as Fiber));
  });

  it("should return null for unmounted fiber", () => {
    let maybeFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeFiber = fiberRoot.current.child;
      },
    });
    render(<ExampleWithUnmount />);
    expect(getNearestHostFiber(maybeFiber as unknown as Fiber)).toBe(null);
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
    expect(getNearestHostFibers(maybeFiber as unknown as Fiber)).toHaveLength(2);
  });

  it("should return the fiber itself when it is a host fiber", () => {
    let maybeHostFiber: Fiber | null = null;
    instrument({
      onCommitFiberRoot: (_rendererID, fiberRoot) => {
        maybeHostFiber = fiberRoot.current.child.child;
      },
    });
    render(<Example />);
    const hostFibers = getNearestHostFibers(maybeHostFiber as unknown as Fiber);
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
    expect(getNearestHostFibers(maybeFiber as unknown as Fiber)).toHaveLength(2);
  });

  it("should return an empty array for a childless composite fiber", () => {
    const childlessCompositeFiber = {
      child: null,
      sibling: null,
      tag: 0,
      type: () => null,
    } as unknown as Fiber;
    expect(getNearestHostFibers(childlessCompositeFiber)).toHaveLength(0);
  });

  it("should skip childless composite fibers while traversing", () => {
    const hostFiber = { child: null, sibling: null, tag: 5, type: "div" } as unknown as Fiber;
    const childlessCompositeFiber = {
      child: null,
      sibling: hostFiber,
      tag: 0,
      type: () => null,
    } as unknown as Fiber;
    const rootCompositeFiber = {
      child: childlessCompositeFiber,
      sibling: null,
      tag: 0,
      type: () => null,
    } as unknown as Fiber;
    expect(getNearestHostFibers(rootCompositeFiber)).toEqual([hostFiber]);
  });
});
