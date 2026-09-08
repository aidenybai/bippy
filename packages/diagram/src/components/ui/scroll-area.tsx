"use client";

import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import * as stylex from "@stylexjs/stylex";
import { colors } from "../../diagram/tokens.stylex";
import { mergeClassNames } from "../../diagram/dom-props";

export interface ScrollAreaViewportProps extends ScrollAreaPrimitive.Viewport.Props {
  [key: `data-${string}`]: string | number | boolean | undefined;
}

export interface ScrollAreaProps extends Omit<
  ScrollAreaPrimitive.Root.Props,
  "className" | "style"
> {
  className?: string;
  style?: React.CSSProperties;
  css?: stylex.StyleXStyles;
  viewportProps?: ScrollAreaViewportProps;
}

const styles = stylex.create({
  root: { position: "relative", minWidth: 0, minHeight: 0 },
  viewport: {
    width: "100%",
    height: "100%",
    outline: { default: "none", ":focus-visible": `2px solid ${colors.text}` },
    outlineOffset: -2,
  },
  scrollbar: {
    boxSizing: "border-box",
    display: "flex",
    padding: 4,
    touchAction: "none",
    userSelect: "none",
    opacity: { default: 0, ":is([data-hovering], [data-scrolling])": 1 },
  },
  vertical: { width: 14 },
  horizontal: { height: 14 },
  thumb: { flex: 1, borderRadius: 3, backgroundColor: colors.scrollThumb },
});

export const ScrollArea = ({
  className,
  style,
  css,
  viewportProps,
  children,
  ...props
}: ScrollAreaProps) => {
  const areaStyles = stylex.props(styles.root, css);
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      {...props}
      className={mergeClassNames(areaStyles.className, className)}
      style={{ ...areaStyles.style, ...style }}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        {...stylex.props(styles.viewport)}
        {...viewportProps}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollBar orientation="horizontal" />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
};

export const ScrollBar = ({
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) => (
  <ScrollAreaPrimitive.Scrollbar
    data-slot="scroll-area-scrollbar"
    orientation={orientation}
    {...stylex.props(styles.scrollbar, styles[orientation])}
    {...props}
  >
    <ScrollAreaPrimitive.Thumb data-slot="scroll-area-thumb" {...stylex.props(styles.thumb)} />
  </ScrollAreaPrimitive.Scrollbar>
);
