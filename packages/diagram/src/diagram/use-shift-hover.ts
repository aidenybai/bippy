"use client";

import { useEffect, useState, type PointerEvent } from "react";

export const useShiftHover = () => {
  const [isHovered, setIsHovered] = useState(false);
  const [isShiftPressed, setIsShiftPressed] = useState(false);
  useEffect(() => {
    if (!isHovered) return;
    const update = (event: KeyboardEvent) => {
      if (!event.defaultPrevented) setIsShiftPressed(event.shiftKey);
    };
    const reset = () => setIsShiftPressed(false);
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
      window.removeEventListener("blur", reset);
    };
  }, [isHovered]);
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const isOwnCanvas =
      event.pointerType !== "touch" &&
      event.target instanceof Element &&
      event.target.closest("[data-diagram-canvas]") === event.currentTarget;
    setIsHovered(isOwnCanvas);
    setIsShiftPressed(isOwnCanvas && event.shiftKey);
  };
  const onPointerLeave = () => {
    setIsHovered(false);
    setIsShiftPressed(false);
  };
  return { isShowingAllDataflow: isHovered && isShiftPressed, onPointerMove, onPointerLeave };
};
