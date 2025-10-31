// import bippy, then react

import { instrument } from '../index.js';
import { expect, it, vi } from 'vitest';

import React from 'react';
import { render } from '@testing-library/react';

it('should be active', () => {
  const onActive = vi.fn();
  render(<div>Hello</div>);
  instrument({
    onActive,
  });
  expect(onActive).toHaveBeenCalled();
});
