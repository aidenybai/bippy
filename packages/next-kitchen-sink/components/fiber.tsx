'use client';

import { getFiberFromHostInstance } from '../dist/index';
import {
  // getFiberSource,
  getOwnerStack,
  getFiberStackTrace,
} from '../dist/source';
import { useEffect } from 'react';

export function ClientFiber() {
  useEffect(() => {
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
        console.log(await getOwnerStack(getFiberStackTrace(fiber)));
      }
    }, 1000);
  }, []);

  return <div id="bippy-source">Fiber</div>;
}
