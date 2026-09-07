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
}

export const colors = stylex.defineVars<DiagramColors>({
  canvas: tailwindColors.neutral50,
  surface: tailwindColors.white,
  text: tailwindColors.neutral800,
  muted: tailwindColors.neutral600,
  border: tailwindColors.neutral200,
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
  canvas: tailwindColors.neutral950,
  surface: tailwindColors.neutral900,
  text: tailwindColors.neutral200,
  muted: tailwindColors.neutral400,
  border: tailwindColors.neutral700,
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
