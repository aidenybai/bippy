"use client";

import { Children, isValidElement, type ReactNode } from "react";

const SLOTTABLE_IDENTIFIER = Symbol("slottable");

export const Slottable = ({ children }: { children: ReactNode }) => <>{children}</>;
Slottable.__radixId = SLOTTABLE_IDENTIFIER;

const isSlottable = (child: ReactNode): boolean =>
  isValidElement(child) &&
  typeof child.type === "function" &&
  "__radixId" in child.type &&
  child.type.__radixId === SLOTTABLE_IDENTIFIER;

export const Slot = ({ children }: { children: ReactNode }) => {
  const slottable = Children.toArray(children).find(isSlottable);
  return slottable ? <b>{slottable}</b> : <i>{children}</i>;
};
