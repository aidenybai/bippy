'use client';

import { useEffect } from 'react';

import { getFiberFromHostInstance } from '../dist/index';
import { getFiberSource, getFiberStackTrace, getOwnerStack } from '../dist/source';

export function ClientFiber() {
  useEffect(() => {
    setTimeout(() => {
      void (async () => {
        if (typeof window === 'undefined') {
          return;
        }
        const fiber = getFiberFromHostInstance(
          document.getElementById('bippy-source')!,
        );
        if (fiber) {
          const files = (await getOwnerStack(getFiberStackTrace(fiber))).map(
            (i) => i.source?.fileName ?? null,
          );
          console.log('owner files:', files);
          const src = await getFiberSource(fiber);
          console.log('fiber source:', src);
          if (typeof window !== 'undefined') {
            // @ts-expect-error debug
            window.__bippyOwnerFiles = files;
            // @ts-expect-error debug
            window.__bippyFiberSource = src;
          }
        }
      })();
    }, 1000);
  }, []);

  return <div id="bippy-source">Fiber</div>;
}
