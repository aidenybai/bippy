"use client";

import { createContext, useContext } from "react";

export interface NodeContextValue {
  labelId: string;
  descriptionId: string;
  label: string;
  annotation?: string;
  isCallable: boolean;
  labelOffset: number;
}

export const NodeContext = createContext<NodeContextValue | null>(null);
export const useNodeContext = () => {
  const context = useContext(NodeContext);
  if (!context)
    throw new Error("Label and Description must be used within a diagram node or tree item");
  return context;
};
