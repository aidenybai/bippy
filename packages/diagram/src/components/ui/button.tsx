"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import * as stylex from "@stylexjs/stylex";
import { colors } from "../../diagram/tokens.stylex";
import { mergeClassNames } from "../../diagram/dom-props";

export interface ButtonProps extends Omit<ButtonPrimitive.Props, "className" | "style"> {
  className?: string;
  style?: React.CSSProperties;
  css?: stylex.StyleXStyles;
  variant?: "default" | "ghost";
  size?: "default" | "icon" | "icon-xs";
}

const styles = stylex.create({
  button: {
    appearance: "none",
    borderWidth: 0,
    borderStyle: "none",
    borderRadius: 7,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 400,
    gap: 6,
    cursor: "pointer",
    color: { default: colors.text, ":disabled": colors.muted },
    backgroundColor: { default: colors.surface, ":hover:not(:disabled)": colors.canvas },
    boxShadow: `0 0 0 0.5px ${colors.border}`,
    outline: { default: "none", ":focus-visible": `2px solid ${colors.blue}` },
    outlineOffset: 2,
    "@media (forced-colors: active)": { outlineColor: "Highlight" },
  },
  default: { height: 32, paddingInline: 14 },
  icon: { width: 32, height: 32, padding: 0 },
  "icon-xs": { width: 24, height: 24, padding: 0 },
  ghost: {
    boxShadow: "none",
    backgroundColor: { default: "transparent", ":hover:not(:disabled)": colors.canvas },
    color: { default: colors.muted, ":hover:not(:disabled)": colors.text },
  },
});

export const Button = ({
  className,
  style,
  css,
  variant = "default",
  size = "default",
  ...props
}: ButtonProps) => {
  const buttonStyles = stylex.props(
    styles.button,
    styles[size],
    variant === "ghost" && styles.ghost,
    css,
  );
  return (
    <ButtonPrimitive
      data-slot="button"
      {...props}
      className={mergeClassNames(buttonStyles.className, className)}
      style={{ ...buttonStyles.style, ...style }}
    />
  );
};
