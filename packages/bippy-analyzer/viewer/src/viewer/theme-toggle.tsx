import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";

export const ThemeToggle = () => {
  const { theme, toggleTheme } = useResolvedTheme();
  const isDark = theme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  );
};
