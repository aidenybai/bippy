import { instrument } from '../../index.js';
import { it, vi, expect } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { BasicComponent } from '../components.js';

it('handle multiple onActive calls', () => {
  const onActive = vi.fn();
  const onActive2 = vi.fn();
  const onActive3 = vi.fn();
  instrument({ onActive });
  instrument({ onActive: onActive2 });
  render(<BasicComponent />);
  instrument({ onActive: onActive3 });
  expect(onActive).toHaveBeenCalledOnce();
  expect(onActive2).toHaveBeenCalledOnce();
  expect(onActive3).toHaveBeenCalledOnce();
});
