import * as React from "react";
import { forwardRef, type ReactNode } from "react";

// Radix `Slot` 1.0: `Children.toArray(children).find(isSlottable)` where
// `isSlottable` compares `child.type` against the `Slottable` component.

const Slottable = ({ children }: { children: ReactNode }) => <>{children}</>;

const isSlottable = (child: ReactNode): boolean =>
  React.isValidElement(child) && child.type === Slottable;

const SlotClone = forwardRef<HTMLElement, { children?: ReactNode; className?: string }>(
  (props, forwardedRef) => {
    const { children, ...slotProps } = props;
    if (React.isValidElement(children)) {
      return React.cloneElement(children, { ...slotProps, ...children.props, ref: forwardedRef });
    }
    return React.Children.count(children) > 1 ? React.Children.only(null) : null;
  },
);
SlotClone.displayName = "SlotClone";

const Slot = forwardRef<HTMLElement, { children?: ReactNode; className?: string }>(
  (props, forwardedRef) => {
    const { children, ...slotProps } = props;
    const childrenArray = React.Children.toArray(children);
    const slottable = childrenArray.find(isSlottable);
    if (slottable) {
      const newElement = slottable.props.children;
      const newChildren = childrenArray.map((child) => {
        if (child === slottable) {
          if (React.Children.count(newElement) > 1) return React.Children.only(null);
          return React.isValidElement(newElement) ? newElement.props.children : null;
        }
        return child;
      });
      return (
        <SlotClone {...slotProps} ref={forwardedRef}>
          {React.isValidElement(newElement)
            ? React.cloneElement(newElement, undefined, newChildren)
            : null}
        </SlotClone>
      );
    }
    return (
      <SlotClone {...slotProps} ref={forwardedRef}>
        {children}
      </SlotClone>
    );
  },
);
Slot.displayName = "Slot";

const Button = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & { asChild?: boolean }
>(({ asChild, ...props }, ref) => {
  const Component = asChild ? Slot : "button";
  return <Component {...props} ref={ref} />;
});
Button.displayName = "Button";

export const isExact = true;

export default function SlotFind() {
  return (
    <section>
      <Button asChild className="link">
        <a href="/signin">Sign in</a>
      </Button>
      <Button asChild>
        <Button>
          <span>inner</span>
        </Button>
      </Button>
      <Slot>
        <i>icon</i>
        <Slottable>
          <b>label</b>
        </Slottable>
      </Slot>
      {React.Children.count([null, [<i key="a" />, "text"], false]) === 4 ? <em>four</em> : null}
      {React.Children.count(undefined) === 0 && React.Children.count(false) === 1 ? (
        <small>counted</small>
      ) : null}
    </section>
  );
}
