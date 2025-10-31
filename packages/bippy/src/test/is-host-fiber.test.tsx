import '../index.js'; // KEEP THIS LINE ON TOP

import { render } from '@testing-library/react';
import React from 'react';
import { expect, it } from 'vitest';
import { isHostFiber, getFiberFromHostInstance, instrument } from '../index.js';
import type { Fiber } from '../types.js';

export const Example = () => {
  return <div>Hello</div>;
};

it('should return true for a host fiber', () => {
  const { container } = render(<div>Hello</div>);
  const hostFiber = getFiberFromHostInstance(container.firstChild);
  expect(isHostFiber(hostFiber as unknown as Fiber)).toBe(true);
});

it('should return false for a composite fiber', () => {
  let maybeCompositeFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeCompositeFiber = fiberRoot.current.child;
    },
  });
  console.log(__REACT_DEVTOOLS_GLOBAL_HOOK__)

  render(<Example />);

  expect(maybeCompositeFiber).not.toBeNull();
  expect(isHostFiber(maybeCompositeFiber as unknown as Fiber)).toBe(false);
});
