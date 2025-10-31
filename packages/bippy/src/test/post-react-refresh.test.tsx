// import bippy, then react refresh
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-require-imports */

import { expect, it, vi } from 'vitest';

import { instrument } from '../index.js';

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

it('should be active', () => {
  const onActive = vi.fn();
  instrument({
    onActive,
  });
  expect(onActive).toHaveBeenCalled();
});
