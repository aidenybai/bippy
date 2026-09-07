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
import { isFocusVisible as getIsFocusVisible } from "@react-aria/interactions";
import type { TreeRow } from "./tree-model";
import type { DiagramInteraction } from "./interaction";
import { getTreeKeyAction } from "./accessibility";
import { useTypeahead } from "./use-typeahead";

interface TreeNavigationOptions {
  rows: readonly TreeRow[];
  windowRows: readonly TreeRow[];
  containerRef: RefObject<SVGSVGElement | null>;
  collapsedIds: ReadonlySet<string>;
  toggle: (nodeId: string) => void;
  interaction: DiagramInteraction;
}

interface TreeFocusRequest {
  nodeId: string;
  shouldFocus: boolean;
  shouldActivate: boolean;
}

export const useTreeNavigation = ({
  rows,
  windowRows,
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
  const isInitialized = useRef(false);
  const lastElement = useRef<Element | null>(null);
  const pendingFocus = useRef<TreeFocusRequest | null>(null);
  const [focusRevision, setFocusRevision] = useState(0);
  const unavailableIds = useRef(new Set<string>());
  const textValues = useRef(new Map<string, string>());
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
  const reveal = useCallback(
    (nodeId: string, shouldFocus = true, shouldActivate = true) => {
      pendingFocus.current = { nodeId, shouldFocus, shouldActivate };
      setFocusedId(nodeId);
      setFocusRevision((revision) => revision + 1);
    },
    [setFocusedId],
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const repairFocus = () => {
      const elements = getElements();
      const elementById = new Map(elements.map((element) => [element.dataset.nodeId, element]));
      if (!isInitialized.current) {
        isInitialized.current = true;
        const focusedElement = elements.find(
          (element) => element === container.ownerDocument.activeElement,
        );
        if (focusedElement?.dataset.nodeId)
          interaction.setFocusedId(focusedElement.dataset.nodeId, getIsFocusVisible(), false);
      }
      const mountedIds = new Set(windowRows.map((row) => row.node.id));
      if (focusedId !== null) mountedIds.add(focusedId);
      for (const nodeId of mountedIds) {
        const element = elementById.get(nodeId);
        if (element) {
          unavailableIds.current.delete(nodeId);
          const value =
            element.dataset.textValue ??
            element.querySelector("text")?.getAttribute("data-text-value") ??
            element.querySelector("text")?.textContent;
          if (value) textValues.current.set(nodeId, value);
        } else unavailableIds.current.add(nodeId);
      }
      setHasItems(getRenderedElements().length > 0);
      const request = pendingFocus.current;
      if (request) {
        const element = elementById.get(request.nodeId);
        if (element) {
          pendingFocus.current = null;
          if (request.shouldFocus) element.focus({ preventScroll: true });
          element.scrollIntoView({ block: "nearest", inline: "nearest" });
          if (request.shouldActivate) interaction.setFocusedId(request.nodeId, true);
          return;
        }
        if (!mountedIds.has(request.nodeId)) return;
        pendingFocus.current = null;
      }
      const focusedElement = elements.find(
        (element) => element === container.ownerDocument.activeElement,
      );
      if (focusedElement || container.ownerDocument.activeElement === container) {
        hasFocus.current = true;
        lastElement.current = focusedElement ?? container;
        if (focusedElement?.dataset.nodeId && focusedElement.dataset.nodeId !== focusedRef.current)
          setFocusedId(focusedElement.dataset.nodeId);
      }
      const getParentId = (nodeId: string | null) =>
        (
          rows.find((row) => row.node.id === nodeId) ??
          previousRows.current.find((row) => row.node.id === nodeId)
        )?.node.parentId;
      const current = rows.find(
        (row) => row.node.id === focusedRef.current && elementById.has(row.node.id),
      );
      let ancestorId = getParentId(focusedRef.current);
      let ancestor: TreeRow | undefined;
      while (ancestorId !== undefined && ancestorId !== null && !ancestor) {
        ancestor = rows.find((row) => row.node.id === ancestorId && elementById.has(row.node.id));
        ancestorId = getParentId(ancestorId);
      }
      const next = current ?? ancestor ?? rows.find((row) => elementById.has(row.node.id));
      if (focusedRef.current !== (next?.node.id ?? null)) {
        if (next) reveal(next.node.id, hasFocus.current, hasFocus.current);
        else setFocusedId(null);
      } else if (
        hasFocus.current &&
        lastElement.current &&
        !elements.some((element) => element === lastElement.current)
      ) {
        const nextElement = next ? elementById.get(next.node.id) : undefined;
        if (nextElement) nextElement.focus({ preventScroll: true });
        else if (!next) container.focus({ preventScroll: true });
      }
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
  }, [
    rows,
    windowRows,
    focusedId,
    focusRevision,
    containerRef,
    getElements,
    getRenderedElements,
    setFocusedId,
    reveal,
    interaction,
  ]);

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
    const focusedElement = getElements().find(
      (element) => element === containerRef.current?.ownerDocument.activeElement,
    );
    const currentId = focusedElement?.dataset.nodeId ?? focusedRef.current;
    if (focusedElement) {
      hasFocus.current = true;
      lastElement.current = focusedElement;
      if (currentId !== focusedRef.current) setFocusedId(currentId);
    }
    const availableRows = rows
      .filter((row) => !unavailableIds.current.has(row.node.id))
      .map((row) => ({
        ...row,
        node: { ...row.node, label: textValues.current.get(row.node.id) ?? row.node.label },
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
    if (nextId !== undefined) reveal(nextId);
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
  return { focusedId, setFocusedId, reveal, hasItems, onKeyDown, onFocusCapture, onBlurCapture };
};
