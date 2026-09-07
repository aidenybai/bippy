"use client";

import { Input as InputPrimitive } from "@base-ui/react/input";
import * as stylex from "@stylexjs/stylex";
import type { ComponentPropsWithRef, CSSProperties } from "react";
import { colors } from "../../diagram/tokens.stylex";
import { mergeClassNames } from "../../diagram/dom-props";

export interface InputProps extends Omit<
  ComponentPropsWithRef<typeof InputPrimitive>,
  "className" | "style"
> {
  className?: string;
  style?: CSSProperties;
  css?: stylex.StyleXStyles;
  density?: "default" | "compact";
}

const styles = stylex.create({
  input: {
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: 9,
    backgroundColor: colors.surface,
    color: colors.text,
    boxShadow: `0 0 0 0.5px ${colors.border}`,
    paddingInline: 12,
    paddingBlock: 6,
    fontFamily: "inherit",
    fontSize: 12,
    lineHeight: "20px",
    outline: { default: "none", ":focus": `2px solid ${colors.blue}` },
    outlineOffset: 2,
    "::placeholder": { color: colors.muted },
    "@media (forced-colors: active)": { outlineColor: "Highlight" },
  },
  compact: { paddingBlock: 2 },
});

export const Input = ({ className, style, css, density = "default", ...props }: InputProps) => {
  const inputStyles = stylex.props(styles.input, density === "compact" && styles.compact, css);
  return (
    <InputPrimitive
      data-slot="input"
      {...props}
      className={mergeClassNames(inputStyles.className, className)}
      style={{ ...inputStyles.style, ...style }}
    />
  );
};
