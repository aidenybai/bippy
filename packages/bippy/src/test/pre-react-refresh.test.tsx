// import react refresh, then bippy
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-require-imports */

import { expect, it, vi } from 'vitest';

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
const { instrument } = await import('../index.js');

it('should be active', () => {
  const onActive = vi.fn();
  instrument({
    onActive,
  });
  expect(onActive).toHaveBeenCalled();
});
