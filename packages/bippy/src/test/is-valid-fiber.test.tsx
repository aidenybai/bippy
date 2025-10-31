import '../index.js'; // KEEP THIS LINE ON TOP

import React from 'react';
import { expect, it } from 'vitest';
import { instrument, isValidFiber } from '../index.js';
import type { Fiber } from '../types.js';
import { render } from '@testing-library/react';

export const Example = () => {
  return null;
};

it('should return true for a valid fiber', () => {
  let maybeFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeFiber = fiberRoot.current.child;
    },
  });
  render(<Example />);
  expect(isValidFiber(maybeFiber as unknown as Fiber)).toBe(true);
});

it('should return false for a non-fiber', () => {
  expect(isValidFiber({})).toBe(false);
});
