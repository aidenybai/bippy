import { createElement, forwardRef, memo, type ReactNode, type Ref } from "react";

interface ButtonProps {
  tag?: string;
  size?: string;
  block?: boolean;
  children?: ReactNode;
}

interface BadgeProps {
  type?: string;
  children?: ReactNode;
}

const ButtonRender = (
  { tag, size, block, children }: ButtonProps,
  forwardedRef: Ref<HTMLElement>,
) =>
  createElement(
    tag ?? "a",
    { ref: forwardedRef, className: `${size} ${block ? "block" : "inline"}` },
    children,
  );

const Button = forwardRef<HTMLElement, ButtonProps>(ButtonRender);
Button.defaultProps = { tag: "button", size: "regular", block: false };

const Badge = memo(({ type, children }: BadgeProps) => <span className={type}>{children}</span>);
Badge.defaultProps = { type: "primary" };

export const isExact = true;

export default function WrapperDefaultProps() {
  return (
    <div>
      {createElement(Button, null, "Save")}
      {createElement(Button, { size: "large", block: true }, "Publish")}
      {createElement(Badge, null, "new")}
      {createElement(Badge, { type: "danger" }, "late")}
    </div>
  );
}
