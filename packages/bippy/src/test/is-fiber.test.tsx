import '../index.js'; // KEEP THIS LINE ON TOP

import { render } from '@testing-library/react';
import React from 'react';
import { expect, it } from 'vitest';
import { isHostFiber, getFiberFromHostInstance, isFiber } from '../index.js';
import type { Fiber } from '../types.js';

export const Example = () => {
  return <div>Hello</div>;
};

it('should return true for a a fiber', () => {
  const { container } = render(<div>Hello</div>);
  const hostFiber = getFiberFromHostInstance(container.firstChild);
  expect(isFiber(hostFiber as unknown as Fiber)).toBe(true);
});

it('should return true for a composite fiber', () => {
  const { container } = render(<Example />);

  const hostFiber = getFiberFromHostInstance(container.firstChild);
  expect(isHostFiber(hostFiber as unknown as Fiber)).toBe(true);
});
