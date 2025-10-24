'use client';

import { getFiberFromHostInstance } from '../dist/index';
import { getFiberSource, getOwnerStack, getFiberStackTrace } from '../dist/source';
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
        const files = (await getOwnerStack(getFiberStackTrace(fiber))).map(
          (i) => i.source?.fileName ?? null
        );
        // biome-ignore lint/suspicious/noConsoleLog: <explanation>
        console.log('owner files:', files);
        const src = await getFiberSource(fiber);
        // biome-ignore lint/suspicious/noConsoleLog: <explanation>
        console.log('fiber source:', src);
        if (typeof window !== 'undefined') {
          // @ts-expect-error debug
          window.__bippyOwnerFiles = files;
          // @ts-expect-error debug
          window.__bippyFiberSource = src;
        }
      }
    }, 1000);
  }, []);

  return <div id="bippy-source">Fiber</div>;
}
