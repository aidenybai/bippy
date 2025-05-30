'use client';

import { getFiberFromHostInstance } from '../dist/index';
import { getFiberSource } from '../dist/source';

export function ClientFiber() {
  setTimeout(async () => {
    if (typeof window === 'undefined') {
      return;
    }
    const fiber = getFiberFromHostInstance(
      // biome-ignore lint/style/noNonNullAssertion: <explanation>
      document.getElementById('bippy-source')!
    );
    if (fiber) {
      // biome-ignore lint/suspicious/noConsoleLog: <explanation>
      console.log(fiber, await getFiberSource(fiber));
    }
  }, 1000);
  return <div>Fiber</div>;
}
