"use client";

import { createContext, useState, type ReactNode } from "react";

export const ThemeContext = createContext("light");
ThemeContext.displayName = "ThemeContext";

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme] = useState("light");
  return <ThemeContext value={theme}>{children}</ThemeContext>;
};
