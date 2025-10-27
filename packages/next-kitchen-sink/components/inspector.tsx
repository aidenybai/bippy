'use client';

import 'bippy';
import { getFiberFromHostInstance, getLatestFiber } from 'bippy';
import { getOwnerStack, getFiberStackTrace } from 'bippy/dist/source';
import { useEffect, useRef, useState } from 'react';

import { cn } from './cn';

export function Inspector() {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const isEnabledRef = useRef(isEnabled);
  isEnabledRef.current = isEnabled;

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const isEnabled = isEnabledRef.current;
      if (!isEnabled) return;
      const element = document.elementFromPoint(event.clientX, event.clientY);
      if (!element) return;
      setRect(element.getBoundingClientRect());
    };
    const handleClick = (event: MouseEvent) => {
      const isEnabled = isEnabledRef.current;
      if (!isEnabled) return;
      const element = document.elementFromPoint(event.clientX, event.clientY);
      if (!element) return;
      const fiber = getFiberFromHostInstance(element);
      if (fiber) {
        const latestFiber = getLatestFiber(fiber);
        console.log('Fiber:', latestFiber);

        void (async () => {
          try {
            // Fetch function for source maps
            const fetchFile = async (url: string): Promise<string> => {
              const response = await fetch(url);
              return await response.text();
            };

            const rawStackTrace = getFiberStackTrace(latestFiber);
            console.log('Raw Stack Trace:', rawStackTrace);

            const stack = await getOwnerStack(rawStackTrace);
            console.log('Symbolicated Stack:', JSON.stringify(stack, null, 2));
          } catch (error) {
            console.error('Error symbolicating stack:', error);
          }
        })();
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('click', handleClick);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('click', handleClick);
    };
  }, []);

  return (
    <div>
      <button
        className={cn(
          'transition-colors text-black px-2 py-1 rounded-md',
          isEnabled
            ? 'bg-red-600 text-white hover:bg-red-700'
            : 'bg-white hover:bg-neutral-200',
        )}
        onClick={() => setIsEnabled(!isEnabled)}
      >
        {isEnabled ? 'Disable' : 'Enable'}
      </button>
      {isEnabled && rect && (
        <div
          className="border border-dashed border-red-600 pointer-events-none"
          style={{
            height: rect?.height,
            left: rect?.left,
            position: 'fixed',
            top: rect?.top,
            width: rect?.width,
          }}
        ></div>
      )}
    </div>
  );
}
