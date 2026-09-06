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
  violet: string;
  pink: string;
  orange: string;
  yellow: string;
  red: string;
  teal: string;
  boundaryScope: string;
  scope: string;
}

export const colors = stylex.defineVars<DiagramColors>({
  canvas: tailwindColors.neutral50,
  surface: tailwindColors.white,
  text: tailwindColors.neutral800,
  muted: tailwindColors.neutral500,
  border: tailwindColors.neutral200,
  line: tailwindColors.neutral400,
  blue: tailwindColors.blue600,
  violet: tailwindColors.violet600,
  pink: tailwindColors.fuchsia600,
  orange: tailwindColors.orange600,
  yellow: tailwindColors.amber500,
  red: tailwindColors.red600,
  teal: tailwindColors.teal600,
  boundaryScope: `color-mix(in srgb, ${tailwindColors.red500} 6%, transparent)`,
  scope: `color-mix(in srgb, ${tailwindColors.blue500} 5%, transparent)`,
});

export const darkTheme = stylex.createTheme(colors, {
  canvas: tailwindColors.neutral950,
  surface: tailwindColors.neutral900,
  text: tailwindColors.neutral200,
  muted: tailwindColors.neutral500,
  border: tailwindColors.neutral700,
  line: tailwindColors.neutral500,
  blue: tailwindColors.blue400,
  violet: tailwindColors.violet400,
  pink: tailwindColors.fuchsia400,
  orange: tailwindColors.orange400,
  yellow: tailwindColors.amber400,
  red: tailwindColors.red400,
  teal: tailwindColors.teal400,
  boundaryScope: `color-mix(in srgb, ${tailwindColors.red400} 10%, transparent)`,
  scope: `color-mix(in srgb, ${tailwindColors.blue400} 8%, transparent)`,
});

export const typography = stylex.defineConsts({
  label: "10px",
  annotation: "6px",
});
