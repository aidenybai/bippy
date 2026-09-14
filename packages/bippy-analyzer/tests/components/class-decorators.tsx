import { Component, type ComponentType, type ReactNode } from "react";

interface Injected {
  isOver: boolean;
  label: string;
}

const withInjected =
  <P extends Injected>(label: string) =>
  (Decorated: ComponentType<P>) => {
    const displayName = Decorated.displayName ?? Decorated.name;
    return class Injector extends Component<Omit<P, keyof Injected>> {
      static displayName = `Injector(${displayName})`;

      render() {
        const props = { ...this.props, isOver: false, label } as P;
        return <Decorated {...props} />;
      }
    };
  };

const keepOriginal = (): void => undefined;

const tagged = <T extends ComponentType<never>>(Target: T): T & { isTagged: boolean } =>
  Object.assign(Target, { isTagged: true });

@withInjected<PanelProps>("drop here")
class Panel extends Component<PanelProps> {
  render() {
    return (
      <section data-over={this.props.isOver}>
        <h4>{this.props.title}</h4>
        <p>{this.props.label}</p>
      </section>
    );
  }
}

interface PanelProps extends Injected {
  title: string;
}

@keepOriginal
class Plain extends Component<{ children: ReactNode }> {
  render() {
    return <aside>{this.props.children}</aside>;
  }
}

@tagged
class Tagged extends Component {
  static isTagged = false;

  render() {
    return <output>{Tagged.isTagged ? "tagged" : "plain"}</output>;
  }
}

const PanelWithInjection: ComponentType<{ title: string }> = Panel;

export default function ClassDecorators() {
  return (
    <div>
      <PanelWithInjection title="first" />
      <Plain>
        <Tagged />
      </Plain>
    </div>
  );
}
