"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { COPY_FEEDBACK_DURATION_MS } from "@/constants";

interface SiteContextValue {
  activeTab: string;
  copied: boolean;
  setActiveTab: (tab: string) => void;
  copyCommand: () => void;
}

const SiteContext = createContext<SiteContextValue | null>(null);

export const useSite = () => {
  const context = useContext(SiteContext);
  if (!context) {
    throw new Error("useSite must be used within SiteProvider");
  }
  return context;
};

const BIPPY_COMMAND = "npm install bippy";
const BIPPY_AGENT_PROMPT = "Install bippy (must be imported before React) and set up instrument() with secure() to hook into React DevTools internals. Use traverseRenderedFibers to detect re-renders, traverseFiber to walk the fiber tree, and traverseProps/traverseState/traverseContexts to inspect component data. See https://bippy.dev for the full API.";

interface SiteProviderProps {
  children: ReactNode;
}

export const SiteProvider = ({ children }: SiteProviderProps) => {
  const [activeTab, setActiveTab] = useState("command");
  const [copied, setCopied] = useState(false);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setCopied(false);
  };

  const copyCommand = () => {
    const text = activeTab === "command" ? BIPPY_COMMAND : BIPPY_AGENT_PROMPT;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS);
  };

  return (
    <SiteContext.Provider
      value={{
        activeTab,
        copied,
        setActiveTab: handleTabChange,
        copyCommand,
      }}
    >
      {children}
    </SiteContext.Provider>
  );
};
