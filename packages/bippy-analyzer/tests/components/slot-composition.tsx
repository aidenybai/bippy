import * as React from "react";
import { forwardRef, type ReactNode } from "react";

// Radix-style `Slot`: element introspection through `in`, `$$typeof`, loose
// equality against null and lazy detection, all on real element values.

const REACT_LAZY_TYPE = Symbol.for("react.lazy");
const SLOTTABLE_IDENTIFIER = Symbol.for("fixture.slottable");

const isPromiseLike = (value: unknown): boolean =>
  typeof value === "object" && value !== null && "then" in value;

const isLazyComponent = (element: unknown): boolean =>
  typeof element === "object" &&
  element !== null &&
  "$$typeof" in element &&
  element.$$typeof === REACT_LAZY_TYPE &&
  "_payload" in element &&
  isPromiseLike(element._payload);

const isSlottable = (child: ReactNode): boolean =>
  React.isValidElement(child) &&
  typeof child.type === "function" &&
  "__radixId" in child.type &&
  child.type.__radixId === SLOTTABLE_IDENTIFIER;

const createSlot = (ownerName: string) => {
  const Slot = forwardRef<HTMLElement, { children?: ReactNode; className?: string }>(
    (props, forwardedRef) => {
      let { children, ...slotProps } = props;
      let slottableElement: React.ReactElement | null = null;
      let hasSlottable = false;
      const newChildren: ReactNode[] = [];
      if (isLazyComponent(children) && typeof React.use === "function") {
        children = React.use((children as { _payload: Promise<ReactNode> })._payload);
      }
      React.Children.forEach(children, (maybeSlottable) => {
        if (isSlottable(maybeSlottable)) {
          hasSlottable = true;
          const slottable = maybeSlottable as React.ReactElement<{ children: ReactNode }>;
          const child = "child" in slottable.props ? null : slottable.props.children;
          slottableElement = React.isValidElement(child) ? child : null;
          newChildren.push(slottableElement?.props?.children);
        } else {
          newChildren.push(maybeSlottable);
        }
      });
      if (slottableElement) {
        slottableElement = React.cloneElement(slottableElement, undefined, newChildren);
      } else if (
        !hasSlottable &&
        React.Children.count(children) === 1 &&
        React.isValidElement(children)
      ) {
        slottableElement = children;
      }
      if (!slottableElement) {
        if (children || children === 0) {
          throw new Error(`${ownerName} failed to slot onto its children.`);
        }
        return children;
      }
      const mergedProps = { ...slotProps, ...slottableElement.props, ref: forwardedRef };
      return React.cloneElement(slottableElement, mergedProps);
    },
  );
  Slot.displayName = `${ownerName}.Slot`;
  return Slot;
};

const Slot = createSlot("Fixture");

const Primitive = forwardRef<HTMLOListElement, React.ComponentProps<"ol"> & { asChild?: boolean }>(
  ({ asChild, ...props }, ref) => {
    const Component = asChild ? Slot : "ol";
    return <Component {...props} ref={ref} />;
  },
);
Primitive.displayName = "Primitive.ol";

const CollectionSlot = forwardRef<HTMLElement, { children: ReactNode }>(({ children }, ref) => (
  <Slot ref={ref}>{children}</Slot>
));
CollectionSlot.displayName = "CollectionSlot";

const Button = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & { asChild?: boolean }
>(({ asChild, ...props }, ref) => {
  const Component = asChild ? Slot : "button";
  return <Component {...props} ref={ref} />;
});
Button.displayName = "Button";

export default function SlotComposition() {
  return (
    <section>
      <CollectionSlot>
        <Primitive className="list">
          <li>one</li>
          <li>two</li>
        </Primitive>
      </CollectionSlot>
      <Button asChild className="link">
        <a href="/signin">Sign in</a>
      </Button>
      <Button asChild className="lazy">
        <Primitive asChild>
          <ul>
            <li>nested</li>
          </ul>
        </Primitive>
      </Button>
      <Slot>{null}</Slot>
    </section>
  );
}
