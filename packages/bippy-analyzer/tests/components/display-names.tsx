import styled from "@emotion/styled";
import { type ComponentType, forwardRef, memo, type ReactNode } from "react";

// `react-is`-style reflection over wrapper objects: a `switch` on `$$typeof`
// symbols, `forwardRef(...).render` and `memo(...).type`, with the computed
// name written back as `displayName` on both a plain wrapper and an emotion
// styled component (the way MUI's `createStyled` does).

const FORWARD_REF = Symbol.for("react.forward_ref");
const MEMO = Symbol.for("react.memo");

interface NamedFunction {
  displayName?: string;
  name: string;
}

interface WrapperObject {
  $$typeof: symbol;
  render?: NamedFunction;
  type?: unknown;
}

const isWrapperObject = (value: unknown): value is WrapperObject =>
  typeof value === "object" && value !== null && "$$typeof" in value;

const getFunctionName = (render: NamedFunction, fallback: string): string =>
  render.displayName || render.name || fallback;

const getDisplayName = (Component: unknown): string | undefined => {
  if (Component === null || Component === undefined) return undefined;
  if (typeof Component === "string") return Component;
  if (typeof Component === "function") return getFunctionName(Component, "Component");
  if (!isWrapperObject(Component)) return undefined;
  switch (Component.$$typeof) {
    case FORWARD_REF:
      return `ForwardRef(${Component.render ? getFunctionName(Component.render, "") : ""})`;
    case MEMO:
      return `memo(${getDisplayName(Component.type)})`;
    default:
      return undefined;
  }
};

const withLabel = <P extends object>(Inner: ComponentType<P>): ComponentType<P> => {
  const Labeled = (props: P) => <Inner {...props} />;
  Labeled.displayName = `Labeled(${getDisplayName(Inner)})`;
  return Labeled;
};

const Plain = ({ children }: { children?: ReactNode }) => <span>{children}</span>;

const Field = forwardRef<HTMLInputElement, { placeholder: string }>(function Field(
  { placeholder },
  ref,
) {
  return <input ref={ref} placeholder={placeholder} />;
});

const Anonymous = forwardRef<HTMLElement>((_props, ref) => <i ref={ref} />);

const Named = forwardRef<HTMLElement>((_props, ref) => <u ref={ref} />);
Named.displayName = "Named";

const Cached = memo(Plain);

const CachedAnonymous = memo(() => <small>cached</small>);
CachedAnonymous.displayName = "CachedAnonymous";

const LabeledPlain = withLabel(Plain);
const LabeledField = withLabel(Field);
const LabeledAnonymous = withLabel(Anonymous);
const LabeledNamed = withLabel(Named);
const LabeledCached = withLabel(Cached);
const LabeledCachedAnonymous = withLabel(CachedAnonymous);
const LabeledMemoField = withLabel(memo(Field));

const Root = styled("section", { label: "Card-root" })`
  padding: 4px;
`;
Root.displayName = `Card${"Root"}`;

const Nested = styled(Field)`
  border: 0;
`;
Nested.displayName = "NestedField";

const kindOf = (value: unknown): string => {
  switch (typeof value) {
    case "string":
      return "text";
    case "object":
      return value === null ? "null" : "object";
    default:
      return "other";
  }
};

export default function DisplayNames() {
  return (
    <Root>
      <LabeledPlain>plain</LabeledPlain>
      <LabeledField placeholder="field" />
      <LabeledAnonymous />
      <LabeledNamed />
      <LabeledCached>cached</LabeledCached>
      <LabeledCachedAnonymous />
      <LabeledMemoField placeholder="memo field" />
      <Nested placeholder="nested" />
      <em>{kindOf(Field)}</em>
      <em>{kindOf(null)}</em>
    </Root>
  );
}
