import '../index.js'; // KEEP THIS LINE ON TOP

/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-require-imports */

import { fireEvent, render, waitFor } from '@testing-library/react';
import React from 'react';
import { expect, it, vi } from 'vitest';

import { hmrSwapComponent, instrument } from '../index.js';

declare global {
  interface Window {
    $RefreshReg$?: () => void;
    $RefreshSig$?: () => <T>(type: T) => T;
  }
}

const runtime = require('react-refresh/runtime');
runtime.injectIntoGlobalHook(window);
window.$RefreshReg$ = () => {};
window.$RefreshSig$ = () => (type) => type;

it('can swap components with different refs via refresh', async () => {
  instrument({ onCommitFiberRoot: vi.fn() });

  const OldCounter = () => {
    const [count, setCount] = React.useState(0);
    return (
      <button type="button" onClick={() => setCount(count + 1)}>
        count:{count}
      </button>
    );
  };

  const NewCounter = () => {
    const [count, setCount] = React.useState(0);
    return (
      <button type="button" onClick={() => setCount(count + 1)}>
        count:{count + 1}
      </button>
    );
  };

  const result = render(<OldCounter />);
  const button = result.getByRole('button');

  fireEvent.click(button);
  expect(button.textContent).toBe('count:1');

  const didSwap = hmrSwapComponent(OldCounter, NewCounter);
  expect(didSwap).toBe(true);

  await waitFor(() => {
    expect(button.textContent).toBe('count:2');
  });
});

