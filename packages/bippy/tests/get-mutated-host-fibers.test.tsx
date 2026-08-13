import "../src/index.js"; // HACK: Bippy must initialize before imports that load React.

import { render } from "@testing-library/react";
import React from "react";
import { expect, it } from "vite-plus/test";
import { getMutatedHostFibers, instrument } from "../src/index.js";
import type { Fiber } from "../src/react-internals/index.js";
import { requireFiber } from "./require-fiber.js";

export const ExampleWithMutation = () => {
  const [element, setElement] = React.useState(<div>Hello</div>);
  React.useEffect(() => {
    setElement(<div>Bye</div>);
  }, []);
  return element;
};

export const ExampleWithSiblingMutation = () => {
  const [text, setText] = React.useState("first");
  React.useEffect(() => {
    setText("second");
  }, []);
  return (
    <>
      <div>{text}</div>
      <div>{text}</div>
    </>
  );
};

it("should return all host fibers that have committed and rendered", () => {
  let maybeFiber: Fiber | null = null;
  let mutatedHostFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      const componentFiber = fiberRoot.current.child;
      if (!componentFiber) throw new Error("React DOM did not render the component fiber");
      maybeFiber = componentFiber;
      mutatedHostFiber = componentFiber.child;
    },
  });
  render(<ExampleWithMutation />);
  const mutatedHostFibers = getMutatedHostFibers(
    requireFiber(maybeFiber, "React DOM did not render a Fiber"),
  );
  expect(
    getMutatedHostFibers(requireFiber(maybeFiber, "React DOM did not render a Fiber")),
  ).toHaveLength(1);
  expect(mutatedHostFiber).toBe(mutatedHostFibers[0]);
});

it("should traverse sibling host fibers", () => {
  let maybeFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeFiber = fiberRoot.current.child;
    },
  });
  render(<ExampleWithSiblingMutation />);
  expect(
    getMutatedHostFibers(requireFiber(maybeFiber, "React DOM did not render a Fiber")),
  ).toHaveLength(2);
});
