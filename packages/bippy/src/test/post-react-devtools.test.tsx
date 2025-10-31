// import bippy, then react devtools
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { expect, it, vi } from 'vitest';
const { instrument } = await import('../index.js');

// @ts-expect-error - react-devtools-inline types not available
import { activate, initialize } from 'react-devtools-inline/backend';
// @ts-expect-error - react-devtools-inline types not available
import { initialize as initializeFrontend } from 'react-devtools-inline/frontend';

initialize(window);

const DevTools = initializeFrontend(window);

activate(window);
const React = await import('react');
const { render } = await import('@testing-library/react');

it('should be active', () => {
  render(<div>Hello</div>);
  render(<DevTools />);

  const onActive = vi.fn();
  instrument({
    onActive,
  });
  expect(onActive).toHaveBeenCalled();
});
