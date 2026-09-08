import {
  createElement,
  forwardRef,
  type ForwardRefExoticComponent,
  type ReactNode,
  type Ref,
} from "react";

interface ElementProps {
  children?: ReactNode;
  className?: string;
  ref?: Ref<HTMLElement>;
}

interface LabelledProps {
  children?: ReactNode;
}

type DomComponent = ForwardRefExoticComponent<ElementProps>;

function DOMElement(tagName: string, props: ElementProps, forwardedRef: Ref<HTMLElement>) {
  return createElement(tagName, { ...props, ref: forwardedRef });
}

DOMElement.displayName = "InheritedName";

const domComponentCache: Record<string, DomComponent> = {};
const domTarget: Record<string, DomComponent> = {};
const dom = new Proxy(domTarget, {
  get(_target, tagName) {
    if (typeof tagName !== "string") return undefined;
    let component = domComponentCache[tagName];
    if (!component) {
      component = forwardRef<HTMLElement, ElementProps>(DOMElement.bind(null, tagName));
      domComponentCache[tagName] = component;
    }
    return component;
  },
});

function Labelled(prefix: string, { children }: LabelledProps) {
  return (
    <span>
      {prefix}: {children}
    </span>
  );
}

Labelled.displayName = "LabelledName";

const Price = Labelled.bind(null, "Price");
const Total = Labelled.bind(null, "Total");
const Bold = (({ children }: LabelledProps) => <b>{children}</b>).bind(null);
const getDisplayName = (component: { name: string; displayName?: string }) => component.displayName;

export default function BoundComponents() {
  const Button = dom.button;
  const Section = dom.section;
  return (
    <Section className="cart">
      <Button className="primary">Buy</Button>
      <Price>10</Price>
      <Total>12</Total>
      <Bold>bold</Bold>
      {Price.name === "bound Labelled" ? <em /> : <strong />}
      {Bold.name === "bound " ? <em /> : <strong />}
      {getDisplayName(Price) === undefined ? <em /> : <strong />}
      {getDisplayName(Labelled) === "LabelledName" ? <em /> : <strong />}
    </Section>
  );
}
