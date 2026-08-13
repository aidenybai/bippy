import "../src/index.js"; // HACK: Bippy must initialize before imports that load React.

import { render } from "@testing-library/react";
import React from "react";
import { expect, it } from "vite-plus/test";
import { getFiberStack, instrument, type Fiber } from "../src/index.js";

interface ExampleWithChildrenPropProps {
  children: React.ReactNode;
}

export const Example = () => {
  return <div>Hello</div>;
};

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

it("should return the fiber stack", () => {
  let maybeFiber: Fiber | null = null;
  let manualFiberStack: Fiber[] = [];
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      const parentFiber = fiberRoot.current.child;
      const childFiber = parentFiber?.child;
      if (!parentFiber || !childFiber) {
        throw new Error("React DOM did not render the expected fiber stack");
      }
      manualFiberStack = [];
      maybeFiber = childFiber;
      manualFiberStack.push(childFiber);
      manualFiberStack.push(parentFiber);
    },
  });
  render(
    <ExampleWithChildrenProp>
      <ExampleWithUnmount />
    </ExampleWithChildrenProp>,
  );
  if (!maybeFiber) throw new Error("React DOM did not commit the expected child fiber");
  const fiberStack = getFiberStack(maybeFiber);
  expect(fiberStack).toEqual(manualFiberStack);
});
