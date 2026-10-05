import * as React from "react";
import { createContext, forwardRef, memo, useContext, type ReactNode } from "react";

// Radix `Slot` before `__radixId`: a Slottable child is detected by comparing
// `child.type` against the component itself, so element types must keep the
// identity of the function, class or wrapper they were created from.

const Slottable = ({ children }: { children?: ReactNode }) => <>{children}</>;

const isSlottable = (child: ReactNode): boolean =>
  React.isValidElement(child) && child.type === Slottable;

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

const GroupContext = createContext<string | null>(null);

const GroupImpl = forwardRef<HTMLDivElement, { children?: ReactNode; className?: string }>(
  (props, forwardedRef) => (
    <GroupContext.Provider value="group">
      <div {...props} ref={forwardedRef} />
    </GroupContext.Provider>
  ),
);
GroupImpl.displayName = "GroupImpl";

const Group = forwardRef<HTMLDivElement, { children?: ReactNode }>((props, forwardedRef) => (
  <Slot className="group">
    <GroupImpl {...props} ref={forwardedRef} />
  </Slot>
));
Group.displayName = "Group";

const Item = ({ children }: { children?: ReactNode }) => {
  const group = useContext(GroupContext);
  if (!group) throw new Error("`Item` must be used within `Group`");
  return <span data-group={group}>{children}</span>;
};

class Legacy extends React.Component<{ children?: ReactNode }> {
  render() {
    return <em>{this.props.children}</em>;
  }
}
const Memoed = memo(Item);

const describeType = (element: React.ReactElement, candidate: unknown): string =>
  element.type === candidate ? "same" : "different";

export default function ElementTypeIdentity() {
  return (
    <section>
      <Group>
        <Item>first</Item>
        <Item>second</Item>
      </Group>
      <Slot className="slotted">
        <span>plain</span>
        <Slottable>
          <p>slottable</p>
        </Slottable>
      </Slot>
      <ul>
        <li>{describeType(<Item />, Item)}</li>
        <li>{describeType(<Item />, Slottable)}</li>
        <li>{describeType(<Legacy />, Legacy)}</li>
        <li>{describeType(<Memoed />, Memoed)}</li>
        <li>{describeType(<Memoed />, Item)}</li>
        <li>{describeType(<Group />, Group)}</li>
        <li>{describeType(<Group />, GroupImpl)}</li>
        <li>{describeType(<GroupContext.Provider value="x" />, GroupContext.Provider)}</li>
        <li>{describeType(<div />, "div")}</li>
        <li>{describeType(<div />, Item)}</li>
      </ul>
    </section>
  );
}
