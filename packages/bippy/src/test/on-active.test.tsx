import { expect, it, vi } from 'vitest';

import { instrument } from '../index.js';
import React from 'react';
import { render } from '@testing-library/react';

const Example = () => {
  return <div>Hello</div>;
};

it('handle multiple onActive calls', () => {
  const onActive = vi.fn();
  const onActive2 = vi.fn();
  const onActive3 = vi.fn();
  instrument({ onActive });
  instrument({ onActive: onActive2 });
  render(<Example />);
  instrument({ onActive: onActive3 });
  expect(onActive).toHaveBeenCalledOnce();
  expect(onActive2).toHaveBeenCalledOnce();
  expect(onActive3).toHaveBeenCalledOnce();
});
