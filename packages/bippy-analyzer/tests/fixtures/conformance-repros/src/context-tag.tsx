import { createContext, useState } from "react";
import type { ReactNode } from "react";

const FontContext = createContext<string>("inter");

export const FontProvider = ({ children }: { children: ReactNode }) => {
  const [font] = useState("inter");
  return <FontContext value={font}>{children}</FontContext>;
};
