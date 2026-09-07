import { type ComponentType, forwardRef, memo, type ReactNode } from "react";

interface LabelledProps {
  label: string;
}

const Label = ({ label }: LabelledProps) => <span>{label}</span>;

const withBorder = <Props extends object>(Wrapped: ComponentType<Props>) => {
  const WithBorder = (props: Props) => (
    <div className="border">
      <Wrapped {...props} />
    </div>
  );
  WithBorder.displayName = `withBorder(${Wrapped.displayName ?? Wrapped.name})`;
  return WithBorder;
};

const withPrefix =
  (prefix: string) =>
  <Props extends LabelledProps>(Wrapped: ComponentType<Props>) =>
    function WithPrefix(props: Props) {
      return <Wrapped {...props} label={`${prefix}${props.label}`} />;
    };

const withRef = (Wrapped: ComponentType<LabelledProps>) =>
  forwardRef<HTMLDivElement, LabelledProps>((props, ref) => (
    <div ref={ref}>
      <Wrapped {...props} />
    </div>
  ));

const compose =
  <Props extends LabelledProps>(
    ...enhancers: Array<(component: ComponentType<Props>) => ComponentType<Props>>
  ) =>
  (component: ComponentType<Props>) =>
    enhancers.reduceRight((wrapped, enhance) => enhance(wrapped), component);

const withChildrenSlot =
  (Wrapped: ComponentType<{ children: ReactNode }>) => (props: { title: string }) => (
    <Wrapped>
      <h3>{props.title}</h3>
    </Wrapped>
  );

const Frame = ({ children }: { children: ReactNode }) => <section>{children}</section>;

const BorderedLabel = withBorder(Label);
const PrefixedLabel = withPrefix("» ")(Label);
const RefLabel = withRef(Label);
const Composed = compose(withBorder, withPrefix("~ "), memo)(Label);
const SlottedFrame = withChildrenSlot(Frame);

export default function Hocs() {
  return (
    <main>
      <BorderedLabel label="bordered" />
      <PrefixedLabel label="prefixed" />
      <RefLabel label="ref" />
      <Composed label="composed" />
      <SlottedFrame title="slotted" />
    </main>
  );
}
