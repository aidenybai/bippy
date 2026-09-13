import * as React from "react";

// semantic-ui-react `getElementType`: reads `Component.defaultProps` off a class that
// extends `React.Component` without declaring any statics, so the read is `undefined`.
interface ElementTypeProps {
  as?: React.ElementType;
  href?: string;
}

const getElementType = (
  Component: { defaultProps?: { as?: React.ElementType } },
  props: ElementTypeProps,
): React.ElementType => {
  const defaultProps = Component.defaultProps === undefined ? {} : Component.defaultProps;
  if (props.as && props.as !== defaultProps.as) return props.as;
  if (props.href) return "a";
  return defaultProps.as || "div";
};

class Message extends React.Component<ElementTypeProps & { children?: React.ReactNode }> {
  render(): React.ReactNode {
    const ElementType = getElementType(Message, this.props);
    return <ElementType>{this.props.children}</ElementType>;
  }
}

class Header extends React.PureComponent<ElementTypeProps & { children?: React.ReactNode }> {
  static defaultProps = { as: "h2" };

  render(): React.ReactNode {
    const ElementType = getElementType(Header, this.props);
    return <ElementType>{this.props.children}</ElementType>;
  }
}

class Card extends Message {}

// path-to-regexp 1.x tokenizes with `str.substr(index)` / `str.substr(0, index)`.
const splitPath = (path: string): string[] => {
  const separator = path.indexOf("/", 1);
  return separator === -1 ? [path] : [path.substr(0, separator), path.substr(separator + 1)];
};

export default function App() {
  const [head, tail] = splitPath("/users/:id");
  return (
    <>
      <Message>plain</Message>
      <Message as="section">as section</Message>
      <Message href="/x">link</Message>
      <Header>heading</Header>
      <Header as="h2">still heading</Header>
      <Header as="h4">smaller</Header>
      <Card>
        {"card:"}
        {Card.defaultProps === undefined ? "no statics" : "inherited"}
      </Card>
      <code>
        {head}
        {"|"}
        {tail}
        {"|"}
        {"abcdef".substr(2)}
        {"|"}
        {"abcdef".substr(-3, 2)}
      </code>
    </>
  );
}
