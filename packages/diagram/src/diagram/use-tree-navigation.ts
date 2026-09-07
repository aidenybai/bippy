"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type FocusEvent,
  type RefObject,
} from "react";
import { useLocale } from "@react-aria/i18n";
import type { TreeRow } from "./tree-model";
import type { DiagramInteraction } from "./interaction";
import { getTreeKeyAction } from "./accessibility";
import { useTypeahead } from "./use-typeahead";

interface TreeNavigationOptions {
  rows: readonly TreeRow[];
  containerRef: RefObject<SVGSVGElement | null>;
  collapsedIds: ReadonlySet<string>;
  toggle: (nodeId: string) => void;
  interaction: DiagramInteraction;
}

export const useTreeNavigation = ({
  rows,
  containerRef,
  collapsedIds,
  toggle,
  interaction,
}: TreeNavigationOptions) => {
  const [focusedId, setFocusedState] = useState<string | null>(rows[0]?.node.id ?? null);
  const focusedRef = useRef(focusedId);
  const previousRows = useRef(rows);
  const [hasItems, setHasItems] = useState(rows.length > 0);
  const hasFocus = useRef(false);
  const lastElement = useRef<Element | null>(null);
  const { direction } = useLocale();
  const findMatch = useTypeahead();
  const setFocusedId = useCallback((nodeId: string | null) => {
    focusedRef.current = nodeId;
    setFocusedState(nodeId);
  }, []);
  const getRenderedElements = useCallback(
    () =>
      [...(containerRef.current?.querySelectorAll<SVGGElement>("[data-tree-item]") ?? [])].filter(
        (element) =>
          element.closest("[data-tree-view]") === containerRef.current &&
          !element.closest('[hidden], [aria-hidden="true"]') &&
          element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility === "visible",
      ),
    [containerRef],
  );
  const getElements = useCallback(
    () =>
      getRenderedElements().filter(
        (element) =>
          element.hasAttribute("tabindex") && element.getAttribute("aria-disabled") !== "true",
      ),
    [getRenderedElements],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const repairFocus = () => {
      const elements = getElements();
      const focusedElement = elements.find(
        (element) => element === container.ownerDocument.activeElement,
      );
      if (focusedElement || container.ownerDocument.activeElement === container) {
        hasFocus.current = true;
        lastElement.current = focusedElement ?? container;
        if (focusedElement?.dataset.nodeId && focusedElement.dataset.nodeId !== focusedRef.current)
          setFocusedId(focusedElement.dataset.nodeId);
      }
      setHasItems(getRenderedElements().length > 0);
      const getParentId = (nodeId: string | null) =>
        (
          rows.find((row) => row.node.id === nodeId) ??
          previousRows.current.find((row) => row.node.id === nodeId)
        )?.node.parentId;
      const current = elements.find((element) => element.dataset.nodeId === focusedRef.current);
      let ancestorId = getParentId(focusedRef.current);
      let ancestor: SVGGElement | undefined;
      while (ancestorId !== undefined && ancestorId !== null && !ancestor) {
        ancestor = elements.find((element) => element.dataset.nodeId === ancestorId);
        ancestorId = getParentId(ancestorId);
      }
      const next = current ?? ancestor ?? elements[0];
      if (focusedRef.current !== (next?.dataset.nodeId ?? null))
        setFocusedId(next?.dataset.nodeId ?? null);
      if (
        hasFocus.current &&
        lastElement.current &&
        (lastElement.current === container
          ? next && container.ownerDocument.activeElement === container
          : !elements.some((element) => element === lastElement.current))
      )
        (next ?? container).focus({ preventScroll: true });
    };
    repairFocus();
    previousRows.current = rows;
    const observer = new MutationObserver(repairFocus);
    observer.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-disabled", "aria-hidden", "hidden", "style", "class", "tabindex"],
    });
    return () => observer.disconnect();
  }, [rows, containerRef, getElements, getRenderedElements, setFocusedId]);

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (
      event.defaultPrevented ||
      !(event.target instanceof Element) ||
      event.target.closest("[data-tree-view]") !== event.currentTarget ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing
    )
      return;
    const elements = getElements();
    const focusedElement = elements.find(
      (element) => element === containerRef.current?.ownerDocument.activeElement,
    );
    const currentId = focusedElement?.dataset.nodeId ?? focusedRef.current;
    if (focusedElement) {
      hasFocus.current = true;
      lastElement.current = focusedElement;
      if (currentId !== focusedRef.current) setFocusedId(currentId);
    }
    const elementById = new Map(elements.map((element) => [element.dataset.nodeId, element]));
    const availableRows = rows
      .filter((row) => elementById.has(row.node.id))
      .map((row) => ({
        ...row,
        node: {
          ...row.node,
          label:
            elementById.get(row.node.id)?.dataset.textValue ??
            elementById.get(row.node.id)?.querySelector("text")?.getAttribute("data-text-value") ??
            elementById.get(row.node.id)?.querySelector("text")?.textContent ??
            row.node.label,
        },
      }));
    const action = getTreeKeyAction(availableRows, currentId, event.key, collapsedIds, direction);
    if (action?.activate) return;
    const nextId =
      action?.focusId ??
      (!action && [...event.key].length === 1
        ? findMatch(availableRows, currentId, event.key)
        : undefined);
    if (!action && !nextId) return;
    event.preventDefault();
    if (action?.clear) {
      interaction.setHoveredId(null);
      interaction.setFocusedId(null);
      return;
    }
    if (action?.toggleId) toggle(action.toggleId);
    if (nextId !== undefined) {
      const element = elementById.get(nextId);
      if (element) {
        setFocusedId(nextId);
        element.focus({ preventScroll: true });
        element.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }
  };
  const onFocusCapture = (event: FocusEvent<SVGSVGElement>) => {
    if (event.target.closest("[data-tree-view]") !== event.currentTarget) return;
    hasFocus.current = true;
    lastElement.current = event.target;
  };
  const onBlurCapture = (event: FocusEvent<SVGSVGElement>) => {
    if (event.target.closest("[data-tree-view]") !== event.currentTarget) return;
    if (event.relatedTarget?.closest?.("[data-tree-view]") === event.currentTarget) return;
    if (
      event.relatedTarget ||
      event.target === event.currentTarget ||
      getElements().some((element) => element === event.target)
    )
      hasFocus.current = false;
  };
  return { focusedId, setFocusedId, hasItems, onKeyDown, onFocusCapture, onBlurCapture };
};
