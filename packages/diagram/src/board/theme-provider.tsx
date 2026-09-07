"use client";

import * as stylex from "@stylexjs/stylex";
import { useEffect, useState, type ReactNode } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "../components/ui/button";
import { TooltipProvider } from "../components/ui/tooltip";
import { colors, darkTheme } from "../diagram/tokens.stylex";

interface ThemeProviderProps {
  children: ReactNode;
}

const styles = stylex.create({
  root: { minHeight: "100vh", backgroundColor: colors.canvas, colorScheme: "light" },
  dark: { colorScheme: "dark" },
  toggle: {
    position: "fixed",
    bottom: 12,
    right: 12,
    zIndex: 1,
    appearance: "none",
    borderWidth: 0,
    borderStyle: "none",
    boxShadow: "none",
    width: 32,
    height: 32,
    padding: 8,
    display: "flex",
    color: { default: colors.muted, ":hover": colors.text },
    backgroundColor: "transparent",
    outline: { default: "none", ":focus-visible": `1px solid ${colors.blue}` },
    cursor: "pointer",
    outlineOffset: 2,
  },
});

export const ThemeProvider = ({ children }: ThemeProviderProps) => {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    let preference: string | null = null;
    try {
      preference = localStorage.getItem("diagram-theme");
    } catch {
      preference = null;
    }
    setIsDark(
      preference === "dark" ||
        (preference !== "light" && matchMedia("(prefers-color-scheme: dark)").matches),
    );
  }, []);
  return (
    <div
      data-theme={isDark ? "dark" : "light"}
      {...stylex.props(styles.root, isDark && darkTheme, isDark && styles.dark)}
    >
      <TooltipProvider>{children}</TooltipProvider>
      <Button
        type="button"
        aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
        variant="ghost"
        size="icon"
        css={styles.toggle}
        onClick={() => {
          const nextIsDark = !isDark;
          setIsDark(nextIsDark);
          try {
            localStorage.setItem("diagram-theme", nextIsDark ? "dark" : "light");
          } catch {
            return;
          }
        }}
      >
        {isDark ? (
          <Sun size={16} strokeWidth={1.5} aria-hidden />
        ) : (
          <Moon size={16} strokeWidth={1.5} aria-hidden />
        )}
      </Button>
    </div>
  );
};
