// import react devtools, then bippy
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

// @ts-expect-error - react-devtools-inline types not available
import { activate, initialize } from 'react-devtools-inline/backend';
// @ts-expect-error - react-devtools-inline types not available
import { initialize as initializeFrontend } from 'react-devtools-inline/frontend';
import { expect, it, vi } from 'vitest';

initialize(window);

const React = await import('react');

const DevTools = initializeFrontend(window);

activate(window);

const { render } = await import('@testing-library/react');
const { instrument } = await import('../index.js');

it('should be active', () => {
  render(<div>Hello</div>);
  render(<DevTools />);
  const onActive = vi.fn();
  instrument({
    onActive,
  });
  expect(onActive).toHaveBeenCalled();
});
