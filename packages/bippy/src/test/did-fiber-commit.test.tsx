import '../index.js'; // KEEP THIS LINE ON TOP

import { expect, it } from 'vitest';
import React from 'react';

import { didFiberCommit, Fiber, instrument } from '../index.js';
import { render } from '@testing-library/react';

const Example = () => {
  return <div>Hello</div>;
};

export const ExampleWithUnmount = () => {
  const [shouldUnmount, setShouldUnmount] = React.useState(true);
  React.useEffect(() => {
    setShouldUnmount(false);
  }, []);
  return shouldUnmount ? <div>Hello</div> : null;
};

it('should return true for a fiber that has committed', () => {
  let maybeRenderedFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeRenderedFiber = fiberRoot.current.child;
    },
  });
  render(<ExampleWithUnmount />);
  expect(maybeRenderedFiber).not.toBeNull();
  expect(didFiberCommit(maybeRenderedFiber as unknown as Fiber)).toBe(true);
});

it("should return false for a fiber that hasn't committed", () => {
  let maybeRenderedFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeRenderedFiber = fiberRoot.current.child;
    },
  });
  render(<Example />);
  expect(maybeRenderedFiber).not.toBeNull();
  expect(didFiberCommit(maybeRenderedFiber as unknown as Fiber)).toBe(false);
});
