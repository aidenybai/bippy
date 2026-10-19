import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useResolvedTheme } from "@/hooks/use-resolved-theme";

export const ThemeToggle = () => {
  const { toggleTheme } = useResolvedTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      aria-label="Toggle theme"
      title="Toggle theme"
    >
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  );
};
