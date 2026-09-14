import * as React from "react";

interface ListProps {
  title?: string;
  items: string[];
  renderEmpty?: () => React.ReactNode;
}

interface ListState {
  expanded: boolean;
  itemCount: number;
}

const ThemeContext = React.createContext<"light" | "dark">("light");

class List extends React.Component<ListProps, ListState> {
  static defaultProps = { title: "untitled", renderEmpty: () => <em>nothing</em> };

  static contextType = ThemeContext;

  declare context: React.ContextType<typeof ThemeContext>;

  state: ListState = { expanded: true, itemCount: 0 };

  static getDerivedStateFromProps(props: ListProps): Partial<ListState> {
    return { itemCount: props.items.length };
  }

  private handleToggle = (): void => {
    this.setState((state) => ({ expanded: !state.expanded }));
  };

  renderHeader(): React.ReactNode {
    return (
      <header onClick={this.handleToggle}>
        <h3>{this.props.title}</h3>
        <small>{this.context}</small>
      </header>
    );
  }

  renderItems(): React.ReactNode {
    const { items, renderEmpty } = this.props;
    if (items.length === 0) return renderEmpty?.();
    return (
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }

  render(): React.ReactNode {
    return (
      <section>
        {this.renderHeader()}
        {this.state.expanded ? this.renderItems() : <p>collapsed</p>}
      </section>
    );
  }
}

class Pure extends React.PureComponent<{ children?: React.ReactNode }> {
  render() {
    const { children = <span>default child</span> } = this.props;
    return <div className="pure">{children}</div>;
  }
}

abstract class Base<Props> extends React.Component<Props> {
  abstract renderContent(): React.ReactNode;

  render(): React.ReactNode {
    return <article>{this.renderContent()}</article>;
  }
}

class Concrete extends Base<{ body: string }> {
  renderContent(): React.ReactNode {
    return <p>{this.props.body}</p>;
  }
}

export default function ClassAdvanced() {
  return (
    <ThemeContext value="dark">
      <List items={["a", "b"]} />
      <List title="empty" items={[]} />
      <Pure />
      <Pure>
        <b>given child</b>
      </Pure>
      <Concrete body="concrete" />
    </ThemeContext>
  );
}
