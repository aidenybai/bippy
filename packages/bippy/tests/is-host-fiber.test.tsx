import "../src/index.js"; // KEEP THIS LINE ON TOP

import { render } from "@testing-library/react";
import React from "react";
import { expect, it } from "vite-plus/test";
import { getFiberFromHostInstance, instrument, isHostFiber, traverseFiber } from "../src/index.js";
import type { Fiber } from "../src/types.js";
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
  let hostTextFiber: Fiber | null = null;
  using _unsubscribe = instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      hostTextFiber = traverseFiber(
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
  if (!hostTextFiber) throw new Error("React DOM did not render a host text fiber");
  expect(hostTextFiber.tag).toBe(latestReactWorkTags.HostText);
  expect(isHostFiber(hostTextFiber)).toBe(true);
});

it("should return false for a composite fiber", () => {
  let maybeCompositeFiber: Fiber | null = null;
  using _unsubscribe = instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeCompositeFiber = fiberRoot.current.child;
    },
  });

  render(<Example />);

  if (!maybeCompositeFiber) throw new Error("React DOM did not render a composite fiber");
  expect(isHostFiber(maybeCompositeFiber)).toBe(false);
});
