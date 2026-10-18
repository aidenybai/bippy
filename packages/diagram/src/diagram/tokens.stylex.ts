import * as stylex from "@stylexjs/stylex";
import { colors as tailwindColors } from "tailwind-stylex/tokens.stylex";

interface DiagramColors {
  [key: string]: string;
  canvas: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  line: string;
  blue: string;
  context: string;
  boundary: string;
  suspense: string;
  update: string;
  scope: string;
  activeScope: string;
  boundaryScope: string;
  control: string;
  controlHover: string;
  controlEdge: string;
  buttonEdge: string;
  ghostHover: string;
  scrollThumb: string;
  tooltip: string;
  tooltipText: string;
}

export const colors = stylex.defineVars<DiagramColors>({
  canvas: "color(display-p3 0.973 0.973 0.973)",
  surface: "oklch(1 0 0)",
  text: "oklch(0.145 0 0)",
  muted: "oklch(0.556 0 0)",
  border: "oklch(0.922 0 0)",
  control: "oklch(1 0 0)",
  controlHover: "color(display-p3 0.99 0.99 0.99)",
  controlEdge: "oklch(0.922 0 0)",
  buttonEdge: "color(display-p3 0.801 0.801 0.801)",
  ghostHover: "oklch(0.97 0 0)",
  scrollThumb: "color(display-p3 0.786 0.786 0.786)",
  tooltip: "color(display-p3 0.057 0.057 0.057)",
  tooltipText: "color(display-p3 0.949 0.949 0.949)",
  line: tailwindColors.neutral500,
  blue: tailwindColors.blue600,
  context: tailwindColors.teal700,
  boundary: tailwindColors.rose700,
  suspense: tailwindColors.amber800,
  update: tailwindColors.violet700,
  boundaryScope: `color-mix(in srgb, ${tailwindColors.rose700} 5%, transparent)`,
  scope: `color-mix(in srgb, ${tailwindColors.neutral500} 5%, transparent)`,
  activeScope: `color-mix(in srgb, ${tailwindColors.teal700} 5%, transparent)`,
});

export const darkTheme = stylex.createTheme(colors, {
  canvas: "oklch(0.123 0 0)",
  surface: "oklch(0.145 0 0)",
  text: "oklch(0.985 0 0)",
  muted: "oklch(0.708 0 0)",
  border: "oklch(1 0 0 / 8%)",
  control: "color-mix(in oklab, oklch(1 0 0 / 15%) 30%, transparent)",
  controlHover: "color-mix(in oklab, oklch(1 0 0 / 15%) 30%, transparent)",
  controlEdge: "oklch(1 0 0 / 12%)",
  buttonEdge: "oklch(1 0 0 / 12%)",
  ghostHover: "color-mix(in oklab, oklch(0.269 0 0) 50%, transparent)",
  scrollThumb: "oklch(1 0 0 / 30%)",
  line: tailwindColors.neutral500,
  blue: tailwindColors.blue400,
  context: tailwindColors.teal300,
  boundary: tailwindColors.rose300,
  suspense: tailwindColors.amber300,
  update: tailwindColors.violet300,
  boundaryScope: `color-mix(in srgb, ${tailwindColors.rose300} 8%, transparent)`,
  scope: `color-mix(in srgb, ${tailwindColors.neutral500} 8%, transparent)`,
  activeScope: `color-mix(in srgb, ${tailwindColors.teal300} 8%, transparent)`,
});

export const typography = stylex.defineConsts({
  label: "10px",
});
