"use client";

import * as stylex from "@stylexjs/stylex";
import { mergeProps } from "@react-aria/utils";
import type { ComponentPropsWithRef } from "react";
import { useNodeContext } from "./node-context";
import { drawing } from "./drawing.stylex";

export interface DiagramLabelProps extends ComponentPropsWithRef<"text"> {}
export interface DiagramDescriptionProps extends ComponentPropsWithRef<"desc"> {}

export const DiagramLabel = ({ children, ...props }: DiagramLabelProps) => {
  const context = useNodeContext();
  return (
    <text
      {...mergeProps(
        {
          id: context.labelId,
          x: context.labelOffset,
          dy: "0.32em",
          "data-slot": "diagram-label",
          ...stylex.props(drawing.label),
        },
        props,
      )}
    >
      {children ?? (
        <>
          {context.label}
          {context.annotation && (
            <tspan dx={4} {...stylex.props(drawing.annotation)}>
              {context.annotation}
            </tspan>
          )}
        </>
      )}
    </text>
  );
};

export const DiagramDescription = ({ children, ...props }: DiagramDescriptionProps) => {
  const context = useNodeContext();
  return (
    <desc {...mergeProps({ id: context.descriptionId, "data-slot": "diagram-description" }, props)}>
      {children}
    </desc>
  );
};
