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

it("stale onCommitFiberUnmount handlers are skipped after re-instrumenting", () => {
  const staleOnCommitFiberUnmount = vi.fn();
  const activeOnCommitFiberUnmount = vi.fn();
  instrument({ onCommitFiberUnmount: staleOnCommitFiberUnmount });
  instrument({ onCommitFiberUnmount: activeOnCommitFiberUnmount });
  const { unmount } = render(<Example />);
  unmount();
  expect(activeOnCommitFiberUnmount).toHaveBeenCalled();
  expect(staleOnCommitFiberUnmount).not.toHaveBeenCalled();
});

it("stale onPostCommitFiberRoot handlers are skipped after re-instrumenting", () => {
  const staleOnPostCommitFiberRoot = vi.fn();
  const activeOnPostCommitFiberRoot = vi.fn();
  instrument({ onPostCommitFiberRoot: staleOnPostCommitFiberRoot });
  instrument({ onPostCommitFiberRoot: activeOnPostCommitFiberRoot });
  render(<ExampleWithEffect />);
  expect(activeOnPostCommitFiberRoot).toHaveBeenCalled();
  expect(staleOnPostCommitFiberRoot).not.toHaveBeenCalled();
});
