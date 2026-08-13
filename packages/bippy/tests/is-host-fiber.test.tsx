import "../src/index.js"; // HACK: Bippy must initialize before imports that load React.

import { render } from "@testing-library/react";
import React from "react";
import { expect, it } from "vite-plus/test";
import { getFiberFromHostInstance, instrument, isHostFiber, traverseFiber } from "../src/index.js";
import type { Fiber } from "../src/react-internals/index.js";
import { latestReactWorkTags } from "./react-work-tags.js";

export const Example = () => {
  return <div>Hello</div>;
};

const TextExample = () => "Hello";

it("should return true for a host fiber", () => {
  const { container } = render(<div>Hello</div>);
  const hostFiber = getFiberFromHostInstance(container.firstChild);
  if (!hostFiber) throw new Error("React DOM did not render a host fiber");
  expect(isHostFiber(hostFiber)).toBe(true);
});

it("should return true for a host text fiber", () => {
  const hostTextFiberRef: { current: Fiber | null } = { current: null };
  const unsubscribe = instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      hostTextFiberRef.current = traverseFiber(
        fiberRoot.current,
        (fiber) => fiber.tag === latestReactWorkTags.HostText,
      );
    },
  });
  render(
    <div>
      <TextExample />
    </div>,
  );
  const hostTextFiber = hostTextFiberRef.current;
  if (!hostTextFiber) throw new Error("React DOM did not render a host text fiber");
  expect(hostTextFiber.tag).toBe(latestReactWorkTags.HostText);
  expect(isHostFiber(hostTextFiber)).toBe(true);
  unsubscribe();
});

it("should return false for a composite fiber", () => {
  let maybeCompositeFiber: Fiber | null = null;
  const unsubscribe = instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeCompositeFiber = fiberRoot.current.child;
    },
  });

  render(<Example />);

  if (!maybeCompositeFiber) throw new Error("React DOM did not render a composite fiber");
  expect(isHostFiber(maybeCompositeFiber)).toBe(false);
  unsubscribe();
});
