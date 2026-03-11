"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { useMounted } from "@/hooks/use-mounted";

export const ThemeToggle = () => {
  const mounted = useMounted();
  const { resolvedTheme, setTheme } = useTheme();

  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  return (
    <button
      onClick={toggleTheme}
      className="flex h-5 items-center justify-center rounded text-muted-foreground transition-none hover:text-foreground"
      aria-label="Toggle theme"
    >
      {mounted && (resolvedTheme === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />)}
    </button>
  );
};
