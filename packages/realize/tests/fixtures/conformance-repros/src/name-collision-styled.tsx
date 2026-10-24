import { createElement, forwardRef } from "react";

// Stand-in for styled-components' `styled.div`: a forwardRef whose display name is "styled.div".
export const styled = (tag: "div" | "button") => {
  const Styled = forwardRef<HTMLElement, Record<string, unknown>>((props, ref) =>
    createElement(tag, { ...props, ref }),
  );
  Styled.displayName = `styled.${tag}`;
  return Styled;
};
