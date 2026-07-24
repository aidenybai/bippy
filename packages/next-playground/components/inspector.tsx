"use client";

import "bippy";
import { getFiberFromHostInstance, getLatestFiber } from "bippy";
import { getSource } from "bippy/source";
import { useEffect, useRef, useState } from "react";

import { cn } from "./cn";

export const Inspector = () => {
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const [isEnabled, setIsEnabled] = useState(false);
  const isEnabledRef = useRef(isEnabled);
  isEnabledRef.current = isEnabled;

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const isEnabled = isEnabledRef.current;
      if (!isEnabled) return;
      const element = document.elementFromPoint(event.clientX, event.clientY);
      if (!element) return;
      setHighlightRect(element.getBoundingClientRect());
    };
    const handleClick = (event: MouseEvent) => {
      const isEnabled = isEnabledRef.current;
      if (!isEnabled) return;
      const element = document.elementFromPoint(event.clientX, event.clientY);
      if (!element) return;
      const fiber = getFiberFromHostInstance(element);
      if (fiber) {
        const latestFiber = getLatestFiber(fiber);
        console.log("Fiber:", latestFiber);

        void (async () => {
          try {
            console.log(await getSource(latestFiber));
          } catch (error) {
            console.error("Error symbolicating stack:", error);
          }
        })();
      }
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("click", handleClick);
    };
  }, []);

  return (
    <div>
      <button
        className={cn(
          "transition-colors text-black px-2 py-1 rounded-md",
          isEnabled ? "bg-red-600 text-white hover:bg-red-700" : "bg-white hover:bg-neutral-200",
        )}
        onClick={() => setIsEnabled(!isEnabled)}
      >
        {isEnabled ? "Disable" : "Enable"}
      </button>
      {isEnabled && highlightRect && (
        <div
          className="border border-dashed border-red-600 pointer-events-none"
          style={{
            height: highlightRect.height,
            left: highlightRect.left,
            position: "fixed",
            top: highlightRect.top,
            width: highlightRect.width,
          }}
        ></div>
      )}
    </div>
  );
};
