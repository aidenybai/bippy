import { createElement, type ComponentProps, type ElementType, type ReactNode } from "react";

type StyledProps<Tag extends ElementType> = ComponentProps<Tag> & { children?: ReactNode };

interface Interpolation<Props> {
  (props: Props): string | number | false | null | undefined;
}

/** A minimal styled-components: the tagged template becomes a component rendering `tag`. */
const styled =
  <Tag extends ElementType>(tag: Tag) =>
  (
    strings: TemplateStringsArray,
    ...interpolations: Array<string | Interpolation<StyledProps<Tag>>>
  ) => {
    const Styled = (props: StyledProps<Tag>) => {
      const css = strings
        .map((chunk, index) => {
          const interpolation = interpolations[index];
          const resolved =
            typeof interpolation === "function" ? interpolation(props) : interpolation;
          return `${chunk}${resolved ?? ""}`;
        })
        .join("");
      return createElement(tag, { ...props, "data-css": css.trim() });
    };
    Styled.displayName = `styled.${String(tag)}`;
    return Styled;
  };

styled.div = styled("div");
styled.span = styled("span");
styled.button = styled("button");

const Card = styled.div`
  padding: 8px;
  color: ${(props) => (props.title ? "red" : "blue")};
`;

const Badge = styled.span`
  font-weight: bold;
`;

const Action = styled.button`
  border: ${"1px solid"};
`;

const html = (strings: TemplateStringsArray, ...values: Array<string | number>) =>
  strings.reduce((markup, chunk, index) => `${markup}${chunk}${values[index] ?? ""}`, "");

const Message = ({ name }: { name: string }) => <pre>{html`<b>${name}</b> has ${3} messages`}</pre>;

export default function TaggedTemplates() {
  return (
    <Card title="card">
      <Badge>new</Badge>
      <Action type="button">go</Action>
      <Message name="ada" />
    </Card>
  );
}
