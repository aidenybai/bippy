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
  scope: string;
  activeScope: string;
}

export const colors = stylex.defineVars<DiagramColors>({
  canvas: tailwindColors.neutral50,
  surface: tailwindColors.white,
  text: tailwindColors.neutral800,
  muted: tailwindColors.neutral500,
  border: tailwindColors.neutral200,
  line: tailwindColors.neutral400,
  blue: tailwindColors.blue600,
  scope: `color-mix(in srgb, ${tailwindColors.neutral500} 5%, transparent)`,
  activeScope: `color-mix(in srgb, ${tailwindColors.blue500} 5%, transparent)`,
});

export const darkTheme = stylex.createTheme(colors, {
  canvas: tailwindColors.neutral950,
  surface: tailwindColors.neutral900,
  text: tailwindColors.neutral200,
  muted: tailwindColors.neutral500,
  border: tailwindColors.neutral700,
  line: tailwindColors.neutral500,
  blue: tailwindColors.blue400,
  scope: `color-mix(in srgb, ${tailwindColors.neutral500} 8%, transparent)`,
  activeScope: `color-mix(in srgb, ${tailwindColors.blue400} 8%, transparent)`,
});

export const typography = stylex.defineConsts({
  label: "10px",
  detail: "8px",
  annotation: "6px",
});
