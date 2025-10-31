import '../index.js'; // KEEP THIS LINE ON TOP

import { render } from '@testing-library/react';
import React from 'react';
import { expect, it } from 'vitest';
import { getMutatedHostFibers, instrument } from '../index.js';
import type { Fiber } from '../types.js';

export const ExampleWithMutation = () => {
  const [element, setElement] = React.useState(<div>Hello</div>);
  React.useEffect(() => {
    setElement(<div>Bye</div>);
  }, []);
  return element;
};

it('should return all host fibers that have committed and rendered', () => {
  let maybeFiber: Fiber | null = null;
  let mutatedHostFiber: Fiber<HTMLDivElement> | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeFiber = fiberRoot.current.child;
      mutatedHostFiber = fiberRoot.current.child.child;
    },
  });
  render(<ExampleWithMutation />);
  const mutatedHostFibers = getMutatedHostFibers(
    maybeFiber as unknown as Fiber,
  );
  expect(getMutatedHostFibers(maybeFiber as unknown as Fiber)).toHaveLength(1);
  expect(mutatedHostFiber).toBe(mutatedHostFibers[0]);
});
