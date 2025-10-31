import '../index.js'; // KEEP THIS LINE ON TOP

import { render, screen } from '@testing-library/react';
import React from 'react';
import { expect, it } from 'vitest';
import { getFiberFromHostInstance } from '../index.js';

it('should return the fiber from the host instance', () => {
  render(<div>HostInstance</div>);
  const fiber = getFiberFromHostInstance(screen.getByText('HostInstance'));
  expect(fiber).not.toBeNull();
  expect(fiber?.type).toBe('div');
});
