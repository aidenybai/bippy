interface GrayScale {
  label: string;
  shades: Record<string, string>;
}

export const GRAY_SCALES: Record<string, GrayScale> = {
  neutral: {
    label: "Neutral",
    shades: {
      "50": "oklch(0.985 0 0)",
      "100": "oklch(0.97 0 0)",
      "200": "oklch(0.922 0 0)",
      "300": "oklch(0.87 0 0)",
      "400": "oklch(0.708 0 0)",
      "500": "oklch(0.556 0 0)",
      "600": "oklch(0.439 0 0)",
      "700": "oklch(0.371 0 0)",
      "800": "oklch(0.269 0 0)",
      "900": "oklch(0.199 0 0)",
      "950": "oklch(0.145 0 0)",
    },
  },
  slate: {
    label: "Slate",
    shades: {
      "50": "oklch(0.984 0.003 247.858)",
      "100": "oklch(0.968 0.007 247.896)",
      "200": "oklch(0.929 0.013 255.508)",
      "300": "oklch(0.869 0.022 252.894)",
      "400": "oklch(0.704 0.04 256.788)",
      "500": "oklch(0.554 0.046 257.417)",
      "600": "oklch(0.446 0.043 257.281)",
      "700": "oklch(0.372 0.044 257.287)",
      "800": "oklch(0.279 0.041 260.031)",
      "900": "oklch(0.208 0.042 265.755)",
      "950": "oklch(0.129 0.042 264.695)",
    },
  },
  gray: {
    label: "Gray",
    shades: {
      "50": "oklch(0.985 0.002 247.839)",
      "100": "oklch(0.967 0.003 264.542)",
      "200": "oklch(0.928 0.006 264.531)",
      "300": "oklch(0.872 0.01 258.338)",
      "400": "oklch(0.707 0.022 261.325)",
      "500": "oklch(0.551 0.027 264.364)",
      "600": "oklch(0.446 0.03 256.802)",
      "700": "oklch(0.373 0.034 259.733)",
      "800": "oklch(0.278 0.033 256.848)",
      "900": "oklch(0.21 0.034 264.665)",
      "950": "oklch(0.13 0.028 261.692)",
    },
  },
  zinc: {
    label: "Zinc",
    shades: {
      "50": "oklch(0.985 0 0)",
      "100": "oklch(0.967 0.001 286.375)",
      "200": "oklch(0.92 0.004 286.32)",
      "300": "oklch(0.871 0.006 286.286)",
      "400": "oklch(0.705 0.015 286.067)",
      "500": "oklch(0.552 0.016 285.938)",
      "600": "oklch(0.442 0.017 285.786)",
      "700": "oklch(0.37 0.013 285.805)",
      "800": "oklch(0.274 0.006 286.033)",
      "900": "oklch(0.21 0.006 285.885)",
      "950": "oklch(0.141 0.005 285.823)",
    },
  },
  stone: {
    label: "Stone",
    shades: {
      "50": "oklch(0.985 0.001 106.423)",
      "100": "oklch(0.97 0.001 106.424)",
      "200": "oklch(0.923 0.003 48.717)",
      "300": "oklch(0.869 0.005 56.366)",
      "400": "oklch(0.709 0.01 56.259)",
      "500": "oklch(0.553 0.013 58.071)",
      "600": "oklch(0.444 0.011 73.639)",
      "700": "oklch(0.374 0.01 67.558)",
      "800": "oklch(0.268 0.007 34.298)",
      "900": "oklch(0.188 0.005 53.3)",
      "950": "oklch(0.147 0.004 49.25)",
    },
  },
  mauve: {
    label: "Mauve",
    shades: {
      "50": "oklch(0.985 0.003 310)",
      "100": "oklch(0.968 0.006 310)",
      "200": "oklch(0.925 0.011 310)",
      "300": "oklch(0.87 0.017 310)",
      "400": "oklch(0.708 0.03 310)",
      "500": "oklch(0.556 0.03 310)",
      "600": "oklch(0.44 0.028 310)",
      "700": "oklch(0.372 0.025 310)",
      "800": "oklch(0.27 0.02 310)",
      "900": "oklch(0.208 0.018 310)",
      "950": "oklch(0.145 0.014 310)",
    },
  },
  olive: {
    label: "Olive",
    shades: {
      "50": "oklch(0.985 0.003 130)",
      "100": "oklch(0.968 0.006 130)",
      "200": "oklch(0.925 0.011 130)",
      "300": "oklch(0.87 0.017 130)",
      "400": "oklch(0.708 0.028 130)",
      "500": "oklch(0.556 0.028 130)",
      "600": "oklch(0.44 0.024 130)",
      "700": "oklch(0.372 0.02 130)",
      "800": "oklch(0.27 0.016 130)",
      "900": "oklch(0.208 0.014 130)",
      "950": "oklch(0.145 0.01 130)",
    },
  },
};

export const applyGrayScale = (scaleKey: string, isDark: boolean) => {
  const scale = GRAY_SCALES[scaleKey];
  if (!scale) return;

  const root = document.documentElement;
  const shades = scale.shades;

  if (isDark) {
    root.style.setProperty("--background", shades["900"]);
    root.style.setProperty("--foreground", shades["50"]);
    root.style.setProperty("--card", shades["900"]);
    root.style.setProperty("--card-foreground", shades["50"]);
    root.style.setProperty("--popover", shades["900"]);
    root.style.setProperty("--popover-foreground", shades["50"]);
    root.style.setProperty("--primary", "oklch(1 0 0)");
    root.style.setProperty("--primary-foreground", "oklch(0 0 0)");
    root.style.setProperty("--secondary", shades["800"]);
    root.style.setProperty("--secondary-foreground", shades["50"]);
    root.style.setProperty("--muted", shades["800"]);
    root.style.setProperty("--muted-foreground", shades["300"]);
    root.style.setProperty("--accent", shades["800"]);
    root.style.setProperty("--accent-foreground", shades["50"]);
    root.style.setProperty("--border", `${shades["800"]}`);
    root.style.setProperty("--input", `${shades["800"]}`);
    root.style.setProperty("--ring", shades["500"]);
  } else {
    root.style.setProperty("--background", shades["50"]);
    root.style.setProperty("--foreground", shades["950"]);
    root.style.setProperty("--card", "oklch(1 0 0)");
    root.style.setProperty("--card-foreground", shades["950"]);
    root.style.setProperty("--popover", "oklch(1 0 0)");
    root.style.setProperty("--popover-foreground", shades["950"]);
    root.style.setProperty("--primary", shades["900"]);
    root.style.setProperty("--primary-foreground", shades["50"]);
    root.style.setProperty("--secondary", shades["100"]);
    root.style.setProperty("--secondary-foreground", shades["900"]);
    root.style.setProperty("--muted", shades["100"]);
    root.style.setProperty("--muted-foreground", shades["600"]);
    root.style.setProperty("--accent", shades["100"]);
    root.style.setProperty("--accent-foreground", shades["900"]);
    root.style.setProperty("--border", shades["200"]);
    root.style.setProperty("--input", shades["200"]);
    root.style.setProperty("--ring", shades["400"]);
  }
};
