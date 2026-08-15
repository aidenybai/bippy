"use client";

import { getFiber } from "bippy/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import { useFiberTree } from "./fiber-tree-context";
import {
  getBorderWidths,
  getElementBoxDimensions,
  getEventElement,
  getFiberName,
  getInspectableFiber,
  getOverlayTipPosition,
} from "./fiber-tree-model";
import { fiberTreeClassNames, setFiberTreeDisplayName } from "./fiber-tree-styles";
import type { ElementOverlayBox, OverlayTipPosition } from "./fiber-tree-types";

interface ElementPickerOverlayProps {
  element: Element | null;
  fiberName: string | null;
}

const ElementPickerOverlay = ({ element, fiberName }: ElementPickerOverlayProps) => {
  const [overlayBox, setOverlayBox] = useState<ElementOverlayBox | null>(null);
  const [tipPosition, setTipPosition] = useState<OverlayTipPosition>({
    left: 5,
    top: 5,
  });
  const tipElement = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!element) {
      setOverlayBox(null);
      return;
    }

    let animationFrame = 0;
    const updateOverlayBox = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        if (!element.isConnected) {
          setOverlayBox(null);
          return;
        }
        setOverlayBox({
          dimensions: getElementBoxDimensions(element),
          rect: element.getBoundingClientRect(),
        });
      });
    };
    const resizeObserver = new ResizeObserver(updateOverlayBox);

    resizeObserver.observe(element);
    window.addEventListener("resize", updateOverlayBox);
    window.addEventListener("scroll", updateOverlayBox, true);
    updateOverlayBox();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateOverlayBox);
      window.removeEventListener("scroll", updateOverlayBox, true);
    };
  }, [element]);

  useLayoutEffect(() => {
    if (!overlayBox || !tipElement.current) return;
    const tipRect = tipElement.current.getBoundingClientRect();
    setTipPosition(getOverlayTipPosition(overlayBox, tipRect.width, tipRect.height));
  }, [fiberName, overlayBox]);

  if (!element || !overlayBox) return null;

  const { dimensions, rect } = overlayBox;
  const elementName = element.tagName.toLowerCase();
  const label = fiberName ? `${elementName} (in ${fiberName})` : elementName;
  const outerWidth = rect.width + dimensions.marginLeft + dimensions.marginRight;
  const outerHeight = rect.height + dimensions.marginTop + dimensions.marginBottom;

  return createPortal(
    <div aria-hidden="true" data-fiber-element-picker-overlay>
      <div
        className="pointer-events-none fixed z-[10000000] box-content border-solid border-[rgba(255,155,0,0.3)]"
        style={{
          left: rect.left - dimensions.marginLeft,
          top: rect.top - dimensions.marginTop,
          ...getBorderWidths(
            dimensions.marginTop,
            dimensions.marginRight,
            dimensions.marginBottom,
            dimensions.marginLeft,
          ),
        }}
      >
        <div
          className="box-content border-solid border-[rgba(255,200,50,0.3)]"
          style={getBorderWidths(
            dimensions.borderTop,
            dimensions.borderRight,
            dimensions.borderBottom,
            dimensions.borderLeft,
          )}
        >
          <div
            className="box-content border-solid border-[rgba(77,200,0,0.3)]"
            style={getBorderWidths(
              dimensions.paddingTop,
              dimensions.paddingRight,
              dimensions.paddingBottom,
              dimensions.paddingLeft,
            )}
          >
            <div
              className="bg-[rgba(120,170,210,0.7)]"
              style={{
                height: Math.max(
                  0,
                  rect.height -
                    dimensions.borderTop -
                    dimensions.borderBottom -
                    dimensions.paddingTop -
                    dimensions.paddingBottom,
                ),
                width: Math.max(
                  0,
                  rect.width -
                    dimensions.borderLeft -
                    dimensions.borderRight -
                    dimensions.paddingLeft -
                    dimensions.paddingRight,
                ),
              }}
            />
          </div>
        </div>
      </div>
      <div
        ref={tipElement}
        className="pointer-events-none fixed z-[10000000] flex flex-row flex-nowrap rounded-[2px] bg-[#333740] px-[5px] py-[3px] font-[SFMono-Regular,Consolas,'Liberation_Mono',Menlo,Courier,monospace] text-xs font-bold whitespace-nowrap"
        style={tipPosition}
      >
        <span className="mr-2 border-r border-[#aaa] pr-2 text-[#ee78e6]">{label}</span>
        <span className="text-[#d7d7d7]">{`${Math.round(outerWidth)}px × ${Math.round(
          outerHeight,
        )}px`}</span>
      </div>
    </div>,
    document.body,
  );
};

export const FiberTreePicker = () => {
  const { selectFiberFromPage } = useFiberTree();
  const [isInspectingPage, setIsInspectingPage] = useState(false);
  const [pickerElement, setPickerElement] = useState<Element | null>(null);
  const [pickerFiberName, setPickerFiberName] = useState<string | null>(null);

  useEffect(() => {
    if (!isInspectingPage) {
      setPickerElement(null);
      setPickerFiberName(null);
      return;
    }

    const getIsPickerToggle = (element: Element): boolean =>
      element.closest("[data-fiber-inspector-toggle]") !== null;

    const updatePickerTarget = (event: PointerEvent) => {
      const element = getEventElement(event);
      if (!element || getIsPickerToggle(element)) {
        setPickerElement(null);
        setPickerFiberName(null);
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const hostFiber = getFiber(element);
      const inspectableFiber = hostFiber ? getInspectableFiber(hostFiber) : null;
      setPickerElement(element);
      setPickerFiberName(inspectableFiber ? getFiberName(inspectableFiber) : null);
    };

    const selectPickerTarget = (event: PointerEvent) => {
      const element = getEventElement(event);
      if (!element || getIsPickerToggle(element)) return;

      event.preventDefault();
      event.stopPropagation();
      const hostFiber = getFiber(element);
      if (!hostFiber) return;

      selectFiberFromPage(getInspectableFiber(hostFiber));
    };

    const stopPointerEvent = (event: PointerEvent) => {
      const element = getEventElement(event);
      if (element && getIsPickerToggle(element)) return;
      event.preventDefault();
      event.stopPropagation();
    };

    const stopInspecting = (event: MouseEvent) => {
      const element = getEventElement(event);
      if (element && getIsPickerToggle(element)) return;
      event.preventDefault();
      event.stopPropagation();
      setIsInspectingPage(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsInspectingPage(false);
    };

    window.addEventListener("click", stopInspecting, true);
    window.addEventListener("pointerdown", selectPickerTarget, true);
    window.addEventListener("pointermove", updatePickerTarget, true);
    window.addEventListener("pointerup", stopPointerEvent, true);
    window.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.removeEventListener("click", stopInspecting, true);
      window.removeEventListener("pointerdown", selectPickerTarget, true);
      window.removeEventListener("pointermove", updatePickerTarget, true);
      window.removeEventListener("pointerup", stopPointerEvent, true);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isInspectingPage, selectFiberFromPage]);

  return (
    <>
      <button
        className={cn(fiberTreeClassNames.button, isInspectingPage && "text-[#61dafb]")}
        type="button"
        aria-label="Select an element in the page to inspect it"
        aria-pressed={isInspectingPage}
        data-fiber-inspector-toggle
        title="Select an element in the page to inspect it"
        onClick={() => setIsInspectingPage((currentValue) => !currentValue)}
      >
        <span className={fiberTreeClassNames.buttonContent}>
          <svg
            className={fiberTreeClassNames.icon}
            width="24"
            height="24"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M0 0h24v24H0z" fill="none" />
            <path
              fill="currentColor"
              d="M8.5,22H3.7l-1.4-1.5V3.8l1.3-1.5h17.2l1,1.5v4.9h-1.3V4.3l-0.4-0.6H4.2L3.6,4.3V20l0.7,0.7h4.2V22z M23,13.9l-4.6,3.6l4.6,4.6l-1.1,1.1l-4.7-4.4l-3.3,4.4l-3.2-12.3L23,13.9z"
            />
          </svg>
        </span>
      </button>
      <ElementPickerOverlay element={pickerElement} fiberName={pickerFiberName} />
    </>
  );
};

setFiberTreeDisplayName(ElementPickerOverlay, "ElementPickerOverlay");
setFiberTreeDisplayName(FiberTreePicker, "FiberTreePicker");
