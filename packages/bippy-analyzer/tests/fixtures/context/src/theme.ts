import { createContext } from "react";

export interface Theme {
  name: string;
  accent: string;
}

export const ThemeContext = createContext<Theme>({ name: "light", accent: "blue" });
ThemeContext.displayName = "ThemeContext";

export const DensityContext = createContext<"compact" | "cozy">("cozy");
