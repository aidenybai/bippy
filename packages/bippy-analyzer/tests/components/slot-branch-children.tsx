import * as React from "react";
import { forwardRef, type ReactNode } from "react";

// Radix 1.2 `Slot`: `Children.toArray().find`, `isValidElement` and
// `cloneElement` receive a child that is itself a branch (a runtime-only
// ternary picks between two elements). Each alternative must be slotted onto
// separately instead of the whole child collapsing into an unknown.

const SLOTTABLE_IDENTIFIER = Symbol("fixture.slottable");

const isSlottable = (child: ReactNode): boolean =>
  React.isValidElement(child) &&
  typeof child.type === "function" &&
  "__radixId" in child.type &&
  child.type.__radixId === SLOTTABLE_IDENTIFIER;

const mergeProps = (
  slotProps: Record<string, unknown>,
  childProps: Record<string, unknown>,
): Record<string, unknown> => ({
  ...slotProps,
  ...childProps,
  className: [slotProps.className, childProps.className].filter(Boolean).join(" "),
});

const createSlotClone = (ownerName: string) => {
  const SlotClone = forwardRef<HTMLElement, { children?: ReactNode; className?: string }>(
    (props, forwardedRef) => {
      const { children, ...slotProps } = props;
      if (React.isValidElement(children)) {
        const nextProps = mergeProps(slotProps, children.props as Record<string, unknown>);
        if (children.type !== React.Fragment) nextProps.ref = forwardedRef;
        return React.cloneElement(children, nextProps);
      }
      return React.Children.count(children) > 1 ? React.Children.only(null) : null;
    },
  );
  SlotClone.displayName = `${ownerName}.SlotClone`;
  return SlotClone;
};

const createSlot = (ownerName: string) => {
  const SlotClone = createSlotClone(ownerName);
  const Slot = forwardRef<HTMLElement, { children?: ReactNode; className?: string }>(
    (props, forwardedRef) => {
      const { children, ...slotProps } = props;
      const childrenArray = React.Children.toArray(children);
      const slottable = childrenArray.find(isSlottable);
      if (slottable) {
        return (
          <SlotClone {...slotProps} ref={forwardedRef}>
            {null}
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
  Slot.displayName = `${ownerName}.Slot`;
  return Slot;
};

const Slot = createSlot("Fixture");

const Trigger = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & { asChild?: boolean }
>(({ asChild, ...props }, ref) => {
  const Component = asChild ? Slot : "button";
  return <Component {...props} ref={ref} />;
});
Trigger.displayName = "Trigger";

const isWide = () => window.innerWidth > 100;

export default function SlotBranchChildren() {
  return (
    <nav>
      <Trigger asChild className="trigger">
        {isWide() ? (
          <a href="/wide" className="wide">
            wide
          </a>
        ) : (
          <button type="button" className="narrow">
            narrow
          </button>
        )}
      </Trigger>
      <Trigger asChild className="counted">
        {isWide() ? <span>{React.Children.count([<i key="a" />, <b key="b" />])}</span> : null}
      </Trigger>
    </nav>
  );
}
