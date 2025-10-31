import '../index.js'; // KEEP THIS LINE ON TOP

import { render } from '@testing-library/react';
import React from 'react';
import { expect, it } from 'vitest';
import { getTimings, instrument } from '../index.js';
import type { Fiber } from '../types.js';

const SlowComponent = () => {
  for (let i = 0; i < 100; i++) {} // simulate slowdown
  return <div>Hello</div>;
};

it('should return the timings of the fiber', () => {
  let maybeFiber: Fiber | null = null;
  instrument({
    onCommitFiberRoot: (_rendererID, fiberRoot) => {
      maybeFiber = fiberRoot.current.child;
    },
  });
  render(<SlowComponent />);
  const timings = getTimings(maybeFiber as unknown as Fiber);
  expect(timings.selfTime).toBeGreaterThan(0);
  expect(timings.totalTime).toBeGreaterThan(0);
});
