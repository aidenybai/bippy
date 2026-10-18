import { useTheme } from "next-themes";

export type Theme = "light" | "dark";

interface ResolvedTheme {
  theme: Theme;
  toggleTheme: () => void;
}

export const useResolvedTheme = (): ResolvedTheme => {
  const { resolvedTheme, setTheme } = useTheme();
  const theme: Theme = resolvedTheme === "dark" ? "dark" : "light";
  return { theme, toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark") };
};
