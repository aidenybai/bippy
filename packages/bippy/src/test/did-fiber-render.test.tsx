import '../index.js'; // KEEP THIS LINE ON TOP

import { expect, it } from 'vitest';
import React from 'react';

import { didFiberRender, Fiber, instrument } from '../index.js';
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

it('should return true for a fiber that has rendered', () => {
  let maybeRenderedFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeRenderedFiber = fiberRoot.current.child;
    },
  });
  render(<Example />);
  expect(maybeRenderedFiber).not.toBeNull();
  expect(didFiberRender(maybeRenderedFiber as unknown as Fiber)).toBe(true);
});

it("should return false for a fiber that hasn't rendered", () => {
  let maybeRenderedFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeRenderedFiber = fiberRoot.current.child;
    },
  });
  render(
    <div>
      <ExampleWithUnmount />
    </div>,
  );
  expect(maybeRenderedFiber).not.toBeNull();
  expect(didFiberRender(maybeRenderedFiber as unknown as Fiber)).toBe(false);
});
