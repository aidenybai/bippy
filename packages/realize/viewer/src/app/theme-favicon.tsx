"use client";

import { useIsClient } from "@/hooks/use-is-client";
import { useResolvedTheme, type Theme } from "@/hooks/use-resolved-theme";

const THEMES: Theme[] = ["light", "dark"];

export const ThemeFavicon = () => {
  const { theme } = useResolvedTheme();
  const isClient = useIsClient();
  return THEMES.map((iconTheme) => (
    <link
      key={iconTheme}
      rel="icon"
      href={`/icon-${iconTheme}.png`}
      media={
        isClient
          ? iconTheme === theme
            ? "all"
            : "not all"
          : `(prefers-color-scheme: ${iconTheme})`
      }
    />
  ));
};
