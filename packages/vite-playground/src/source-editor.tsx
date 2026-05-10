import "bippy";
import {
  getFiberFromHostInstance,
  getLatestFiber,
  getType,
  getDisplayName,
  hotSwapFiberType,
  isCompositeFiber,
} from "bippy";
import type { Fiber } from "bippy";
import * as React from "react";
import { useState, useEffect, useRef, useCallback } from "react";

import * as JsxDevRuntime from "react/jsx-dev-runtime";
import * as JsxRuntime from "react/jsx-runtime";

const jsxDevFunction = (JsxDevRuntime as Record<string, unknown>).jsxDEV;

const REACT_SCOPE: Record<string, unknown> = {
  React,
  useState: React.useState,
  useEffect: React.useEffect,
  useRef: React.useRef,
  useMemo: React.useMemo,
  useCallback: React.useCallback,
  useReducer: React.useReducer,
  useContext: React.useContext,
  useId: React.useId,
  useTransition: React.useTransition,
  useDeferredValue: React.useDeferredValue,
  useSyncExternalStore: React.useSyncExternalStore,
  useInsertionEffect: React.useInsertionEffect,
  useLayoutEffect: React.useLayoutEffect,
  useImperativeHandle: React.useImperativeHandle,
  useDebugValue: React.useDebugValue,
  memo: React.memo,
  forwardRef: React.forwardRef,
  createContext: React.createContext,
  Suspense: React.Suspense,
  Fragment: React.Fragment,
  jsx: JsxRuntime.jsx,
  jsxs: JsxRuntime.jsxs,
  jsxDEV: jsxDevFunction,
  _jsx: JsxRuntime.jsx,
  _jsxs: JsxRuntime.jsxs,
  _jsxDEV: jsxDevFunction,
  _Fragment: React.Fragment,
  _jsxFileName: "<live-edit>",
};

const evalComponentSource = (
  source: string,
  extraScope: Record<string, unknown> = {},
): React.ComponentType<unknown> => {
  const mergedScope = { ...REACT_SCOPE, ...extraScope };
  const paramNames = Object.keys(mergedScope);
  const paramValues = Object.values(mergedScope);

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(...paramNames, `return (${source})`);
  return factory(...paramValues) as React.ComponentType<unknown>;
};

const walkToCompositeFiber = (fiber: Fiber): Fiber | null => {
  let current: Fiber | null = fiber;
  while (current) {
    if (isCompositeFiber(current)) return current;
    current = current.return;
  }
  return null;
};

interface EditorState {
  fiber: Fiber;
  originalSource: string;
  editedSource: string;
  componentName: string;
}

export function SourceEditor() {
  const [isEnabled, setIsEnabled] = useState(false);
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null);
  const isEnabledRef = useRef(isEnabled);
  const editorRef = useRef<HTMLDivElement>(null);
  isEnabledRef.current = isEnabled;

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!isEnabledRef.current) return;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (!element || editorRef.current?.contains(element)) return;
    setHighlightRect(element.getBoundingClientRect());
  }, []);

  const handleClick = useCallback((event: MouseEvent) => {
    if (!isEnabledRef.current) return;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (!element || editorRef.current?.contains(element)) return;

    event.preventDefault();
    event.stopPropagation();

    const hostFiber = getFiberFromHostInstance(element);
    if (!hostFiber) return;

    const compositeFiber = walkToCompositeFiber(getLatestFiber(hostFiber));
    if (!compositeFiber) return;

    const componentType = getType(compositeFiber.type);
    if (!componentType) return;

    const source = componentType.toString();
    const displayName = getDisplayName(compositeFiber.type) || "Component";

    setEditorState({
      fiber: compositeFiber,
      originalSource: source,
      editedSource: source,
      componentName: displayName,
    });
    setError(null);
    setHighlightRect(null);
  }, []);

  useEffect(() => {
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("click", handleClick, true);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("click", handleClick, true);
    };
  }, [handleMouseMove, handleClick]);

  const handleApply = () => {
    if (!editorState) return;
    setError(null);

    try {
      const newComponent = evalComponentSource(editorState.editedSource);
      const latestFiber = getLatestFiber(editorState.fiber);
      hotSwapFiberType(latestFiber, newComponent);

      setEditorState((previousState) =>
        previousState
          ? { ...previousState, fiber: latestFiber, originalSource: editorState.editedSource }
          : null,
      );
    } catch (evalError) {
      setError(evalError instanceof Error ? evalError.message : String(evalError));
    }
  };

  const handleReset = () => {
    if (!editorState) return;
    setEditorState({ ...editorState, editedSource: editorState.originalSource });
    setError(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      handleApply();
    }

    if (event.key === "Tab") {
      event.preventDefault();
      const textarea = event.currentTarget;
      const selectionStart = textarea.selectionStart;
      const selectionEnd = textarea.selectionEnd;
      const updatedSource =
        editorState!.editedSource.substring(0, selectionStart) +
        "  " +
        editorState!.editedSource.substring(selectionEnd);
      setEditorState((previousState) =>
        previousState ? { ...previousState, editedSource: updatedSource } : null,
      );
      requestAnimationFrame(() => {
        textarea.selectionStart = selectionStart + 2;
        textarea.selectionEnd = selectionStart + 2;
      });
    }
  };

  return (
    <>
      <button
        onClick={() => {
          setIsEnabled(!isEnabled);
          if (isEnabled) {
            setEditorState(null);
            setHighlightRect(null);
            setError(null);
          }
        }}
        style={{
          padding: "6px 14px",
          borderRadius: 6,
          border: "1px solid #e5e7eb",
          background: isEnabled ? "#dc2626" : "#fff",
          color: isEnabled ? "#fff" : "#000",
          cursor: "pointer",
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        {isEnabled ? "Stop Editing" : "Live Edit"}
      </button>

      {isEnabled && highlightRect && !editorState && (
        <div
          style={{
            position: "fixed",
            top: highlightRect.top,
            left: highlightRect.left,
            width: highlightRect.width,
            height: highlightRect.height,
            border: "2px solid #2563eb",
            borderRadius: 2,
            pointerEvents: "none",
            zIndex: 99998,
          }}
        />
      )}

      {editorState && (
        <div
          ref={editorRef}
          style={{
            position: "fixed",
            top: 16,
            right: 16,
            bottom: 16,
            width: 520,
            background: "#1e1e2e",
            borderRadius: 12,
            boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
            zIndex: 99999,
            fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid #313244",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexShrink: 0,
            }}
          >
            <span style={{ color: "#cdd6f4", fontSize: 13, fontWeight: 600 }}>
              {editorState.componentName}
            </span>
            <button
              onClick={() => {
                setEditorState(null);
                setError(null);
              }}
              style={{
                background: "none",
                border: "none",
                color: "#6c7086",
                cursor: "pointer",
                fontSize: 18,
                lineHeight: 1,
                padding: "0 4px",
              }}
            >
              ×
            </button>
          </div>

          <textarea
            value={editorState.editedSource}
            onChange={(event) =>
              setEditorState({ ...editorState, editedSource: event.target.value })
            }
            onKeyDown={handleKeyDown}
            spellCheck={false}
            style={{
              flex: 1,
              background: "transparent",
              color: "#cdd6f4",
              border: "none",
              padding: 16,
              fontSize: 13,
              lineHeight: 1.6,
              resize: "none",
              outline: "none",
              tabSize: 2,
              whiteSpace: "pre",
              overflowWrap: "normal",
              overflowX: "auto",
            }}
          />

          {error && (
            <div
              style={{
                padding: "10px 16px",
                background: "#45141a",
                color: "#f38ba8",
                fontSize: 12,
                borderTop: "1px solid #633",
                maxHeight: 120,
                overflow: "auto",
                flexShrink: 0,
                whiteSpace: "pre-wrap",
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              padding: "10px 16px",
              borderTop: "1px solid #313244",
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              flexShrink: 0,
            }}
          >
            <button
              onClick={handleReset}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid #45475a",
                background: "transparent",
                color: "#a6adc8",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              Reset
            </button>
            <button
              onClick={handleApply}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "none",
                background: "#89b4fa",
                color: "#1e1e2e",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Apply (⌘↵)
            </button>
          </div>
        </div>
      )}
    </>
  );
}
