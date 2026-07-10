import "../src/index.js"; // KEEP THIS LINE ON TOP

import { render } from "@testing-library/react";
import React from "react";
import { expect, it, vi } from "vitest";
import { instrument } from "../src/index.js";

const Example = () => {
  return <div>Hello</div>;
};

const ExampleWithEffect = () => {
  React.useEffect(() => {}, []);
  return <div>Hello</div>;
};

it("onCommitFiberUnmount is called when a component unmounts", () => {
  const onCommitFiberUnmount = vi.fn();
  instrument({ onCommitFiberUnmount });
  const { unmount } = render(<Example />);
  expect(onCommitFiberUnmount).not.toHaveBeenCalled();
  unmount();
  expect(onCommitFiberUnmount).toHaveBeenCalled();
});

it("multiple onCommitFiberUnmount handlers compose", () => {
  const firstOnCommitFiberUnmount = vi.fn();
  const secondOnCommitFiberUnmount = vi.fn();
  const unsubscribeFirst = instrument({ onCommitFiberUnmount: firstOnCommitFiberUnmount });
  const unsubscribeSecond = instrument({ onCommitFiberUnmount: secondOnCommitFiberUnmount });
  const { unmount } = render(<Example />);
  unmount();
  expect(firstOnCommitFiberUnmount).toHaveBeenCalled();
  expect(secondOnCommitFiberUnmount).toHaveBeenCalled();
  unsubscribeFirst();
  unsubscribeSecond();
});

it("unsubscribed onCommitFiberUnmount handlers stop firing", () => {
  const unsubscribedOnCommitFiberUnmount = vi.fn();
  const activeOnCommitFiberUnmount = vi.fn();
  const unsubscribe = instrument({ onCommitFiberUnmount: unsubscribedOnCommitFiberUnmount });
  const unsubscribeActive = instrument({ onCommitFiberUnmount: activeOnCommitFiberUnmount });
  unsubscribe();
  const { unmount } = render(<Example />);
  unmount();
  expect(activeOnCommitFiberUnmount).toHaveBeenCalled();
  expect(unsubscribedOnCommitFiberUnmount).not.toHaveBeenCalled();
  unsubscribeActive();
});

it("unsubscribed onPostCommitFiberRoot handlers stop firing", () => {
  const unsubscribedOnPostCommitFiberRoot = vi.fn();
  const activeOnPostCommitFiberRoot = vi.fn();
  const unsubscribe = instrument({ onPostCommitFiberRoot: unsubscribedOnPostCommitFiberRoot });
  const unsubscribeActive = instrument({ onPostCommitFiberRoot: activeOnPostCommitFiberRoot });
  unsubscribe();
  render(<ExampleWithEffect />);
  expect(activeOnPostCommitFiberRoot).toHaveBeenCalled();
  expect(unsubscribedOnPostCommitFiberRoot).not.toHaveBeenCalled();
  unsubscribeActive();
});
