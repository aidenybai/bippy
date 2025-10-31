import '../index.js'; // KEEP THIS LINE ON TOP

import { render } from '@testing-library/react';
import React from 'react';
import { expect, it } from 'vitest';
import { Fiber, getFiberStack, instrument } from '../index.js';

export const Example = () => {
  return <div>Hello</div>;
};

export const ExampleWithChildrenProp = ({
  children,
}: {
  children: React.ReactNode;
}) => {
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

it('should return the fiber stack', () => {
  let maybeFiber: Fiber | null = null;
  let manualFiberStack: Fiber[] = [];
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      manualFiberStack = [];
      maybeFiber = fiberRoot.current.child.child;
      manualFiberStack.push(fiberRoot.current.child.child);
      manualFiberStack.push(fiberRoot.current.child);
    },
  });
  render(
    <ExampleWithChildrenProp>
      <ExampleWithUnmount />
    </ExampleWithChildrenProp>,
  );
  const fiberStack = getFiberStack(maybeFiber as unknown as Fiber);
  expect(fiberStack).toEqual(manualFiberStack);
});
