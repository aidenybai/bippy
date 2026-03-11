"use client";

import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { GitHubIcon } from "@/components/icons/github-icon";
import { useSite } from "@/providers/site-provider";
import { useMounted } from "@/hooks/use-mounted";
import { GRAY_SCALES } from "@/lib/gray-scales";

const GITHUB_URL = "https://github.com/aidenybai/bippy";

export const ActionButtons = () => {
  const { activeGrayScale } = useSite();
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();

  return (
    <div
      className="flex items-center gap-1.5"
      style={
        mounted
          ? ({
              "--btn-tint":
                resolvedTheme === "dark" ? undefined : GRAY_SCALES[activeGrayScale]?.shades["50"],
              "--btn-tint-hover":
                resolvedTheme === "dark" ? undefined : GRAY_SCALES[activeGrayScale]?.shades["100"],
            } as React.CSSProperties)
          : undefined
      }
    >
      <Button
        variant="outline"
        size="sm"
        className="bg-[var(--btn-tint)] hover:bg-[var(--btn-tint-hover)] text-foreground"
        asChild
      >
        <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          <GitHubIcon className="size-3.25" />
          Star on GitHub
        </a>
      </Button>
    </div>
  );
};
