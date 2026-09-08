"use client";

import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { spacing, fontSizes } from "tailwind-stylex/tokens.stylex";
import { colors } from "../diagram/tokens.stylex";

export interface SpecimenProps {
  id: string;
  name: string;
  children: ReactNode;
  size?: "single" | "double" | "full";
  fitContent?: boolean;
}

const styles = stylex.create({
  cell: {
    boxSizing: "border-box",
    height: 325,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: spacing[3],
    padding: spacing[4],
    backgroundColor: colors.surface,
  },
  double: {
    gridColumn: { default: "span 2", "@media (max-width: 713px)": "span 1" },
    gridRow: "span 2",
    height: 666,
  },
  full: { gridColumn: "1 / -1", width: "100%", height: "auto", minHeight: 325 },
  fitContent: { height: "auto", minHeight: 0, alignSelf: "start" },
  title: {
    margin: 0,
    fontSize: fontSizes.xs,
    lineHeight: "16px",
    fontWeight: 400,
    color: colors.muted,
  },
  body: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    overflow: "auto",
    scrollbarWidth: "thin",
    scrollbarColor: `${colors.border} transparent`,
    display: "flex",
  },
  content: {
    margin: "auto",
    flexShrink: 0,
    minWidth: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
  },
});

export const Specimen = ({
  id,
  name,
  children,
  size = "single",
  fitContent = false,
}: SpecimenProps) => {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      {...stylex.props(
        styles.cell,
        size === "double" && styles.double,
        size === "full" && styles.full,
        fitContent && styles.fitContent,
      )}
    >
      <h2 id={`${id}-title`} {...stylex.props(styles.title)}>
        {name}
      </h2>
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.content)}>{children}</div>
      </div>
    </section>
  );
};
