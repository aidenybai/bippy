import * as stylex from "@stylexjs/stylex";
import { fonts } from "tailwind-stylex/tokens.stylex";
import { colors, typography } from "./tokens.stylex";

export const drawing = stylex.create({
  connector: {
    fill: "none",
    stroke: colors.line,
    strokeOpacity: 1,
    strokeWidth: 1,
    pointerEvents: "none",
  },
  label: {
    fontFamily: fonts.mono,
    fontSize: typography.label,
    fill: "currentColor",
    stroke: colors.surface,
    strokeWidth: 2,
    paintOrder: "stroke",
  },
  detail: { fontSize: typography.detail },
  annotation: {
    fontFamily: fonts.mono,
    fontSize: typography.annotation,
    fill: colors.muted,
    stroke: colors.surface,
    strokeWidth: 2,
    paintOrder: "stroke",
  },
});
