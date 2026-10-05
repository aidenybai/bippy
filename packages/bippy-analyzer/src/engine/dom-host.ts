import { recorder, unmountRoots } from "./dom-roots.js";
import { createElement, type ElementType } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

const errors: unknown[] = [];

export const owned = [createElement, createRoot, flushSync];

export const mount = (component: ElementType, props: Record<string, unknown>): void => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container, { onUncaughtError: (error) => errors.push(error) });
  flushSync(() => root.render(createElement(component, props)));
};

export const observe = () => ({ snapshot: recorder.snapshot(), commits: recorder.commits() });

export const takeErrors = (): unknown[] => errors.splice(0);

export const unmount = (): void => flushSync(unmountRoots);
