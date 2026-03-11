"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useSite } from "@/providers/site-provider";
import { GRAY_SCALES, applyGrayScale } from "@/lib/gray-scales";

const SCALE_KEYS = Object.keys(GRAY_SCALES);
const LIGHT_HIDDEN_KEYS = new Set(["slate"]);

export const GrayScaleSwitcher = () => {
  const { activeGrayScale, setActiveGrayScale } = useSite();
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    applyGrayScale(activeGrayScale, resolvedTheme === "dark");
  }, [activeGrayScale, resolvedTheme]);

  return (
    <div className="grid grid-cols-4 gap-1">
      {SCALE_KEYS.filter((key) => resolvedTheme === "dark" || !LIGHT_HIDDEN_KEYS.has(key)).map(
        (key) => (
          <button
            key={key}
            onClick={() => setActiveGrayScale(key)}
            className="flex size-5 items-center justify-center rounded transition-none"
            style={{ background: GRAY_SCALES[key].shades["500"] }}
            aria-label={GRAY_SCALES[key].label}
            title={GRAY_SCALES[key].label}
          >
            <div
              className="rounded-full bg-white transition-none"
              style={{
                width: activeGrayScale === key ? 6 : 0,
                height: activeGrayScale === key ? 6 : 0,
                boxShadow: "none",
              }}
            />
          </button>
        ),
      )}
    </div>
  );
};
