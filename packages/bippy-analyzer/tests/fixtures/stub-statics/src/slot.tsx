import * as React from "react";
import { forwardRef, type ReactNode } from "react";

const SLOTTABLE_IDENTIFIER = Symbol("radix.slottable");

interface SlottableComponent {
  ({ children }: { children?: ReactNode }): React.JSX.Element;
  __radixId?: symbol;
}

export const Slottable: SlottableComponent = ({ children }) => <>{children}</>;
Slottable.__radixId = SLOTTABLE_IDENTIFIER;

const isSlottable = (child: ReactNode): boolean =>
  React.isValidElement(child) &&
  typeof child.type !== "string" &&
  "__radixId" in child.type &&
  child.type.__radixId === SLOTTABLE_IDENTIFIER;

const Slot = forwardRef<HTMLElement, { children?: ReactNode; className?: string }>(
  (props, forwardedRef) => {
    const { children, ...slotProps } = props;
    const childrenArray = React.Children.toArray(children);
    const slottable = childrenArray.find(isSlottable);
    if (slottable && React.isValidElement<{ children?: ReactNode }>(slottable)) {
      const newElement = slottable.props.children;
      const newChildren = childrenArray.map((child) =>
        child === slottable && React.isValidElement<{ children?: ReactNode }>(newElement)
          ? newElement.props.children
          : child,
      );
      return React.isValidElement(newElement)
        ? React.cloneElement(newElement, { ...slotProps, ref: forwardedRef }, newChildren)
        : null;
    }
    return React.isValidElement(children)
      ? React.cloneElement(children, { ...slotProps, ref: forwardedRef })
      : null;
  },
);
Slot.displayName = "Slot";

export const Button = ({ asChild, children }: { asChild?: boolean; children?: ReactNode }) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className="button">{children}</Comp>;
};
