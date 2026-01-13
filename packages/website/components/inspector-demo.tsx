'use client';

import { useState, useEffect } from 'react';
import {
  getFiberFromHostInstance,
  traverseFiber,
  isCompositeFiber,
  getDisplayName,
  getNearestHostFiber,
} from 'bippy';

export const InspectorDemo = () => {
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    if (!isActive) return;

    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
      position: fixed;
      background: #222;
      color: #fff;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-family: monospace;
      pointer-events: none;
      z-index: 999999;
      display: none;
    `;
    document.body.appendChild(tooltip);

    const highlight = document.createElement('div');
    highlight.style.cssText = `
      position: fixed;
      border: 2px solid #99ffe3;
      background: rgba(153, 255, 227, 0.1);
      pointer-events: none;
      z-index: 999998;
      display: none;
    `;
    document.body.appendChild(highlight);

    const handleMouseMove = (event: MouseEvent) => {
      const element = document.elementFromPoint(event.clientX, event.clientY);
      if (!element) {
        tooltip.style.display = 'none';
        highlight.style.display = 'none';
        return;
      }

      const fiber = getFiberFromHostInstance(element);

      if (!fiber) {
        tooltip.style.display = 'none';
        highlight.style.display = 'none';
        return;
      }

      const componentFiber = traverseFiber(
        fiber,
        (f) => isCompositeFiber(f),
        true,
      );

      if (componentFiber) {
        const name = getDisplayName(componentFiber.type);
        tooltip.textContent = `<${name}>`;
        tooltip.style.display = 'block';
        tooltip.style.left = event.clientX + 10 + 'px';
        tooltip.style.top = event.clientY + 10 + 'px';

        const hostFiber = getNearestHostFiber(componentFiber);
        if (hostFiber?.stateNode instanceof HTMLElement) {
          const rect = hostFiber.stateNode.getBoundingClientRect();
          highlight.style.display = 'block';
          highlight.style.left = rect.left + 'px';
          highlight.style.top = rect.top + 'px';
          highlight.style.width = rect.width + 'px';
          highlight.style.height = rect.height + 'px';
        }
      } else {
        tooltip.style.display = 'none';
        highlight.style.display = 'none';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      tooltip.remove();
      highlight.remove();
    };
  }, [isActive]);

  return (
    <button
      type="button"
      onClick={() => setIsActive(!isActive)}
      className="w-full rounded-[4px] bg-white text-[#111] px-2 py-3 text-sm font-mono cursor-pointer"
    >
      {isActive ? (
        <>
          inspector{' '}
          <span className="inline-block px-1 rounded-[2px] bg-[#99ffe3]">
            on
          </span>
          {' '}— hover around!
        </>
      ) : (
        <>
          try the{' '}
          <span className="inline-block px-1 rounded-[2px] bg-[#99ffe3]/20">
            inspector
          </span>
        </>
      )}
    </button>
  );
};
